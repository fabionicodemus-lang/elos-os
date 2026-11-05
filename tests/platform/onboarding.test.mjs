import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";
import {
  getPlatformInvitationRedirect,
  isValidEmail,
  normalizeCompanySlug,
  PLATFORM_ROLE_OPTIONS,
} from "../../lib/platform-onboarding.ts";

test("normaliza razão social com acentos para slug válido", () => {
  assert.equal(normalizeCompanySlug("Construtora São José Ltda."), "construtora-sao-jose-ltda");
  assert.equal(normalizeCompanySlug("  ALMA & Bossa  "), "alma-bossa");
  assert.equal(normalizeCompanySlug("!!!"), "");
});

test("aceita somente emails plausíveis e não excessivos", () => {
  assert.equal(isValidEmail("diretoria@construtora.com.br"), true);
  assert.equal(isValidEmail("nao-tem-arroba"), false);
  assert.equal(isValidEmail("a@b"), false);
  assert.equal(isValidEmail("a".repeat(245) + "@dominio.com"), false);
});

test("papel de proprietário não pode ser concedido pelo formulário de novos acessos", () => {
  assert.equal(PLATFORM_ROLE_OPTIONS.some((role) => role.key === "owner"), false);
  assert.equal(PLATFORM_ROLE_OPTIONS.some((role) => role.key === "admin"), true);
});

const savedSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;
after(() => {
  if (savedSiteUrl === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = savedSiteUrl;
});

test("convite utiliza somente HTTPS oficial ou localhost no desenvolvimento", () => {
  process.env.NEXT_PUBLIC_SITE_URL = "https://app.elos.exemplo.br";
  assert.equal(getPlatformInvitationRedirect(), "https://app.elos.exemplo.br/convite");
  process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
  assert.equal(getPlatformInvitationRedirect(), "http://localhost:3000/convite");
  process.env.NEXT_PUBLIC_SITE_URL = "http://site-inseguro.exemplo.br";
  assert.equal(getPlatformInvitationRedirect(), null);
  process.env.NEXT_PUBLIC_SITE_URL = "invalid";
  assert.equal(getPlatformInvitationRedirect(), null);
});

test("RPCs de onboarding exigem administrador global e grants explícitos", () => {
  const sql = readFileSync(
    new URL("../../supabase/migrations/20261105120000_platform_admin_invites.sql", import.meta.url),
    "utf8",
  );
  for (const name of [
    "platform_create_environment", "platform_lookup_user",
    "platform_add_company_member", "platform_list_company_members",
  ]) {
    const start = sql.indexOf(`create or replace function public.${name}(`);
    assert.ok(start >= 0, `${name} deve existir`);
    const end = sql.indexOf("$$;", start);
    const definition = sql.slice(start, end);
    assert.match(definition, /security definer/i);
    assert.match(definition, /not public\.is_platform_admin\(\)/i);
    assert.match(sql, new RegExp(`revoke all on function public\\.${name}\\(`, "i"));
  }
  assert.match(sql, /alter table public\.platform_membership_audit enable row level security/i);
  assert.match(sql, /if p_role_key = 'owner' then/i);
});
