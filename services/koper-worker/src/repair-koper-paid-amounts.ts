import { env } from "./config/env.js";
import { requestSupabase } from "./elos/supabase.js";

type Row = {
  id: string;
  amount: number;
  paid_amount: number | null;
  status: string;
  source_id: string | null;
};

async function readAll<T>(table: string, query: Record<string, string>): Promise<T[]> {
  const result: T[] = [];
  for (let offset = 0; ; offset += 1_000) {
    const page = await requestSupabase<T[]>(table, {
      query: new URLSearchParams({ ...query, limit: "1000", offset: String(offset) }),
      timeoutMs: 30_000,
    });
    result.push(...page);
    if (page.length < 1_000) return result;
  }
}

if (process.env.KOPER_PAYABLE_REPAIR_RUN !== "true") {
  console.log("KOPER_PAYABLE_REPAIR_SKIPPED", JSON.stringify({ reason: "RUN_DISABLED" }));
} else {
  try {
    const writeEnabled = process.env.KOPER_PAYABLE_REPAIR_WRITE_ENABLED === "true";
    const rows = await readAll<Row>("payables", {
      select: "id,amount,paid_amount,status,source_id",
      company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      source_system: "eq.koper_flow",
      status: "eq.paid",
      order: "id.asc",
    });
    const targets = rows.filter(
      (row) => !(Number(row.paid_amount) > 0) && Number(row.amount) > 0,
    );

    if (!writeEnabled) {
      console.log("KOPER_PAYABLE_REPAIR_PLAN", JSON.stringify({
        ok: true,
        writeEnabled: false,
        targets: targets.map((row) => ({
          id: row.id,
          sourceId: row.source_id,
          amount: row.amount,
          paidAmount: row.paid_amount,
        })),
      }));
    } else {
      for (const row of targets) {
        await requestSupabase("payables", {
          method: "PATCH",
          body: { paid_amount: Number(row.amount), updated_at: new Date().toISOString() },
          query: new URLSearchParams({
            id: `eq.${row.id}`,
            company_id: `eq.${env.BOSSA_COMPANY_ID}`,
          }),
          prefer: "return=minimal",
          timeoutMs: 30_000,
        });
      }
      const verified = await readAll<Row>("payables", {
        select: "id,amount,paid_amount,status,source_id",
        company_id: `eq.${env.BOSSA_COMPANY_ID}`,
        source_system: "eq.koper_flow",
        status: "eq.paid",
        order: "id.asc",
      });
      console.log("KOPER_PAYABLE_REPAIR_RESULT", JSON.stringify({
        ok: true,
        repaired: targets.length,
        remaining: verified.filter((row) => !(Number(row.paid_amount) > 0)).length,
      }));
    }
  } catch (error: unknown) {
    console.error("KOPER_PAYABLE_REPAIR_ERROR", {
      message: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
  }
}
