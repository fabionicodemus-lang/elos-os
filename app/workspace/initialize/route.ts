import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const WORKSPACE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

function safeDestination(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/dashboard";
  if (value.startsWith("/workspace/initialize")) return "/dashboard";
  return value;
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getClaims();

  if (authError || !authData?.claims) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const userId = typeof authData.claims.sub === "string" ? authData.claims.sub : "";
  const { data: membership } = await supabase
    .from("company_memberships")
    .select("company_id")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!membership?.company_id) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("company_id", membership.company_id)
    .neq("status", "archived")
    .order("name", { ascending: true })
    .limit(1)
    .maybeSingle();

  const destination = safeDestination(request.nextUrl.searchParams.get("next"));
  const response = NextResponse.redirect(new URL(destination, request.url));
  const cookieOptions = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: request.nextUrl.protocol === "https:",
    path: "/",
    maxAge: WORKSPACE_COOKIE_MAX_AGE,
  };

  response.cookies.set("elos_company_id", membership.company_id, cookieOptions);

  if (project?.id) {
    response.cookies.set("elos_project_id", project.id, cookieOptions);
  } else {
    response.cookies.set("elos_project_id", "", { ...cookieOptions, maxAge: 0 });
  }

  response.headers.set("Cache-Control", "no-store");
  return response;
}
