const LEGACY_CRM_SOURCE =
  "https://raw.githubusercontent.com/fabionicodemus-lang/elos-os/crm-elos-task-dates-20260930/deployments/crm-elos/index.html";

const LEGACY_SUPABASE_URL = "https://ivvfguxijohxyiykacnd.supabase.co";
const LEGACY_SUPABASE_KEY = "sb_publishable_dCyqNgp56RnuCdXIf0Dbog_1kifoWcH";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const configuredSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!configuredSupabaseUrl || !supabaseKey) {
    return new Response("Configuração do Supabase do Elos OS não encontrada.", {
      status: 500,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

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

  const url = new URL(request.url);
  const passwordChanged = url.searchParams.get("senha") === "alterada";

  let html = await source.text();
  html = html
    .replace(LEGACY_SUPABASE_URL, supabaseUrl)
    .replace(LEGACY_SUPABASE_KEY, supabaseKey)
    .replace(
      "</form>\n  </div>\n</div>\n<div class=\"app\"",
      `</form>
      <a href="/login?from=crm" style="display:block;text-align:center;margin-top:12px;font-size:13px;font-weight:700;color:#00615c;text-decoration:none">Esqueci minha senha</a>
      ${passwordChanged ? '<p style="margin:12px 0 0;text-align:center;color:#217A50;font-size:13px;font-weight:700">Senha alterada. Entre abaixo com a nova senha.</p>' : ""}
  </div>
</div>
<div class="app"`,
    );

  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store, max-age=0",
    },
  });
}
