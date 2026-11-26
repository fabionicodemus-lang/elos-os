export const ENTITY_LABELS: Record<string, string> = {
  supplier: "Fornecedores",
  client: "Clientes",
  payable: "Contas a pagar",
  receivable: "Contas a receber",
};

export const BATCH_LABELS: Record<string, string> = {
  review: "Revisar pendências",
  ready: "Pronto para conferir",
  imported: "Importado",
  cancelled: "Cancelado",
};

export const ROW_LABELS: Record<string, string> = {
  ready: "Pronto",
  blocked: "Bloqueado",
  duplicate: "Já importado",
  conflict: "Conflito",
  imported: "Importado",
};

export type ImportSummary = {
  total?: number;
  ready?: number;
  blocked?: number;
  duplicates?: number;
  conflicts?: number;
  totals_complete?: boolean;
  status_counts?: Record<string, number>;
  totals?: {
    original_amount?: string | number;
    current_amount?: string | number;
    paid_amount?: string | number;
    balance_amount?: string | number;
  };
};

export function dateBR(value: string | null | undefined, withTime = false) {
  if (!value) return "—";
  const date = new Date(value.length === 10 ? `${value}T12:00:00Z` : value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    ...(withTime ? { timeStyle: "short" as const } : {}),
    timeZone: "America/Sao_Paulo",
  }).format(date);
}

export function moneyBR(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  const decimal = typeof value === "number" && Number.isFinite(value) ? value.toFixed(2) : String(value);
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(decimal);
  if (!match) return "—";
  const integer = new Intl.NumberFormat("pt-BR").format(BigInt(match[2]));
  return `${match[1] ? "-" : ""}R$\u00a0${integer},${(match[3] ?? "").padEnd(2, "0")}`;
}

export function rowText(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

export function statusTone(status: string) {
  if (status === "imported" || status === "ready") return "success";
  if (status === "blocked" || status === "conflict" || status === "review") return "warning";
  return "neutral";
}

export function pageNumber(value?: string) {
  const parsed = Number(value ?? 1);
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, 100000) : 1;
}
