export const PLATFORM_ROLE_OPTIONS = [
  { key: "admin", label: "Administrador da construtora" },
  { key: "director", label: "Diretoria" },
  { key: "engineering", label: "Engenharia" },
  { key: "finance", label: "Financeiro" },
  { key: "commercial", label: "Comercial" },
  { key: "field", label: "Equipe de obra" },
  { key: "viewer", label: "Somente consulta" },
] as const;

export function normalizeCompanySlug(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function isValidEmail(email: string) {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function getPlatformInvitationRedirect() {
  const value = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!value) return null;

  try {
    const origin = new URL(value);
    if (origin.protocol !== "https:" &&
      !(origin.protocol === "http:" && ["localhost", "127.0.0.1"].includes(origin.hostname))) {
      return null;
    }
    return new URL("/convite", origin.origin).toString();
  } catch {
    return null;
  }
}
