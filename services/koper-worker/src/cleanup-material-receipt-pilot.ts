import { env } from "./config/env.js";
import { requestSupabase } from "./elos/supabase.js";

await import("./index.js");

try {
  const receiptId = "f3f4181d-4af3-5633-b85d-7400e3594cd1";
  const rows = await requestSupabase<Array<{ id: string; status: string; notes: string | null }>>(
    "procurement_material_receipts",
    { query: new URLSearchParams({
      select: "id,status,notes",
      id: `eq.${receiptId}`,
      company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      limit: "1",
    }) },
  );
  const row = rows[0];
  if (!row) {
    console.log("KOPER_MATERIAL_RECEIPT_PILOT_CLEANUP_RESULT", JSON.stringify({ ok: true, removed: false, reason: "NOT_FOUND" }));
  } else {
    if (row.status !== "draft" || !/Koper stockMovementId=13373/i.test(row.notes ?? "")) {
      throw new Error("Refusing to remove a non-pilot or non-draft receipt");
    }
    await requestSupabase("procurement_material_receipt_items", {
      method: "DELETE",
      query: new URLSearchParams({ receipt_id: `eq.${receiptId}` }),
      prefer: "return=minimal",
    });
    await requestSupabase("procurement_material_receipts", {
      method: "DELETE",
      query: new URLSearchParams({ id: `eq.${receiptId}`, company_id: `eq.${env.BOSSA_COMPANY_ID}` }),
      prefer: "return=minimal",
    });
    const verify = await requestSupabase<Array<{ id: string }>>("procurement_material_receipts", {
      query: new URLSearchParams({ select: "id", id: `eq.${receiptId}`, limit: "1" }),
    });
    if (verify.length !== 0) throw new Error("Pilot cleanup verification failed");
    console.log("KOPER_MATERIAL_RECEIPT_PILOT_CLEANUP_RESULT", JSON.stringify({ ok: true, removed: true, receiptId }));
  }
} catch (error: unknown) {
  console.error("KOPER_MATERIAL_RECEIPT_PILOT_CLEANUP_FAILED", {
    message: error instanceof Error ? error.message.slice(0, 800) : "unknown",
  });
}
