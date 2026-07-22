function cleanEnvironmentValue(value: string | undefined) {
  const cleaned = value?.trim();

  if (!cleaned) {
    return "";
  }

  const hasWrappingQuotes =
    (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
    (cleaned.startsWith("'") && cleaned.endsWith("'"));

  return hasWrappingQuotes ? cleaned.slice(1, -1).trim() : cleaned;
}

export function getSupabaseConfig() {
  const rawUrl = cleanEnvironmentValue(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = cleanEnvironmentValue(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

  if (!rawUrl || !key) {
    throw new Error(
      "As variáveis NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY não estão configuradas.",
    );
  }

  let parsedUrl: URL;

  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL deve ser uma URL válida, como https://projeto.supabase.co.",
    );
  }

  if (!['https:', 'http:'].includes(parsedUrl.protocol)) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL deve começar com https://.");
  }

  return {
    // O cliente Supabase espera o endereço-base. Caminhos colados por engano são removidos.
    url: parsedUrl.origin,
    key,
  };
}
