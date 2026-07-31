import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function requirePlatformAdmin() {
  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getClaims();

  if (authError || !authData?.claims) {
    redirect("/login");
  }

  const { data: allowed, error } = await supabase.rpc("is_platform_admin");

  if (error || allowed !== true) {
    notFound();
  }

  return {
    supabase,
    userId: typeof authData.claims.sub === "string" ? authData.claims.sub : "",
    email: typeof authData.claims.email === "string" ? authData.claims.email : "Administrador",
  };
}
