import { timingSafeEqual } from "node:crypto";
import { createAuthAdminClient } from "@/lib/supabase/admin";
import { runCubSync } from "@/lib/cub-sc/source.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const given = new TextEncoder().encode(request.headers.get("authorization") ?? "");
  const expected = new TextEncoder().encode(`Bearer ${secret ?? ""}`);
  if (!secret || given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Preview deployments never operate production data, even with a shared key.
  if (process.env.VERCEL_ENV !== "production") return Response.json({ status: "disabled" });
  try {
    return Response.json(await runCubSync({ db: createAuthAdminClient() }), { headers: { "Cache-Control": "no-store" } });
  } catch {
    // Do not expose DB internals, credentials, or provider responses.
    console.error("cub_sc_sync_failed");
    return Response.json({ error: "cub_sc_sync_failed" }, { status: 503 });
  }
}
