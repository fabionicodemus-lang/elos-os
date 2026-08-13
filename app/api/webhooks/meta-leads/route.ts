import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  extractLeadEvents,
  fetchMetaLeadDetails,
  normalizePhone,
  parseLeadFieldData,
  verifyMetaSignature,
  type MetaWebhookPayload,
} from "@/lib/meta/leads";

// Precisamos de Node.js: usamos node:crypto (assinatura) e a service_role do Supabase.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// -----------------------------------------------------------------------------
// Mapeamento da tabela de leads do Bossa CRM.
// A migration 20260813_0081_bossa_crm_meta_leads.sql cria a tabela `crm_leads`
// e as colunas usadas aqui. Se o nome da tabela ou das colunas mudar, ajuste
// LEADS_TABLE e o objeto `row` montado em processLead().
// -----------------------------------------------------------------------------
const LEADS_TABLE = "crm_leads";
const LEAD_ORIGIN = "meta_lead_ads";
const LEAD_DEFAULT_STATUS = "novo";

function getServiceClient(): SupabaseClient {
  const url = (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();

  if (!url) {
    throw new Error("Variável de ambiente ausente: SUPABASE_URL (ou NEXT_PUBLIC_SUPABASE_URL).");
  }
  if (!serviceKey) {
    throw new Error("Variável de ambiente ausente: SUPABASE_SERVICE_ROLE_KEY.");
  }

  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// -----------------------------------------------------------------------------
// GET — verificação (handshake) do webhook feita pela Meta.
// https://developers.facebook.com/docs/graph-api/webhooks/getting-started#verification-requests
// -----------------------------------------------------------------------------
export function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");
  const verifyToken = (process.env.META_VERIFY_TOKEN ?? "").trim();

  if (mode === "subscribe" && verifyToken && token === verifyToken) {
    return new NextResponse(challenge ?? "", {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }

  return new NextResponse("Forbidden", { status: 403 });
}

// -----------------------------------------------------------------------------
// POST — recebe as notificações de novos leads.
// -----------------------------------------------------------------------------
export async function POST(request: NextRequest) {
  // O corpo cru é obrigatório para validar a assinatura HMAC.
  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256");
  const appSecret = (process.env.META_APP_SECRET ?? "").trim();

  if (!appSecret) {
    console.error("[meta-leads] META_APP_SECRET não configurado.");
    return NextResponse.json({ error: "webhook not configured" }, { status: 500 });
  }

  if (!verifyMetaSignature(rawBody, signature, appSecret)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let payload: MetaWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as MetaWebhookPayload;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const events = extractLeadEvents(payload);
  if (events.length === 0) {
    // Nada de leads neste payload (ex.: outro tipo de evento). Confirmamos o recebimento.
    return NextResponse.json({ received: true, processed: 0 }, { status: 200 });
  }

  // A partir daqui respondemos sempre 200 para a Meta não reenfileirar em loop.
  // Falhas de processamento ficam registradas no log para reprocessamento manual.
  const companyId = (process.env.BOSSA_COMPANY_ID ?? "").trim();
  const pageToken = (process.env.META_PAGE_ACCESS_TOKEN ?? "").trim();

  if (!companyId || !pageToken) {
    console.error("[meta-leads] BOSSA_COMPANY_ID ou META_PAGE_ACCESS_TOKEN não configurados.");
    return NextResponse.json({ received: true, processed: 0 }, { status: 200 });
  }

  let supabase: SupabaseClient;
  try {
    supabase = getServiceClient();
  } catch (error) {
    console.error("[meta-leads] cliente Supabase indisponível:", error);
    return NextResponse.json({ received: true, processed: 0 }, { status: 200 });
  }

  let processed = 0;
  for (const event of events) {
    try {
      const details = await fetchMetaLeadDetails(event.leadgenId, pageToken);
      const parsed = parseLeadFieldData(details.field_data);

      const row = {
        company_id: companyId,
        nome: parsed.nome,
        email: parsed.email,
        telefone: normalizePhone(parsed.telefoneBruto),
        status: LEAD_DEFAULT_STATUS,
        origem: LEAD_ORIGIN,
        projeto:
          parsed.respostas["projeto"] ??
          parsed.respostas["empreendimento"] ??
          null,
        mensagem_recebida: parsed.mensagem,
        respostas: parsed.respostas,
        meta_leadgen_id: event.leadgenId,
        meta_form_id: event.formId ?? details.form_id ?? null,
        meta_ad_id: event.adId ?? details.ad_id ?? null,
      };

      // Idempotência: dedupe pelo índice único em meta_leadgen_id.
      // ignoreDuplicates evita sobrescrever um lead já triado manualmente na
      // hipótese de reentrega do mesmo evento pela Meta.
      const { error } = await supabase
        .from(LEADS_TABLE)
        .upsert(row, { onConflict: "meta_leadgen_id", ignoreDuplicates: true });

      if (error) {
        console.error(`[meta-leads] erro ao gravar lead ${event.leadgenId}:`, error.message);
        continue;
      }

      processed += 1;
    } catch (error) {
      console.error(`[meta-leads] falha ao processar lead ${event.leadgenId}:`, error);
    }
  }

  return NextResponse.json({ received: true, processed }, { status: 200 });
}
