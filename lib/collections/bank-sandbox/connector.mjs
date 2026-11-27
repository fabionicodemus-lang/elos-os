import { BANK_CODES, createSandboxTransport, createTokenCache, validateScope, validateCharge, required, decimal, civilDate, digits, hash, json, verifyBoletoCodes } from "./common.mjs";

const sicrediRoot = "/sb/cobranca/boleto/v1";
const santanderRoot = "/collection_bill_management/v2";
const query = values => `?${new URLSearchParams(values)}`;
const jsonBody = value => JSON.stringify(value);
const normalizeNumber = (provider, value) => {
  const str = typeof value === "number" && Number.isSafeInteger(value) ? String(value) : value;
  return required(str, "nosso número", provider === "sicredi" ? /^\d{9}$/ : /^\d{1,13}$/).padStart(provider === "sicredi" ? 9 : 13, "0");
};
const only = (value, provider) => {
  const rows = Array.isArray(value) ? value : Array.isArray(value?._content) ? value._content : [value];
  if (rows.length !== 1 || !rows[0] || typeof rows[0] !== "object") throw new Error(`${provider}: resposta ambígua; conferir no banco.`);
  return rows[0];
};
const normalizeStatus = value => String(value ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toUpperCase();

// All mutating commands use a durable journal, and a completed POST is never
// automatically retried. Existing/uncertain records are recovered by GET only.
function makeConnector({ scope, journal, lookup, issue, cancelRequest, validate, reference, bankPdf, settlement }) {
  if (!journal || typeof journal.claim !== "function") throw new Error("Journal durável de sandbox obrigatório.");
  async function find(charge, payer, reservation) {
    const normalized = validateCharge(scope, charge, payer, reservation);
    const refs = reference(reservation);
    const result = await lookup(refs);
    return { normalized, refs, found: result === null ? null : validate(result, normalized, refs) };
  }
  return Object.freeze({
    provider: scope.provider, environment: "sandbox",
    async query(charge, payer, reservation) {
      return (await find(charge, payer, reservation)).found;
    },
    async register(charge, payer, reservation) {
      const { normalized, refs, found } = await find(charge, payer, reservation);
      if (found) return found;
      const fingerprint = hash([scope, charge.id, normalized, refs]);
      const claimed = await journal.claim({ scope, chargeId: charge.id, bankNumber: refs.bankNumber, operation: "registration", fingerprint });
      if (!claimed) return { status: "pending_review", reason: "Tentativa anterior ou número reservado; consultar banco antes de qualquer novo registro." };
      try { await issue(normalized, refs); } catch { return { status: "pending_review", reason: "Registro não confirmado; preservar reserva e consultar novamente." }; }
      // Even a successful HTTP registration is not enough: consult the exact
      // number and compare the original payer/value/date/reference.
      return (await find(charge, payer, reservation)).found ?? { status: "pending_review", reason: "Registro solicitado, ainda sem confirmação na consulta." };
    },
    async cancel(charge, payer, reservation) {
      const { normalized, refs, found } = await find(charge, payer, reservation);
      if (!found || found.status === "pending_review") return { status: "pending_review" };
      if (found.status === "cancelled") return found;
      if (found.status !== "registered_at_bank") return { status: "pending_review", reason: "Título não está ativo; verificar liquidação ou baixa." };
      const claimed = await journal.claim({ scope, chargeId: charge.id, bankNumber: refs.bankNumber, operation: "cancellation", fingerprint: hash([scope, charge.id, normalized, refs]) });
      if (!claimed) return { status: "pending_review" };
      try { await cancelRequest(refs); } catch { return { status: "pending_review" }; }
      const verified = (await find(charge, payer, reservation)).found;
      return verified?.status === "cancelled" ? verified : { status: "pending_review", reason: "Baixa solicitada; aguardar confirmação bancária." };
    },
    async pdf(charge, payer, reservation) {
      const { found } = await find(charge, payer, reservation);
      if (found?.status !== "registered_at_bank" || !found.digitableLine) throw new Error("Documento não liberado: registro ativo não comprovado.");
      if (!bankPdf) return { status: "pending_review", reason: "PDF oficial indisponível no sandbox; homologar composição do documento antes de enviar." };
      return bankPdf(found.digitableLine);
    },
    async settlement(charge, payer, reservation, options) {
      const { refs, found } = await find(charge, payer, reservation);
      if (!found) return null;
      const data = await settlement(refs, options);
      // This is bank evidence, not a financial posting. Never returns a paid flag.
      return { provider: scope.provider, environment: "sandbox", bankAccountId: scope.bank_account_id, agreement: scope.agreement, bankIdentifier: refs.bankNumber, requiresReconciliation: true, observation: data };
    },
  });
}

export function createSicrediSandboxConnector({ scope: raw, credentials, journal, transport }) {
  const scope = validateScope(raw, "sicredi");
  required(scope.cooperative, "cooperativa", /^\d{4}$/);
  required(scope.post, "posto", /^\d{2}$/);
  required(scope.document_kind, "espécie de documento", /^(OUTROS|RECIBO|NOTA_DEBITO|DUPLICATA_MERCANTIL_INDICACAO|DUPLICATA_SERVICO_INDICACAO|NOTA_PROMISSORIA)$/);
  const apiKey = required(credentials?.apiKey, "API Key", /^[\x21-\x7e]+$/, 256);
  const password = required(credentials?.accessCode, "código de acesso", null, 500);
  const username = required(credentials?.username, "usuário da cobrança", /^\d{9}$/);
  if (![scope.agreement + scope.cooperative, scope.cooperative + scope.agreement].includes(username)) throw new Error("Usuário não pertence à cooperativa/convênio de teste.");
  const send = transport ?? createSandboxTransport("sicredi");
  const token = createTokenCache(async () => json(await send({ method: "POST", path: "/sb/auth/openapi/token", headers: { "x-api-key": apiKey, context: "COBRANCA", "Content-Type": "application/x-www-form-urlencoded", accept: "application/json" }, body: new URLSearchParams({ grant_type: "password", username, password, scope: "cobranca" }).toString() })));
  const call = async (method, path, body, extra = {}) => send({ method, path, headers: { authorization: `Bearer ${await token()}`, "x-api-key": apiKey, cooperativa: scope.cooperative, posto: scope.post, "Content-Type": "application/json", accept: "application/json", ...extra }, body: body == null ? undefined : jsonBody(body) });
  const reference = r => ({ bankNumber: normalizeNumber("sicredi", r.bankNumber), customerRef: required(r.customerRef, "seu número", /^[A-Za-z0-9/-]{1,10}$/), externalRef: required(r.externalRef, "ID título empresa", /^[A-Za-z0-9_-]{1,25}$/), issueDate: civilDate(r.issueDate) });
  const lookup = async refs => {
    const result = await call("GET", `${sicrediRoot}/boletos${query({ codigoBeneficiario: scope.agreement, nossoNumero: refs.bankNumber })}`);
    return result.status === 404 ? null : only(json(result), "sicredi");
  };
  const validate = (r, n, refs) => {
    if (normalizeNumber("sicredi", r.nossoNumero) !== refs.bankNumber || r.seuNumero !== refs.customerRef || r.idTituloEmpresa !== refs.externalRef || decimal(r.valorNominal) !== n.amount || r.dataVencimento !== n.dueDate || digits(r.pagador?.documento) !== n.document || (r.codigoBeneficiario != null && String(r.codigoBeneficiario) !== scope.agreement)) throw new Error("Sicredi: título retornado diverge da reserva/pagador/valor/vencimento.");
    const status = normalizeStatus(r.situacao ?? r["situação"]);
    if (status === "BAIXADO POR SOLICITACAO") return { status: "cancelled", identifier: refs.bankNumber };
    if (!["EM CARTEIRA", "EM CARTEIRA PIX", "VENCIDO"].includes(status)) return { status: "pending_review", bankStatus: status, identifier: refs.bankNumber };
    return { status: "registered_at_bank", identifier: refs.bankNumber, ...verifyBoletoCodes(r.linhaDigitavel, r.codigoBarras, BANK_CODES.sicredi, n.amount) };
  };
  return makeConnector({ scope, journal, reference, lookup, validate,
    async issue(n, refs) {
      json(await call("POST", `${sicrediRoot}/boletos`, { codigoBeneficiario: scope.agreement, tipoCobranca: "NORMAL", especieDocumento: scope.document_kind, nossoNumero: refs.bankNumber, seuNumero: refs.customerRef, idTituloEmpresa: refs.externalRef, valor: Number(n.amount), dataVencimento: n.dueDate,
        pagador: { tipoPessoa: n.document.length === 11 ? "PESSOA_FISICA" : "PESSOA_JURIDICA", documento: n.document, nome: n.name, endereco: n.address, cidade: n.city, uf: n.state, cep: n.zip } }), [201]);
    },
    async cancelRequest(refs) { json(await call("PATCH", `${sicrediRoot}/boletos/${refs.bankNumber}/baixa`, undefined, { codigoBeneficiario: scope.agreement }), [202]); },
    async bankPdf(line) {
      const result = await call("GET", `${sicrediRoot}/boletos/pdf${query({ linhaDigitavel: line })}`, undefined, { accept: "application/pdf" });
      if (![200, 201].includes(result.status) || !Buffer.from(result.bytes).subarray(0, 5).equals(Buffer.from("%PDF-"))) throw new Error("PDF Sicredi inválido ou indisponível.");
      return { status: "document", bytes: result.bytes, mimeType: "application/pdf" };
    },
    async settlement(refs) { const r = await lookup(refs); return r?.dadosLiquidacao ?? null; },
  });
}

export function createSantanderSandboxConnector({ scope: raw, credentials, journal, transport }) {
  const scope = validateScope(raw, "santander");
  required(scope.workspace_id, "workspace", /^[\w-]+$/, 128);
  required(scope.document_kind, "espécie de documento", /^(OUTROS|RECIBO|NOTA_DEBITO|DUPLICATA_MERCANTIL|DUPLICATA_SERVICO|NOTA_PROMISSORIA)$/);
  const clientId = required(credentials?.clientId, "Client ID", /^[\x21-\x7e]+$/, 256);
  const clientSecret = required(credentials?.clientSecret, "Client Secret", null, 500);
  const send = transport ?? createSandboxTransport("santander", credentials?.tls);
  const token = createTokenCache(async () => json(await send({ method: "POST", path: "/auth/oauth/v2/token", headers: { "Content-Type": "application/x-www-form-urlencoded", accept: "application/json" }, body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret }).toString() })));
  const call = async (method, path, body) => send({ method, path, headers: { authorization: `Bearer ${await token()}`, "X-Application-Key": clientId, "Content-Type": "application/json", accept: "application/json" }, body: body == null ? undefined : jsonBody(body) });
  const reference = r => ({ bankNumber: normalizeNumber("santander", r.bankNumber), customerRef: required(r.customerRef, "seu número", /^[A-Za-z0-9_-]{1,15}$/), nsuCode: required(r.nsuCode, "NSU", /^[A-Za-z0-9_-]{1,20}$/), issueDate: civilDate(r.issueDate) });
  const bills = `${santanderRoot}/workspaces/${scope.workspace_id}/bank_slips`;
  const lookup = async refs => {
    const result = await call("GET", `${santanderRoot}/bills${query({ beneficiaryCode: scope.agreement, bankNumber: refs.bankNumber })}`);
    if (result.status === 404) return null;
    const value = json(result);
    if (Array.isArray(value?._content) && value._content.length === 0) return null;
    const base = only(value, "santander");
    if (normalizeStatus(base.status) !== "ATIVO" || (base.payer?.documentNumber && base.digitableLine && base.barCode)) return base;
    const response = await call("GET", `${santanderRoot}/bills/${scope.agreement}.${refs.bankNumber}${query({ tipoConsulta: "bankslip" })}`);
    if (response.status === 404) return base;
    const detail = only(json(response), "santander");
    // Only enrich an exact matching result. Never let detail override the base
    // identity, amount, date, or status; incomplete responses remain pending.
    const code = String(detail.beneficiaryCode ?? detail.covenantCode ?? "");
    if (!/^\d{1,9}$/.test(code) || BigInt(code) !== BigInt(scope.agreement) || normalizeNumber("santander", detail.bankNumber) !== refs.bankNumber) throw new Error("Santander: detalhes de outro título.");
    return { ...base, payer: detail.payer, payerDocumentNumber: detail.payerDocumentNumber, digitableLine: detail.digitableLine, barCode: detail.barCode };
  };
  const validate = (r, n, refs) => {
    const agreement = String(r.beneficiaryCode ?? r.covenantCode ?? "");
    if (!/^\d{1,9}$/.test(agreement) || BigInt(agreement) !== BigInt(scope.agreement) || normalizeNumber("santander", r.bankNumber) !== refs.bankNumber || r.clientNumber !== refs.customerRef || decimal(r.nominalValue) !== n.amount || r.dueDate !== n.dueDate) throw new Error("Santander: título retornado diverge de convênio/reserva/valor/vencimento.");
    // The standard query may omit payer and barcode; require the detailed
    // schema before releasing any document. Do not treat Baixado as cancellation
    // (the bank also uses it for Pix settlement).
    if (normalizeStatus(r.status) !== "ATIVO" || digits(r.payer?.documentNumber ?? r.payerDocumentNumber) !== n.document || !r.digitableLine || !r.barCode) return { status: "pending_review", bankStatus: normalizeStatus(r.status), identifier: refs.bankNumber };
    return { status: "registered_at_bank", identifier: refs.bankNumber, ...verifyBoletoCodes(r.digitableLine, r.barCode, BANK_CODES.santander, n.amount) };
  };
  return makeConnector({ scope, journal, reference, lookup, validate,
    async issue(n, refs) {
      json(await call("POST", bills, { nsuCode: refs.nsuCode, nsuDate: refs.issueDate, environment: "TESTE", covenantCode: scope.agreement, bankNumber: refs.bankNumber, clientNumber: refs.customerRef, issueDate: refs.issueDate, dueDate: n.dueDate, nominalValue: n.amount, documentKind: scope.document_kind, paymentType: "REGISTRO",
        payer: { documentType: n.document.length === 11 ? "CPF" : "CNPJ", documentNumber: n.document, name: n.name, address: n.address, neighborhood: n.neighborhood, city: n.city, state: n.state, zipCode: `${n.zip.slice(0, 5)}-${n.zip.slice(5)}` } }), [200]);
    },
    async cancelRequest(refs) { json(await call("PATCH", bills, { covenantCode: scope.agreement, bankNumber: refs.bankNumber, operation: "BAIXAR" })); },
    async settlement(refs) { return json(await call("GET", `${santanderRoot}/bills/${scope.agreement}.${refs.bankNumber}${query({ tipoConsulta: "settlement" })}`)); },
  });
}
