import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const COMPANY_OVERVIEW_COOKIE = "__company_overview__";
const COMPANY_OVERVIEW_QUERY = "workspace";

function safeReturnPath(value: FormDataEntryValue | null) {
  const raw = String(value ?? "").trim();
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/dashboard";

  try {
    const url = new URL(raw, "https://elos.local");
    if (url.origin !== "https://elos.local") return "/dashboard";
    if (url.pathname === "/login" || url.pathname.startsWith("/auth/")) return "/dashboard";
    return `${url.pathname}${url.search}`;
  } catch {
    return "/dashboard";
  }
}

function redirectTo(request: NextRequest, returnTo: string, message?: string) {
  const url = new URL(returnTo, request.nextUrl.origin);
  if (message) url.searchParams.set("error", message);
  return NextResponse.redirect(url, 303);
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const companyId = String(formData.get("company_id") ?? "").trim();
  const projectId = String(formData.get("project_id") ?? "").trim();
  const returnTo = safeReturnPath(formData.get("return_to"));

  if (!companyId) {
    return redirectTo(request, returnTo, "Selecione uma empresa.");
  }

  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getClaims();
  const userId = typeof authData?.claims?.sub === "string" ? authData.claims.sub : "";

  if (authError || !userId) {
    return NextResponse.redirect(new URL("/login", request.nextUrl.origin), 303);
  }

  const { data: membership, error: membershipError } = await supabase
    .from("company_memberships")
    .select("id")
    .eq("user_id", userId)
    .eq("company_id", companyId)
    .eq("status", "active")
    .maybeSingle();

  if (membershipError || !membership) {
    return redirectTo(request, returnTo, "Você não possui acesso ativo a esta empresa.");
  }

  if (projectId) {
    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select("id")
      .eq("id", projectId)
      .eq("company_id", companyId)
      .neq("status", "archived")
      .maybeSingle();

    if (projectError || !project) {
      return redirectTo(request, returnTo, "A obra selecionada não pertence à empresa ou está arquivada.");
    }
  }

  const targetUrl = new URL(returnTo, request.nextUrl.origin);
  if (projectId) {
    targetUrl.searchParams.delete(COMPANY_OVERVIEW_QUERY);
  } else {
    targetUrl.searchParams.set(COMPANY_OVERVIEW_QUERY, "company");
  }

  const response = NextResponse.redirect(targetUrl, 303);
  const cookieOptions = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  };

  response.cookies.set("elos_company_id", companyId, cookieOptions);
  response.cookies.set("elos_project_id", projectId || COMPANY_OVERVIEW_COOKIE, cookieOptions);
  response.headers.set("Cache-Control", "no-store, max-age=0");

  return response;
}
