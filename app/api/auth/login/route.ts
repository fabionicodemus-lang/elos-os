import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

function loginRedirect(request: Request, message: string) {
  const url = new URL("/login", request.url);
  url.searchParams.set("error", message);
  return NextResponse.redirect(url, 303);
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return loginRedirect(request, "Informe o e-mail e a senha.");
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return loginRedirect(request, "E-mail ou senha inválidos.");
  }

  return NextResponse.redirect(new URL("/dashboard", request.url), 303);
}
