import { NextRequest, NextResponse } from "next/server";
import { answerElosIaQuestion } from "@/lib/elos-ia/server";
import { createClient } from "@/lib/supabase/server";

// Uma pergunta pode fazer várias idas à OpenAI e ao banco.
export const maxDuration = 120;

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
}

function sameHost(origin: string, host: string) {
  try {
    return new URL(origin).host === host.split(",")[0].trim();
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  // Aceita apenas chamadas feitas pela própria tela do Elos OS.
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (origin && host && !sameHost(origin, host)) {
    return json({ ok: false, error: "Origem não permitida." }, 403);
  }
  if (!(request.headers.get("content-type") ?? "").includes("application/json")) {
    return json({ ok: false, error: "Formato de requisição inválido." }, 415);
  }

  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getClaims();
  if (authError || typeof authData?.claims?.sub !== "string") {
    return json({ ok: false, error: "Sua sessão expirou. Entre novamente no Elos OS." }, 401);
  }

  const body = (await request.json().catch(() => null)) as { persona?: unknown; question?: unknown; history?: unknown } | null;
  if (!body || typeof body !== "object") {
    return json({ ok: false, error: "Formato de requisição inválido." }, 400);
  }

  const answer = await answerElosIaQuestion({ persona: body.persona, question: body.question, history: body.history });
  if (!answer.ok) return json({ ok: false, error: answer.error, quota: answer.quota ?? null }, answer.status);
  return json(answer);
}
