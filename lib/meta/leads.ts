import crypto from "node:crypto";
import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";

// Versão da Graph API usada para consultar os dados do lead.
// Mantida aqui para ficar fácil de atualizar quando a Meta descontinuar versões.
export const META_GRAPH_VERSION = "v21.0";

// ---------------------------------------------------------------------------
// Tipos do payload do webhook (apenas o subconjunto relevante ao Lead Ads).
// Referência: https://developers.facebook.com/docs/graph-api/webhooks/reference/page/#leadgen
// ---------------------------------------------------------------------------
export interface MetaLeadgenChangeValue {
  leadgen_id?: string;
  form_id?: string;
  page_id?: string;
  ad_id?: string;
  adgroup_id?: string;
  created_time?: number;
}

export interface MetaWebhookChange {
  field?: string;
  value?: MetaLeadgenChangeValue;
}

export interface MetaWebhookEntry {
  id?: string;
  time?: number;
  changes?: MetaWebhookChange[];
}

export interface MetaWebhookPayload {
  object?: string;
  entry?: MetaWebhookEntry[];
}

export interface MetaLeadEvent {
  leadgenId: string;
  formId?: string;
  adId?: string;
  pageId?: string;
  createdTime?: number;
}

// Dados retornados pela Graph API ao consultar um lead pelo leadgen_id.
export interface MetaLeadFieldEntry {
  name: string;
  values: string[];
}

export interface MetaLeadDetails {
  id: string;
  created_time?: string;
  ad_id?: string;
  form_id?: string;
  field_data: MetaLeadFieldEntry[];
}

export interface ParsedLead {
  nome: string | null;
  email: string | null;
  telefoneBruto: string | null;
  mensagem: string | null;
  // Todas as respostas do formulário, indexadas pelo nome do campo da Meta.
  respostas: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Verificação de assinatura (X-Hub-Signature-256).
// A Meta assina o corpo cru da requisição com o App Secret via HMAC-SHA256.
// ---------------------------------------------------------------------------
export function verifyMetaSignature(
  rawBody: string,
  signatureHeader: string | null | undefined,
  appSecret: string,
): boolean {
  if (!appSecret || !signatureHeader) {
    return false;
  }

  const [algorithm, provided] = signatureHeader.split("=");
  if (algorithm !== "sha256" || !provided) {
    return false;
  }

  const expected = crypto
    .createHmac("sha256", appSecret)
    .update(rawBody, "utf8")
    .digest("hex");

  // Comparação em tempo constante para evitar ataques de timing.
  const expectedBuffer = Uint8Array.from(Buffer.from(expected, "hex"));
  const providedBuffer = Uint8Array.from(Buffer.from(provided, "hex"));
  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, providedBuffer);
}

// ---------------------------------------------------------------------------
// Extrai os eventos de lead de um payload de webhook.
// Um único payload pode conter várias páginas / mudanças.
// ---------------------------------------------------------------------------
export function extractLeadEvents(payload: MetaWebhookPayload | null | undefined): MetaLeadEvent[] {
  if (!payload || payload.object !== "page" || !Array.isArray(payload.entry)) {
    return [];
  }

  const events: MetaLeadEvent[] = [];
  for (const entry of payload.entry) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "leadgen") {
        continue;
      }
      const value = change.value;
      if (!value?.leadgen_id) {
        continue;
      }
      events.push({
        leadgenId: value.leadgen_id,
        formId: value.form_id,
        adId: value.ad_id,
        pageId: value.page_id,
        createdTime: value.created_time,
      });
    }
  }
  return events;
}

// ---------------------------------------------------------------------------
// Consulta os dados completos do lead na Graph API.
// Só pedimos campos válidos no nó do leadgen para não receber erro da Meta.
// ---------------------------------------------------------------------------
export async function fetchMetaLeadDetails(
  leadgenId: string,
  pageAccessToken: string,
  options?: { version?: string; fetchImpl?: typeof fetch },
): Promise<MetaLeadDetails> {
  const version = options?.version ?? META_GRAPH_VERSION;
  const fetchImpl = options?.fetchImpl ?? fetch;

  const url = new URL(`https://graph.facebook.com/${version}/${encodeURIComponent(leadgenId)}`);
  url.searchParams.set("fields", "id,created_time,ad_id,field_data");
  url.searchParams.set("access_token", pageAccessToken);

  const response = await fetchImpl(url, { method: "GET" });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Falha ao consultar o lead ${leadgenId} na Graph API (HTTP ${response.status}): ${body}`,
    );
  }

  const data = (await response.json()) as MetaLeadDetails;
  if (!Array.isArray(data.field_data)) {
    data.field_data = [];
  }
  return data;
}

function joinFirstAndLast(respostas: Record<string, string>): string | null {
  const first = respostas["first_name"]?.trim();
  const last = respostas["last_name"]?.trim();
  const combined = [first, last].filter(Boolean).join(" ").trim();
  return combined || null;
}

// ---------------------------------------------------------------------------
// Transforma o field_data da Meta em um objeto de lead estruturado.
// Preserva todas as respostas em `respostas` e extrai os campos conhecidos.
// ---------------------------------------------------------------------------
export function parseLeadFieldData(fieldData: MetaLeadFieldEntry[] = []): ParsedLead {
  const respostas: Record<string, string> = {};
  for (const field of fieldData) {
    if (!field?.name) {
      continue;
    }
    const value = (field.values ?? [])
      .map((item) => (item == null ? "" : String(item)))
      .map((item) => item.trim())
      .filter(Boolean)
      .join(", ");
    respostas[field.name] = value;
  }

  const pick = (...keys: string[]): string | null => {
    for (const key of keys) {
      const value = respostas[key]?.trim();
      if (value) {
        return value;
      }
    }
    return null;
  };

  const nome =
    pick("full_name", "name", "nome", "nome_completo") ?? joinFirstAndLast(respostas);
  const email = pick("email", "e-mail", "email_address");
  const telefoneBruto = pick("phone_number", "telefone", "phone", "celular", "whatsapp");
  const mensagem = pick(
    "message",
    "mensagem",
    "mensagem_recebida",
    "observacoes",
    "observações",
    "comments",
  );

  return { nome, email, telefoneBruto, mensagem, respostas };
}

// ---------------------------------------------------------------------------
// Normaliza um telefone para o formato E.164 (ex.: +5511999998888).
// Se não for possível validar, devolve os dígitos limpos para não perder o contato.
// ---------------------------------------------------------------------------
export function normalizePhone(
  raw: string | null | undefined,
  defaultCountry: CountryCode = "BR",
): string | null {
  if (!raw) {
    return null;
  }

  const parsed = parsePhoneNumberFromString(raw, defaultCountry);
  if (parsed && parsed.isValid()) {
    return parsed.number; // E.164
  }

  const cleaned = raw.replace(/[^\d+]/g, "");
  return cleaned || null;
}
