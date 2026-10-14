export type AsaasEnvironment = "sandbox" | "production";

export type AsaasConnection = {
  id: string;
  credential_ref: string | null;
  environment: AsaasEnvironment;
};

export type AsaasCustomerInput = {
  id: string;
  name: string;
  tax_id: string | null;
  email: string | null;
  phone: string | null;
};

export type AsaasChargeInput = {
  customer: AsaasCustomerInput;
  billingType: "BOLETO" | "PIX";
  amount: number;
  dueDate: string;
  externalReference: string;
  finePercent?: number;
  interestPercent?: number;
};

export type AsaasChargeResult = {
  id: string;
  status: string;
  invoiceUrl: string | null;
  bankSlipUrl: string | null;
  pixPayload: string | null;
  pixExpirationAt: string | null;
  raw: Record<string, unknown>;
};

type Json = Record<string, unknown>;

function parseSecretMap(name: string): Record<string, string> {
  const raw = (process.env[name] ?? "").trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>)
        .filter(([, value]) => typeof value === "string" && value.trim())
        .map(([key, value]) => [key, String(value).trim()]),
    );
  } catch {
    return {};
  }
}

export function getAsaasCredential(connection: AsaasConnection) {
  const ref = connection.credential_ref?.trim();
  if (!ref) throw new Error("Conexão Asaas sem referência de credencial.");
  const key = parseSecretMap("ELOS_BANKING_ASAAS_KEYS")[ref];
  if (!key) throw new Error(`Credencial Asaas não configurada para ${ref}.`);
  return key;
}

export function getAsaasWebhookToken(connection: AsaasConnection) {
  const ref = connection.credential_ref?.trim();
  if (!ref) return null;
  return parseSecretMap("ELOS_BANKING_ASAAS_WEBHOOK_TOKENS")[ref] ?? null;
}

function baseUrl(environment: AsaasEnvironment) {
  return environment === "production" ? "https://api.asaas.com/v3" : "https://api-sandbox.asaas.com/v3";
}

