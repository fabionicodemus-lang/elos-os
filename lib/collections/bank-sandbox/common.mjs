// Node-only sandbox boundary: no production URL, redirects, or browser credentials.
import { request } from "node:https";
import { createHash } from "node:crypto";
import { mkdir, open } from "node:fs/promises";
import { resolve } from "node:path";

export const BANK_HOSTS = Object.freeze({ sicredi: "api-parceiro.sicredi.com.br", santander: "trust-sandbox.api.santander.com.br" });
export const BANK_CODES = Object.freeze({ sicredi: "748", santander: "033" });
const MAX_BYTES = 8 * 1024 * 1024;

export function required(value, field, pattern, max = 200) {
  if (typeof value !== "string" || !value.trim() || value !== value.trim() || value.length > max || (pattern && !pattern.test(value))) throw new Error(`Campo inválido: ${field}.`);
  return value;
}
export function decimal(value) {
  const s = typeof value === "number" && Number.isFinite(value) ? String(value) : value;
  if (typeof s !== "string" || !/^\d{1,13}(\.\d{1,2})?$/.test(s)) throw new Error("Valor monetário inválido.");
  const [whole, fraction = ""] = s.split(".");
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  if (cents <= 0n) throw new Error("Valor monetário inválido.");
  return `${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;
}
export function civilDate(value) {
  required(value, "data", /^\d{4}-\d{2}-\d{2}$/);
  const ms = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== value) throw new Error("Data civil inválida.");
  return value;
}
export const digits = value => typeof value === "string" ? value.replace(/[.\-/ ]/g, "") : "";
export const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function validateScope(scope, provider) {
  if (scope?.environment !== "sandbox" || scope.test_only !== true || scope.provider !== provider) throw new Error("Somente configuração exclusiva de sandbox é permitida.");
  for (const key of ["company_id", "project_id", "legal_entity_id", "bank_account_id", "config_id"]) required(scope[key], key, /^[\w-]+$/, 80);
  required(scope.agreement, "convênio", provider === "sicredi" ? /^\d{5}$/ : /^\d{1,9}$/);
  required(digits(scope.beneficiary_cnpj), "CNPJ do beneficiário", /^\d{14}$/);
  if (scope.bank_code !== BANK_CODES[provider]) throw new Error("Código do banco incompatível.");
  return Object.freeze({ ...scope, beneficiary_cnpj: digits(scope.beneficiary_cnpj) });
}
export function validateCharge(scope, charge, payer, reservation) {
  if (charge?.test_only !== true || payer?.test_only !== true) throw new Error("Use somente dados fictícios homologados pelo banco.");
  for (const key of ["company_id", "project_id", "legal_entity_id", "bank_account_id", "config_id", "provider", "agreement"]) {
    if (charge[key] !== scope[key]) throw new Error(`Cobrança fora do escopo: ${key}.`);
  }
  if (digits(charge.beneficiary_cnpj) !== scope.beneficiary_cnpj || charge.account_snapshot?.bank !== scope.bank_code) throw new Error("Beneficiário ou conta incompatível.");
  required(charge.id, "ID da cobrança", /^[\w-]+$/, 80);
  const document = required(digits(payer.document), "CPF/CNPJ fictício", /^(\d{11}|\d{14})$/);
  const dueDate = civilDate(charge.due_date);
  const issueDate = civilDate(reservation.issueDate);
  if (issueDate > dueDate) throw new Error("Emissão posterior ao vencimento.");
  return { amount: decimal(charge.amount), document, dueDate, issueDate, name: required(payer.name, "pagador", null, 40),
    address: required(payer.address, "endereço", null, 40), neighborhood: required(payer.neighborhood, "bairro", null, 30), city: required(payer.city, "cidade", null, 20), state: required(payer.state, "UF", /^[A-Z]{2}$/), zip: required(digits(payer.zip), "CEP", /^\d{8}$/) };
}

export function createSandboxTransport(provider, tls = {}) {
  const host = BANK_HOSTS[provider];
  if (!host) throw new Error("Banco desconhecido.");
  if (provider === "santander" && !(tls.cert && tls.key || tls.pfx)) throw new Error("Certificado mTLS de sandbox obrigatório.");
  return ({ method, path, headers = {}, body }) => new Promise((resolve, reject) => {
    if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//") || /[\r\n\\]/.test(path) || /%2f|%5c|%2e/i.test(path.split("?")[0])) return reject(new Error("Rota fora do sandbox."));
    const url = new URL(path, `https://${host}`);
    if (url.hostname !== host || (provider === "sicredi" && !url.pathname.startsWith("/sb/"))) return reject(new Error("Rota fora do sandbox."));
    const safeHeaders = Object.fromEntries(Object.entries(headers).filter(([key]) => !["host", "content-length"].includes(key.toLowerCase())));
    const req = request({ hostname: host, path: url.pathname + url.search, method, headers: { ...safeHeaders, ...(body == null ? {} : { "Content-Length": Buffer.byteLength(body) }) }, cert: tls.cert, key: tls.key, pfx: tls.pfx, passphrase: tls.passphrase, rejectUnauthorized: true, minVersion: "TLSv1.2" }, res => {
      let size = 0;
      const parts = [];
      res.on("data", chunk => { size += chunk.length; if (size > MAX_BYTES) { req.destroy(); reject(new Error("Resposta bancária excede limite.")); } else parts.push(chunk); });
      res.on("end", () => { if (res.statusCode >= 300 && res.statusCode < 400) reject(new Error("Redirecionamento bancário bloqueado.")); else resolve({ status: res.statusCode, headers: res.headers, bytes: Buffer.concat(parts) }); });
      res.on("error", () => reject(new Error("Resposta bancária interrompida.")));
    });
    const timer = setTimeout(() => req.destroy(new Error("Timeout bancário.")), 15000);
    req.once("close", () => clearTimeout(timer));
    req.on("error", () => reject(new Error("Falha de transporte bancário; resultado incerto.")));
    req.end(body);
  });
}
export function json(response, allowed = [200]) {
  if (!allowed.includes(response.status)) throw new Error(`Banco retornou HTTP ${response.status}; conferir sem repetir automaticamente.`);
  try { return JSON.parse(Buffer.from(response.bytes).toString("utf8")); } catch { throw new Error("Resposta JSON bancária inválida."); }
}
export function verifyBoletoCodes(line, barcode, bank, amount) {
  if (typeof line !== "string" || typeof barcode !== "string" || !/^\d{47}$/.test(line) || !/^\d{44}$/.test(barcode) || !line.startsWith(`${bank}9`) || !barcode.startsWith(`${bank}9`)) throw new Error("Identificadores do boleto inválidos.");
  const reconstructed = line.slice(0, 4) + line[32] + line.slice(33) + line.slice(4, 9) + line.slice(10, 20) + line.slice(21, 31);
  if (reconstructed !== barcode) throw new Error("Linha digitável e código de barras divergentes.");
  if (BigInt(barcode.slice(9, 19)) !== BigInt(decimal(amount).replace(".", ""))) throw new Error("Valor codificado do boleto diverge da parcela.");
  return { digitableLine: line, barcode };
}

