import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getAsaasWebhookToken, normalizeAsaasWebhook, type AsaasConnection } from "@/lib/banking/asaas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function serviceClient() {
  const url = (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const key = (process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (!url || !key) throw new Error("Supabase server-side não configurado.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function sameSecret(received: string | null, expected: string | null) {
  if (!received || !expected) return false;
  const left = Buffer.from(received, "utf8");
  const right = Buffer.from(expected, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function POST(request: NextRequest, context: { params: Promise<{ connectionId: string }> }) {
  const { connectionId } = await context.params;
  let db;
  try {
    db = serviceClient();
  } catch (error) {
    console.error("[banking/asaas] Supabase indisponível", error);
    return NextResponse.json({ error: "server_not_configured" }, { status: 500 });
  }

  const { data: connection, error: connectionError } = await db
    .from("finance_bank_connections")
    .select("id,provider,credential_ref,environment,status")
    .eq("id", connectionId)
    .eq("provider", "asaas")
    .eq("status", "active")
    .maybeSingle();

  if (connectionError || !connection) return NextResponse.json({ error: "connection_not_found" }, { status: 404 });

  const webhookToken = getAsaasWebhookToken(connection as AsaasConnection);
  if (!sameSecret(request.headers.get("asaas-access-token"), webhookToken)) {
    return NextResponse.json({ error: "invalid_webhook_token" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  let event;
  try {
    event = normalizeAsaasWebhook(payload);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "invalid_webhook" }, { status: 400 });
  }

  const { data, error } = await db.rpc("bank_apply_provider_event", {
    p_connection: connectionId,
    p_event_id: event.eventId,
    p_event_type: event.eventType,
    p_external_resource_id: event.paymentId,
    p_status: event.status,
    p_gross: event.gross,
    p_net: event.net,
    p_paid_date: event.paidDate,
    p_payload: event.raw,
  });

  if (error) {
    console.error("[banking/asaas] falha ao processar webhook", {
      connectionId,
      eventId: event.eventId,
      eventType: event.eventType,
      message: error.message,
    });
    return NextResponse.json({ error: "processing_failed" }, { status: 500 });
  }

  if (data === "charge_not_found") {
    // Retorno não-2xx para permitir nova entrega caso o webhook tenha chegado antes do registro local da cobrança.
    return NextResponse.json({ status: data }, { status: 503 });
  }

  return NextResponse.json({ received: true, status: data }, { status: 200 });
}