async function asaasRequest<T extends Json>(connection: AsaasConnection, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl(connection.environment)}${path}`, {
    ...init,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "user-agent": "Elos-OS/Banking",
      access_token: getAsaasCredential(connection),
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => ({}))) as Json;
  if (!response.ok) {
    const description = Array.isArray(payload.errors)
      ? payload.errors.map((item) => (item && typeof item === "object" ? String((item as Json).description ?? "") : "")).filter(Boolean).join("; ")
      : "";
    throw new Error(description || String(payload.message ?? `Asaas HTTP ${response.status}`));
  }
  return payload as T;
}

function digits(value: string | null) {
  return (value ?? "").replace(/\D/g, "");
}

async function findCustomer(connection: AsaasConnection, externalReference: string) {
  const query = new URLSearchParams({ externalReference, limit: "1" });
  const data = await asaasRequest<Json>(connection, `/customers?${query.toString()}`, { method: "GET" });
  const rows = Array.isArray(data.data) ? data.data : [];
  const first = rows[0];
  return first && typeof first === "object" ? String((first as Json).id ?? "") || null : null;
}

export async function ensureAsaasCustomer(connection: AsaasConnection, customer: AsaasCustomerInput) {
  const existing = await findCustomer(connection, customer.id);
  if (existing) return existing;
  const taxId = digits(customer.tax_id);
  if (!taxId) throw new Error("O cliente precisa de CPF/CNPJ para emissão da cobrança.");
  const phone = digits(customer.phone);
  const created = await asaasRequest<Json>(connection, "/customers", {
    method: "POST",
    body: JSON.stringify({
      name: customer.name,
      cpfCnpj: taxId,
      email: customer.email || undefined,
      mobilePhone: phone || undefined,
      externalReference: customer.id,
      notificationDisabled: true,
    }),
  });
  const id = String(created.id ?? "");
  if (!id) throw new Error("Asaas não retornou o identificador do cliente.");
  return id;
}

async function findPayment(connection: AsaasConnection, externalReference: string): Promise<Json | null> {
  const query = new URLSearchParams({ externalReference, limit: "1" });
  const data = await asaasRequest<Json>(connection, `/payments?${query.toString()}`, { method: "GET" });
  const rows = Array.isArray(data.data) ? data.data : [];
  const first = rows[0];
  return first && typeof first === "object" ? first as Json : null;
}

async function finishCharge(connection: AsaasConnection, payment: Json, billingType: "BOLETO" | "PIX"): Promise<AsaasChargeResult> {
  const id = String(payment.id ?? "");
  if (!id) throw new Error("Asaas não retornou o identificador da cobrança.");

  let pixPayload: string | null = null;
  let pixExpirationAt: string | null = null;
  if (billingType === "PIX") {
    const qr = await asaasRequest<Json>(connection, `/payments/${encodeURIComponent(id)}/pixQrCode`, { method: "GET" });
    pixPayload = typeof qr.payload === "string" ? qr.payload : null;
    pixExpirationAt = typeof qr.expirationDate === "string" ? qr.expirationDate : null;
  }

  return {
    id,
    status: String(payment.status ?? "PENDING"),
    invoiceUrl: typeof payment.invoiceUrl === "string" ? payment.invoiceUrl : null,
    bankSlipUrl: typeof payment.bankSlipUrl === "string" ? payment.bankSlipUrl : null,
    pixPayload,
    pixExpirationAt,
    raw: payment,
  };
}

export async function createAsaasCharge(connection: AsaasConnection, input: AsaasChargeInput): Promise<AsaasChargeResult> {
  // Recupera antes de criar. Isso torna o comando seguro quando a chamada anterior
  // chegou ao Asaas, mas a resposta se perdeu antes do registro local.
  const existing = await findPayment(connection, input.externalReference);
  if (existing) return finishCharge(connection, existing, input.billingType);

  const customerId = await ensureAsaasCustomer(connection, input.customer);
  const payment = await asaasRequest<Json>(connection, "/payments", {
    method: "POST",
    body: JSON.stringify({
      customer: customerId,
      billingType: input.billingType,
      value: Number(input.amount.toFixed(2)),
      dueDate: input.dueDate,
      externalReference: input.externalReference,
      fine: input.finePercent && input.finePercent > 0 ? { value: input.finePercent } : undefined,
      interest: input.interestPercent && input.interestPercent > 0 ? { value: input.interestPercent } : undefined,
    }),
  });
  return finishCharge(connection, payment, input.billingType);
}

export type NormalizedAsaasWebhook = {
  eventId: string;
  eventType: string;
  paymentId: string;
  status: "pending" | "confirmed" | "received" | "overdue" | "cancelled" | "refunded" | "error";
  gross: number | null;
  net: number | null;
  paidDate: string | null;
  raw: Json;
};

function normalizedStatus(event: string): NormalizedAsaasWebhook["status"] {
  if (event === "PAYMENT_RECEIVED") return "received";
  if (event === "PAYMENT_CONFIRMED") return "confirmed";
  if (event === "PAYMENT_OVERDUE") return "overdue";
  if (event === "PAYMENT_REFUNDED" || event === "PAYMENT_PARTIALLY_REFUNDED") return "refunded";
  if (event === "PAYMENT_DELETED" || event === "PAYMENT_BANK_SLIP_CANCELLED") return "cancelled";
  return "pending";
}

export function normalizeAsaasWebhook(payload: unknown): NormalizedAsaasWebhook {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Webhook Asaas inválido.");
  const raw = payload as Json;
  const payment = raw.payment;
  if (!payment || typeof payment !== "object" || Array.isArray(payment)) throw new Error("Webhook Asaas sem cobrança.");
  const row = payment as Json;
  const eventId = String(raw.id ?? "").trim();
  const eventType = String(raw.event ?? "").trim();
  const paymentId = String(row.id ?? "").trim();
  if (!eventId || !eventType || !paymentId) throw new Error("Webhook Asaas sem identificadores.");
  const grossValue = Number(row.value ?? row.originalValue ?? NaN);
  const netValue = Number(row.netValue ?? NaN);
  const paidDate = [row.paymentDate, row.clientPaymentDate, row.confirmedDate]
    .find((value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value as string));
  return {
    eventId,
    eventType,
    paymentId,
    status: normalizedStatus(eventType),
    gross: Number.isFinite(grossValue) ? grossValue : null,
    net: Number.isFinite(netValue) ? netValue : null,
    paidDate: typeof paidDate === "string" ? paidDate.slice(0, 10) : null,
    raw,
  };
}
