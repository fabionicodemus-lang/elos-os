import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { request } from "node:https";
import { gunzipSync } from "node:zlib";

const PROD_URL = "https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx";
const HOM_URL = "https://hom.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx";
const SOAP_ACTION = "http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe/nfeDistDFeInteresse";

export type SefazEnvironment = "production" | "homologation";
export type DistributedDocument = {
  nsu: string;
  schema: string;
  xml: string;
  accessKey: string | null;
  issuerTaxId: string | null;
  issuerName: string | null;
  issueDateTime: string | null;
  totalAmount: number | null;
  documentStatus: string | null;
  isFullXml: boolean;
};
export type DistributionResponse = {
  statusCode: string;
  statusMessage: string;
  lastNsu: string;
  maxNsu: string;
  documents: DistributedDocument[];
};

function secretKey() {
  const secret = process.env.SEFAZ_CERTIFICATE_SECRET?.trim();
  if (!secret || secret.length < 24) throw new Error("Configure SEFAZ_CERTIFICATE_SECRET com pelo menos 24 caracteres no ambiente da aplicação.");
  return createHash("sha256").update(secret).digest();
}

export function encryptCertificatePassword(password: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secretKey(), iv);
  const encrypted = Buffer.concat([cipher.update(password, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv, authTag, encrypted].map((part) => part.toString("base64url")).join(".");
}

export function decryptCertificatePassword(payload: string) {
  const [ivText, tagText, encryptedText] = payload.split(".");
  if (!ivText || !tagText || !encryptedText) throw new Error("Senha do certificado armazenada em formato inválido.");
  const decipher = createDecipheriv("aes-256-gcm", secretKey(), Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encryptedText, "base64url")), decipher.final()]).toString("utf8");
}

function escapeXml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function tag(xml: string, name: string) {
  const match = xml.match(new RegExp(`<(?:\\w+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:\\w+:)?${name}>`, "i"));
  return match?.[1]?.replace(/<!\[CDATA\[|\]\]>/g, "").trim() || null;
}

function attribute(fragment: string, name: string) {
  const match = fragment.match(new RegExp(`${name}=["']([^"']+)["']`, "i"));
  return match?.[1] ?? null;
}

function normalizeTaxId(value: string | null) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits || null;
}

function accessKeyFromXml(xml: string) {
  const direct = tag(xml, "chNFe");
  if (direct) return direct.replace(/\D/g, "").slice(0, 44) || null;
  const inf = xml.match(/<(?:\w+:)?infNFe\b[^>]*\bId=["']NFe(\d{44})["']/i);
  return inf?.[1] ?? null;
}

function parseDocument(nsu: string, schema: string, xml: string): DistributedDocument {
  const isFullXml = /(?:^|_)procNFe|nfeProc|procNFe/i.test(schema) || /<(?:\w+:)?nfeProc\b/i.test(xml);
  return {
    nsu,
    schema,
    xml,
    accessKey: accessKeyFromXml(xml),
    issuerTaxId: normalizeTaxId(tag(xml, "CNPJ") ?? tag(xml, "CPF")),
    issuerName: tag(xml, "xNome"),
    issueDateTime: tag(xml, "dhEmi") ?? tag(xml, "dEmi"),
    totalAmount: Number(tag(xml, "vNF") ?? "") || null,
    documentStatus: tag(xml, "cSitNFe"),
    isFullXml,
  };
}

function postSoap(url: string, body: string, pfx: ArrayBuffer, passphrase: string) {
  return new Promise<string>((resolve, reject) => {
    const target = new URL(url);
    const req = request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || 443,
      path: target.pathname,
      method: "POST",
      pfx: new Uint8Array(pfx) as never,
      passphrase,
      rejectUnauthorized: true,
      minVersion: "TLSv1.2",
      timeout: 45_000,
      headers: {
        "Content-Type": "application/soap+xml; charset=utf-8",
        "Content-Length": Buffer.byteLength(body),
        SOAPAction: SOAP_ACTION,
        "User-Agent": "Elos-OS/1.0",
      },
    }, (response) => {
      const chunks: Uint8Array[] = [];
      response.on("data", (chunk) => chunks.push(typeof chunk === "string" ? new TextEncoder().encode(chunk) : new Uint8Array(chunk)));
      response.on("end", () => {
        const size = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
        const merged = new Uint8Array(size);
        let offset = 0;
        chunks.forEach((chunk) => { merged.set(chunk, offset); offset += chunk.byteLength; });
        const text = new TextDecoder().decode(merged);
        if ((response.statusCode ?? 500) >= 400) reject(new Error(`SEFAZ respondeu HTTP ${response.statusCode}: ${text.slice(0, 500)}`));
        else resolve(text);
      });
    });
    req.on("timeout", () => req.destroy(new Error("A consulta à SEFAZ excedeu 45 segundos.")));
    req.on("error", reject);
    req.end(body);
  });
}

export async function distributeDfe({
  environment,
  stateCode,
  taxId,
  lastNsu,
  pfx,
  passphrase,
}: {
  environment: SefazEnvironment;
  stateCode: string;
  taxId: string;
  lastNsu: string;
  pfx: ArrayBuffer;
  passphrase: string;
}): Promise<DistributionResponse> {
  const cnpj = taxId.replace(/\D/g, "");
  if (cnpj.length !== 14) throw new Error("A Distribuição DF-e exige o CNPJ da SPE destinatária.");
  const nsu = String(lastNsu || "0").replace(/\D/g, "").padStart(15, "0").slice(-15);
  const tpAmb = environment === "production" ? "1" : "2";
  const dist = `<distDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01"><tpAmb>${tpAmb}</tpAmb><cUFAutor>${escapeXml(stateCode)}</cUFAutor><CNPJ>${cnpj}</CNPJ><distNSU><ultNSU>${nsu}</ultNSU></distNSU></distDFeInt>`;
  const soap = `<?xml version="1.0" encoding="utf-8"?><soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body><nfeDistDFeInteresse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe"><nfeDadosMsg>${dist}</nfeDadosMsg></nfeDistDFeInteresse></soap12:Body></soap12:Envelope>`;
  const responseXml = await postSoap(environment === "production" ? PROD_URL : HOM_URL, soap, pfx, passphrase);
  const payload = tag(responseXml, "retDistDFeInt") ?? responseXml;
  const statusCode = tag(payload, "cStat") ?? "";
  const statusMessage = tag(payload, "xMotivo") ?? "Resposta sem descrição";
  const documents: DistributedDocument[] = [];
  const regex = /<(?:\w+:)?docZip\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?docZip>/gi;
  for (const match of payload.matchAll(regex)) {
    const nsuValue = attribute(match[1], "NSU") ?? "";
    const schema = attribute(match[1], "schema") ?? "desconhecido";
    try {
      const xml = gunzipSync(Buffer.from(match[2].replace(/\s/g, ""), "base64")).toString("utf8");
      documents.push(parseDocument(nsuValue, schema, xml));
    } catch (error) {
      throw new Error(`Não foi possível descompactar o NSU ${nsuValue}: ${error instanceof Error ? error.message : "erro desconhecido"}`);
    }
  }
  if (!["137", "138", "656"].includes(statusCode)) throw new Error(`SEFAZ ${statusCode}: ${statusMessage}`);
  return {
    statusCode,
    statusMessage,
    lastNsu: tag(payload, "ultNSU") ?? nsu,
    maxNsu: tag(payload, "maxNSU") ?? nsu,
    documents,
  };
}
