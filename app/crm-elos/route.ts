const LEGACY_CRM_SOURCE =
  "https://raw.githubusercontent.com/fabionicodemus-lang/elos-os/crm-elos-task-dates-20260930/deployments/crm-elos/index.html";

const LEGACY_SUPABASE_URL = "https://ivvfguxijohxyiykacnd.supabase.co";
const LEGACY_SUPABASE_KEY = "sb_publishable_dCyqNgp56RnuCdXIf0Dbog_1kifoWcH";

export const dynamic = "force-dynamic";

export async function GET() {
  const configuredSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!configuredSupabaseUrl || !supabaseKey) {
    return new Response("Configuração do Supabase do Elos OS não encontrada.", {
      status: 500,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  // O Elos OS mantém a URL do REST em alguns ambientes. O supabase-js
  // precisa receber a URL-base do projeto para Auth + REST funcionarem juntos.
  const supabaseUrl = configuredSupabaseUrl
    .replace(/\/rest\/v1\/?$/, "")
    .replace(/\/$/, "");

  const source = await fetch(LEGACY_CRM_SOURCE, { cache: "no-store" });
  if (!source.ok) {
    return new Response("Não foi possível carregar a interface do CRM Elos.", {
      status: 502,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  let html = await source.text();
  html = html
    .replace(LEGACY_SUPABASE_URL, supabaseUrl)
    .replace(LEGACY_SUPABASE_KEY, supabaseKey);

  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store, max-age=0",
    },
  });
}
