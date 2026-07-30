import { NextRequest, NextResponse } from "next/server";
import { resolveActiveWorkspace } from "@/lib/workspace";

const ALLOWED_DESTINATIONS = [
  "/empreendimentos",
  "/engenharia",
  "/execucao",
  "/suprimentos",
  "/financeiro",
  "/comercial",
  "/pos-obra",
  "/cadastros",
  "/configuracoes",
];

function safeDestination(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return null;
  return ALLOWED_DESTINATIONS.some((prefix) => value === prefix || value.startsWith(`${prefix}/`) || value.startsWith(`${prefix}?`))
    ? value
    : null;
}

export async function GET(request: NextRequest) {
  const { supabase, companyId } = await resolveActiveWorkspace();
  const projectId = request.nextUrl.searchParams.get("project_id") ?? "";
  const destination = safeDestination(request.nextUrl.searchParams.get("dest"));

  if (!projectId || !destination) {
    return NextResponse.redirect(new URL("/dashboard?error=Resultado%20de%20busca%20inválido.", request.url));
  }

  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("company_id", companyId)
    .neq("status", "archived")
    .maybeSingle();

  if (!project) {
    return NextResponse.redirect(new URL("/dashboard?error=Você%20não%20possui%20acesso%20a%20este%20empreendimento.", request.url));
  }

  const response = NextResponse.redirect(new URL(destination, request.url));
  response.cookies.set("elos_project_id", projectId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return response;
}
