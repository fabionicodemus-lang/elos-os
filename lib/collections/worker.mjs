// Server-only integration boundary. Call from an authenticated scheduler with a
// privileged Supabase client and a specifically homologated adapter. There is no
// default/fake production adapter and no dispatch from the browser.

const unwrap = (result) => {
  if (result.error) throw new Error(result.error.message);
  return result.data;
};
const money = value => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value));
const date = value => value.split("-").reverse().join("/");

export function collectionDocumentMessage({ collection, message, context }) {
  const prefix = message.purpose === "d-1" ? "Lembrete: sua parcela vence amanhã." : message.purpose === "d0" ? "Lembrete: sua parcela vence hoje." : "Segue o boleto registrado da sua parcela.";
  return {
    channel: message.channel,
    to: message.recipient,
    from: message.sender,
    idempotencyKey: message.id,
    subject: `${collection.beneficiary_name} · ${context.project} · ${context.unit}`,
    text: `${prefix}\nBeneficiário: ${collection.beneficiary_name} — CNPJ ${collection.beneficiary_cnpj}\nEmpreendimento: ${context.project}\nUnidade: ${context.unit}\nParcela: ${context.installment}\nValor: ${money(collection.amount)}\nVencimento: ${date(collection.due_date)}.`,
    documentRef: collection.document_ref,
    filename: "boleto.pdf",
  };
}

/** Adapter contract: register/cancel use collection.id as the stable external
 * reference and must search/recover before retrying. refreshReconciliation must
 * finish importing and reconciling the bank feed before returning true. Sender
 * must resolve the private documentRef and deliver PDF bytes as an attachment,
 * never a client portal. Never consider a timeout a confirmed failure. */
export async function runCollectionCycle({ db, configId, adapter, limit = 50, cursor = null }) {
  if (!adapter || typeof adapter.refreshReconciliation !== "function") throw new Error("Adaptador homologado obrigatório.");
  if (adapter.environment === "sandbox") throw new Error("Adaptador de sandbox não pode operar a carteira financeira.");
  const config = unwrap(await db.from("finance_collection_configs").select("*").eq("id", configId).maybeSingle());
  if (!config?.bank_verified || config.provider !== adapter.provider) return { processed: 0, blocked: true };
  const size = Math.min(100, Math.max(1, limit));
  let query = db.from("finance_collections").select("*").eq("config_id", configId).in("status", ["registration_requested", "registered", "cancellation_requested"]).order("id").limit(size);
  if (cursor) query = query.gt("id", cursor);
  const charges = unwrap(await query);
  const report = { processed: 0, pending: 0, blocked: false, nextCursor: charges.length === size ? charges.at(-1).id : null };
  for (const c of charges) {
    try {
      if (c.status === "registration_requested" && unwrap(await db.rpc("collection_registration_ready", { p_id: c.id }))) {
        const result = await adapter.register(c, { externalReference: c.id });
        if (result?.status === "registered" || result?.status === "failed") unwrap(await db.rpc("collection_bank_result", { p_id: c.id, p_status: result.status, p_identifier: result.identifier ?? null, p_document_ref: result.documentRef ?? null, p_detail: result.detail ?? null }));
      } else if (c.status === "cancellation_requested") {
        if (await adapter.cancel(c, { externalReference: c.id }) === true) unwrap(await db.rpc("collection_bank_result", { p_id: c.id, p_status: "cancelled", p_identifier: c.bank_identifier, p_document_ref: c.document_ref, p_detail: null }));
      }
      unwrap(await db.rpc("collection_schedule", { p_id: c.id }));
      const messages = unwrap(await db.from("finance_collection_messages").select("id").eq("collection_id", c.id).eq("status", "pending").lte("scheduled_at", new Date().toISOString()).order("scheduled_at").limit(6));
      for (const m of messages) {
        if (!await adapter.refreshReconciliation(config)) { report.pending++; continue; }
        unwrap(await db.rpc("collection_mark_reconciled", { p_id: configId }));
        const claim = unwrap(await db.rpc("collection_claim_message", { p_id: m.id }));
        if (!claim) continue;
        // On uncertain outcome leave dispatching and require provider lookup, not retry.
        const sent = await adapter.sendDocument(collectionDocumentMessage(claim));
        if (sent?.status === "sent" || sent?.status === "failed") unwrap(await db.rpc("collection_message_event", {
          p_id: m.id, p_event_id: sent.eventId, p_event: sent.status, p_occurred: sent.occurredAt, p_automatic: null, p_reason: sent.reason ?? null, p_provider_id: sent.providerMessageId ?? null,
        }));
      }
      report.processed++;
    } catch {
      // Do not log PII, documents, provider response bodies or secrets. State and
      // correlation IDs remain available in the central for manual reconciliation.
      report.pending++;
    }
  }
  return report;
}
