"use server";

import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseConfig } from "@/lib/supabase/config";

export async function logoutInactiveSession(expectedSessionId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  // An old tab must not log out a newer login in another tab.
  if (!error && data?.claims && data.claims.session_id !== expectedSessionId) return "changed";
  await supabase.auth.signOut({ scope: "local" });
  const store = await cookies();
  const { url } = getSupabaseConfig();
  const authCookie = `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;
  for (const cookie of store.getAll()) {
    if (cookie.name === authCookie || cookie.name.startsWith(`${authCookie}.`) || cookie.name === `${authCookie}-code-verifier`) {
      store.delete(cookie.name);
    }
  }
  store.delete("elos_company_id");
  store.delete("elos_project_id");
  return "expired";
}
