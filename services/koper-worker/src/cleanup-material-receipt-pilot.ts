import { createHash } from "node:crypto";
import { env } from "./config/env.js";
import { requestSupabase } from "./elos/supabase.js";

function stableUuid(seed: string): string {
  const bytes = Buffer.from(createHash("sha256").update(seed).digest("hex").slice(0, 32), "hex");
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

await import("./index.js");

try {
  const receiptId = "f3f4181d-4af3-5633-b85d-7400e3594cd1";
  const receipts = await requestSupabase<Array<{ id: string; status: string; notes: string | null }>>(
    "procurement_material_receipts",
    { query: new URLSearchParams({
      select: "id,status,notes", id: `eq.${receiptId}`,
      company_id: `eq.${env.BOSSA_COMPANY_ID}`, limit: "1",
    }) },
  );
  const receipt = receipts[0];
  if (!receipt) throw new Error("Pilot receipt not found");
  if (receipt.status !== "draft" || !/Koper stockMovementId=13373/i.test(receipt.notes ?? "")) {
    throw new Error("Refusing to modify a non-pilot or non-draft receipt");
  }

  const items = await requestSupabase<Array<{ id: string; order_item_id: string; notes: string | null }>>(
    "procurement_material_receipt_items",
    { query: new URLSearchParams({
      select: "id,order_item_id,notes", receipt_id: `eq.${receiptId}`, limit: "10",
    }) },
  );
  if (items.length !== 1 || !items[0]) throw new Error("Pilot receipt item is not unique");
  const movementId = /productMovementId=(\d+)/i.exec(items[0].notes ?? "")?.[1];
  if (!movementId) throw new Error("Pilot movement identity is unavailable");
  const targetId = stableUuid(`elos:koper:receipt:${receiptId}:movements:${movementId}:order-item:${items[0].order_item_id}`);

  if (items[0].id !== targetId) {
    await requestSupabase("procurement_material_receipt_items", {
      method: "PATCH",
      body: { id: targetId, updated_at: new Date().toISOString() },
      query: new URLSearchParams({ id: `eq.${items[0].id}`, receipt_id: `eq.${receiptId}` }),
      prefer: "return=minimal",
    });
  }

  const verify = await requestSupabase<Array<{ id: string }>>("procurement_material_receipt_items", {
    query: new URLSearchParams({ select: "id", receipt_id: `eq.${receiptId}`, id: `eq.${targetId}`, limit: "1" }),
  });
  if (verify.length !== 1) throw new Error("Pilot identity alignment verification failed");
  console.log("KOPER_MATERIAL_RECEIPT_PILOT_ALIGNMENT_RESULT", JSON.stringify({
    ok: true, receiptId, previousItemId: items[0].id, targetItemId: targetId,
    changed: items[0].id !== targetId,
  }));
} catch (error: unknown) {
  console.error("KOPER_MATERIAL_RECEIPT_PILOT_ALIGNMENT_FAILED", {
    message: error instanceof Error ? error.message.slice(0, 800) : "unknown",
  });
}
