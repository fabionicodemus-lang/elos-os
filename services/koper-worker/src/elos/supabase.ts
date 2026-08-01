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

export type KoperStagingReadiness = {
  reachable: true;
  companyId: string;
  sampledRows: number;
};

export async function checkKoperStagingReadiness(): Promise<KoperStagingReadiness> {
  const { baseUrl, serviceRoleKey } = getSupabaseConfig();
  const url = new URL("/rest/v1/koper_staging_records", baseUrl);
  url.searchParams.set("select", "id");
  url.searchParams.set("company_id", `eq.${env.BOSSA_COMPANY_ID}`);
  url.searchParams.set("limit", "1");

  const response = await fetch(url, {
    method: "GET",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`Supabase staging indisponível (HTTP ${response.status})`);
  }

  const rows: unknown = await response.json();
  if (!Array.isArray(rows)) throw new Error("Resposta inválida da staging do Koper");

  return {
    reachable: true,
    companyId: env.BOSSA_COMPANY_ID,
    sampledRows: rows.length,
  };
}