// Durable sandbox journal (private local directory, not the application DB).
// Each registration claims BOTH charge and bank number. A crash/timeout never
// releases either reservation. Conflicts and partial writes fail closed.
export function createSandboxJournal(directory) {
  required(directory, "diretório privado");
  const root = resolve(directory);
  return { async claim({ scope, chargeId, bankNumber, operation, fingerprint }) {
    await mkdir(root, { recursive: true, mode: 0o700 });
    const agreement = scope.provider === "santander" ? BigInt(scope.agreement).toString() : scope.agreement;
    const keys = [hash(["sandbox", operation, "charge", chargeId]), hash([scope.provider, scope.cooperative ?? "", scope.post ?? "", agreement, operation, "number", bankNumber])];
    for (const key of keys) {
      let fd;
      try { fd = await open(resolve(root, key), "wx", 0o600); }
      catch (error) { if (error.code === "EEXIST") return false; throw error; }
      try { await fd.writeFile(fingerprint); await fd.sync(); } finally { await fd.close(); }
    }
    return true;
  } };
}

export function createTokenCache(obtain) {
  let token, expires = 0, pending;
  return async () => {
    if (token && Date.now() < expires) return token;
    if (!pending) pending = (async () => {
      const value = await obtain();
      token = required(value.access_token, "token bancário", /^[\x21-\x7e]+$/, 8192);
      const seconds = Number(value.expires_in);
      expires = Date.now() + (Number.isFinite(seconds) && seconds > 30 ? Math.min(seconds - 30, 240) * 1000 : 0);
      return token;
    })().finally(() => { pending = undefined; });
    return pending;
  };
}
