import "server-only";

import { createClient } from "@supabase/supabase-js";
import { getSupabaseConfig } from "@/lib/supabase/config";

/** Cliente exclusivo do servidor, usado somente após autorização de plataforma. */
export function createAuthAdminClient() {
  const secret = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!secret) {
    throw new Error("A chave secreta do Supabase não está configurada no servidor.");
  }

  const { url } = getSupabaseConfig();
  return createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
