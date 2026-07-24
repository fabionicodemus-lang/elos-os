"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

function loginUrl(message: string, type: "error" | "success" = "error") {
  const params = new URLSearchParams({ [type]: message });
  return `/login?${params.toString()}`;
}

function cleanUrlCandidate(value: string | null | undefined) {
  const cleaned = value?.trim();

  if (!cleaned) {
    return undefined;
  }

  const hasWrappingQuotes =
    (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
    (cleaned.startsWith("'") && cleaned.endsWith("'"));

  return hasWrappingQuotes ? cleaned.slice(1, -1).trim() : cleaned;
}

async function getEmailRedirectTo() {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const protocol =
    requestHeaders.get("x-forwarded-proto") ??
    (host?.startsWith("localhost") ? "http" : "https");

  const candidates = [
    cleanUrlCandidate(process.env.NEXT_PUBLIC_SITE_URL),
    cleanUrlCandidate(requestHeaders.get("origin")),
    host ? `${protocol}://${host}` : undefined,
    process.env.VERCEL_URL
      ? `https://${cleanUrlCandidate(process.env.VERCEL_URL)}`
      : undefined,
  ];

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    try {
      const siteUrl = new URL(candidate);

      if (!["https:", "http:"].includes(siteUrl.protocol)) {
        continue;
      }

      return new URL("/auth/confirm", siteUrl.origin).toString();
    } catch {
      // Tenta o próximo endereço disponível.
    }
  }

  return undefined;
}

function friendlySignupError(message: string) {
  const normalized = message.toLowerCase();

  if (normalized.includes("invalid path specified")) {
    return "Não foi possível concluir o cadastro por causa da configuração do endereço. Atualize a página e tente novamente.";
  }

  if (normalized.includes("already registered")) {
    return "Este e-mail já possui cadastro. Use o botão Entrar.";
  }

  if (normalized.includes("password")) {
    return "A senha não atende aos requisitos de segurança do Supabase.";
  }

  return "Não foi possível criar o acesso. Verifique os dados e tente novamente.";
}

export async function login(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    redirect(loginUrl("Informe o e-mail e a senha."));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    redirect(loginUrl("E-mail ou senha inválidos."));
  }

  // Em um aparelho ou domínio novo ainda não existem os cookies da empresa e da obra.
  // A rota de inicialização grava o primeiro ambiente disponível antes de abrir o dashboard.
  redirect("/workspace/initialize");
}

export async function signup(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || password.length < 8) {
    redirect(loginUrl("Use um e-mail válido e uma senha com pelo menos 8 caracteres."));
  }

  const emailRedirectTo = await getEmailRedirectTo();
  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    ...(emailRedirectTo
      ? {
          options: {
            emailRedirectTo,
          },
        }
      : {}),
  });

  if (error) {
    redirect(loginUrl(friendlySignupError(error.message)));
  }

  redirect(
    loginUrl(
      "Cadastro criado. Verifique seu e-mail para confirmar o acesso.",
      "success",
    ),
  );
}
