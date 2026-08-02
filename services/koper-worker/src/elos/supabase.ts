import { env } from "../config/env.js";

// A service role ignora RLS. Este cliente existe somente no worker server-side;
// nunca exporte sua chave para o navegador, logs ou respostas de diagnóstico.
function getSupabaseConfig(): { baseUrl: string; serviceRoleKey: string } {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Supabase não configurado no koper-worker");
  }

  return {
    baseUrl: env.SUPABASE_URL,
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
  };
}

export type SupabaseRestOptions = {
  method?: "GET" | "POST" | "PATCH";
  query?: URLSearchParams;
  body?: unknown;
  prefer?: string;
};

function safeSupabaseErrorContext(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return [parsed.code, parsed.message, parsed.details, parsed.hint]
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .join(" · ")
      .replace(/(Bearer|apikey|authorization)[^\s,;]*/gi, "$1 [REDACTED]")
      .slice(0, 1_000);
  } catch {
    return "unavailable";
  }
}

export async function requestSupabase<T>(
  resource: string,
  options: SupabaseRestOptions = {},
): Promise<T> {
  const { baseUrl, serviceRoleKey } = getSupabaseConfig();
  const normalizedResource = resource.replace(/^\/+/, "");
  const url = new URL(`/rest/v1/${normalizedResource}`, baseUrl);

  options.query?.forEach((value, key) => url.searchParams.append(key, value));

  const headers: Record<string, string> = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    Accept: "application/json",
  };

  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.prefer) headers.Prefer = options.prefer;

  const requestInit: RequestInit = {
    method: options.method ?? "GET",
    headers,
    signal: AbortSignal.timeout(15_000),
  };

  if (options.body !== undefined) requestInit.body = JSON.stringify(options.body);

  const response = await fetch(url, requestInit);
  const raw = await response.text();

  if (!response.ok) {
    const context = safeSupabaseErrorContext(raw);
    throw new Error(
      `Supabase ${requestInit.method} ${normalizedResource} failed (HTTP ${response.status}) · ${context}`,
    );
  }

  if (!raw.trim()) return undefined as T;
  return JSON.parse(raw) as T;
}

export type KoperStagingReadiness = {
  reachable: true;
  companyId: string;
  sampledRows: number;
};

export async function checkKoperStagingReadiness(): Promise<KoperStagingReadiness> {
  const query = new URLSearchParams({
    select: "id",
    company_id: `eq.${env.BOSSA_COMPANY_ID}`,
    limit: "1",
  });
  const rows: unknown = await requestSupabase<unknown>(
    "koper_staging_records",
    { query },
  );

  if (!Array.isArray(rows)) throw new Error("Resposta inválida da staging do Koper");

  return {
    reachable: true,
    companyId: env.BOSSA_COMPANY_ID,
    sampledRows: rows.length,
  };
}
