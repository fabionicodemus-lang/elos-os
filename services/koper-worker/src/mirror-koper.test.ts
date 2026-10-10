import assert from "node:assert/strict";
import { test } from "node:test";

process.env.WORKER_API_KEY = "x".repeat(40);
process.env.KOPER_LOGIN_URL = "https://app.koper.com.br/login";
process.env.KOPER_USERNAME = "u";
process.env.KOPER_PASSWORD = "p";
process.env.BOSSA_COMPANY_ID = "11111111-1111-4111-8111-111111111111";

const { ENTITIES, mirrorEntity, sanitizeKoperPayload, isAllowedCompanySwitch } = await import("./mirror-koper.js");
type Row = Record<string, unknown>;

// ---- Supabase falso (só o que o espelho usa) -------------------------------
function fakeSupabase() {
  const table: Row[] = [];
  const calls = { get: 0, post: 0, patch: 0, del: 0 };
  const match = (row: Row, q: URLSearchParams) => {
    for (const [k, v] of q) {
      if (["select", "order", "limit", "offset", "on_conflict"].includes(k)) continue;
      const val = String(row[k]);
      if (v.startsWith("eq.")) { if (val !== v.slice(3)) return false; }
      else if (v.startsWith("like.")) { if (!val.startsWith(v.slice(5).replace(/\*$/, ""))) return false; }
      else if (v.startsWith("in.(")) { const ids = v.slice(4, -1).split(",").map((s) => s.replace(/^"|"$/g, "")); if (!ids.includes(val)) return false; }
      else throw new Error("filtro não suportado no teste: " + k + "=" + v);
    }
    return true;
  };
  const request = async (resource: string, o: { method?: string; query?: URLSearchParams; body?: unknown; prefer?: string } = {}) => {
    assert.equal(resource, "koper_staging_records");
    const q = o.query ?? new URLSearchParams();
    const method = o.method ?? "GET";
    if (method === "GET") {
      calls.get++;
      const rows = table.filter((r) => match(r, q)).sort((a, b) => String(a.koper_id).localeCompare(String(b.koper_id)));
      const off = Number(q.get("offset") ?? 0), lim = Number(q.get("limit") ?? 1000);
      return rows.slice(off, off + lim);
    }
    if (method === "POST") {
      calls.post++;
      const merge = (o.prefer ?? "").includes("merge-duplicates");
      for (const rec of o.body as Row[]) {
        const cur = table.find((r) => r.company_id === rec.company_id && r.entity === rec.entity && r.koper_id === rec.koper_id);
        if (!cur) table.push({ first_seen_at: "default", ...rec });
        else if (merge) Object.assign(cur, rec);
      }
      return undefined;
    }
    if (method === "PATCH") { calls.patch++; for (const r of table.filter((row) => match(row, q))) Object.assign(r, o.body as Row); return undefined; }
    calls.del++;
    throw new Error("o espelho nunca deve apagar");
  };
  return { table, calls, request: request as never };
}

// ---- Koper falso -----------------------------------------------------------
function fakeKoper(state: { bills: Row[]; details: Record<string, Row>; purchases: Row[]; receipts: Record<string, Row> }) {
  const seen: Array<{ method: string; path: string }> = [];
  globalThis.fetch = (async (input: URL | string, init?: RequestInit) => {
    const url = new URL(String(input));
    seen.push({ method: init?.method ?? "GET", path: url.pathname });
    assert.equal(init?.method, "GET");
    assert.equal(url.hostname, "api.koper.com.br");
    assert.equal(url.searchParams.get("accessToken"), "tok");
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    const p = url.searchParams;
    if (url.pathname === "/financial/v1/bills_to_pay") {
      if (p.has("billId")) { const d = state.details[p.get("billId")!]; return d ? json(d) : json({ code: 404 }, 404); }
      const off = Number(p.get("offset")), lim = Number(p.get("limit"));
      return json({ billsAmount: state.bills.length, bills: state.bills.slice(off, off + lim) });
    }
    if (url.pathname === "/purchase/v1/purchase") {
      if (p.has("purchaseId")) return json({ purchaseId: p.get("purchaseId"), services: [] });
      const off = Number(p.get("offset")), lim = Number(p.get("limit"));
      const page = state.purchases.slice(off, off + lim);
      return page.length ? json({ itemsAmount: state.purchases.length, purchases: page }) : json({ code: 404 }, 404);
    }
    if (url.pathname === "/financial/v1/receipt") { const r = state.receipts[p.get("receiptId")!]; return r ? json(r) : json({ code: 404 }, 404); }
    return json({ code: 404 }, 404);
  }) as typeof fetch;
  return seen;
}

const session = { company: "bossa" as const, token: "tok", headers: { "x-koper": "k", "x-accesstoken": "tok" } };
const spec = (name: string) => ENTITIES.find((e) => e.name === name)!;
const opts = { write: true, full: false, concurrency: 4, detailLimit: 0 };

test("carga inicial, repetição idempotente, alteração, sumiço e derivadas", async () => {
  const bills: Row[] = Array.from({ length: 1203 }, (_, i) => ({ billId: i + 1, billValue: 10 + i, isPaid: false }));
  const details: Record<string, Row> = Object.fromEntries(bills.map((b) => [String(b.billId), { bill_id: b.billId, cost_center: { id: 135 }, beneficiary: { cpf: "12345678901", cnpj: "28555255000130" }, origins: { receipt_id: Number(b.billId) <= 3 ? 900 + Number(b.billId) : null } }]));
  const state = { bills, details, purchases: [{ purchaseId: 1, receiptId: 901 }, { purchaseId: 2, receiptId: 950 }], receipts: { "901": { receiptId: 901 }, "902": { receiptId: 902 }, "903": { receiptId: 903 }, "950": { receiptId: 950 } } as Record<string, Row> };
  const seen = fakeKoper(state);
  const db = fakeSupabase();

  // 1) carga inicial
  const memory = new Map();
  const r1 = await mirrorEntity(session, spec("bill_to_pay"), opts, memory, db.request);
  assert.deepEqual([r1.listed, r1.reportedTotal, r1.listComplete], [1203, 1203, true]);
  assert.deepEqual(r1.list, { inserted: 1203, updated: 0, unchanged: 0, missingAtSource: 0 });
  assert.equal(r1.detailsRead, 1203);
  assert.equal(r1.detail?.inserted, 1203);
  await mirrorEntity(session, spec("purchase"), opts, memory, db.request);
  const rr = await mirrorEntity(session, spec("receipt"), opts, memory, db.request);
  assert.equal(rr.listed, 4, "recibos vindos de compras (901, 950) e de títulos (901, 902, 903)");
  assert.equal(rr.detail?.inserted, 4);
  assert.equal(db.table.filter((r) => r.entity === "mirror.receipt").length, 4);

  // dado pessoal mascarado, CNPJ preservado, empresa registrada
  const d1 = db.table.find((r) => r.entity === "mirror.bill_to_pay_detail" && r.koper_id === "bossa:1")!;
  const payload = d1.payload as { _enterprise: string; _enterpriseId: string; data: { beneficiary: Row } };
  assert.equal(payload.data.beneficiary.cpf, "***.***.***-01");
  assert.equal(payload.data.beneficiary.cnpj, "28555255000130");
  assert.equal(payload._enterprise, "bossa");
  assert.equal(d1.koper_parent_id, "bossa:1");

  // 2) repetição: nada novo, nenhum detalhe relido
  const before = seen.length;
  const r2 = await mirrorEntity(session, spec("bill_to_pay"), opts, new Map(), db.request);
  assert.deepEqual(r2.list, { inserted: 0, updated: 0, unchanged: 1203, missingAtSource: 0 });
  assert.equal(r2.detailsRequested, 0);
  assert.equal(seen.length - before, 3, "só as páginas da listagem (2 cheias + 1 parcial)");
  assert.equal(db.table.length, 1203 * 2 + 2 + 2 + 4);

  // 3) um título pago, um novo e um que sumiu
  bills[0]!.isPaid = true;
  bills.pop();
  bills.push({ billId: 5000, billValue: 1, isPaid: false });
  details["5000"] = { bill_id: 5000, origins: {} };
  const r3 = await mirrorEntity(session, spec("bill_to_pay"), opts, new Map(), db.request);
  assert.deepEqual(r3.list, { inserted: 1, updated: 1, unchanged: 1201, missingAtSource: 1 });
  assert.equal(r3.detailsRequested, 2, "só o alterado e o novo");
  const gone = db.table.find((r) => r.entity === "mirror.bill_to_pay" && r.koper_id === "bossa:1203")!;
  assert.equal(gone.sync_state, "missing_at_source");
  const changed = db.table.find((r) => r.entity === "mirror.bill_to_pay" && r.koper_id === "bossa:1")!;
  assert.equal(changed.first_seen_at === undefined ? "x" : changed.first_seen_at === (changed.last_seen_at) ? "overwritten" : "kept", "kept");
  assert.equal((changed.payload as { data: Row }).data.isPaid, true);

  // nunca apagou nada e nunca escreveu no Koper
  assert.equal(db.calls.del, 0);
  assert.ok(seen.every((c) => c.method === "GET"));
});

test("modo plano não grava", async () => {
  fakeKoper({ bills: [{ billId: 1, billValue: 1 }], details: { "1": { bill_id: 1 } }, purchases: [], receipts: {} });
  const db = fakeSupabase();
  const r = await mirrorEntity(session, spec("bill_to_pay"), { ...opts, write: false }, new Map(), db.request);
  assert.equal(r.list?.inserted, 1);
  assert.equal(db.table.length, 0);
  assert.equal(db.calls.post + db.calls.patch, 0);
});

test("listagem incompleta não marca sumiço", async () => {
  const db = fakeSupabase();
  fakeKoper({ bills: [{ billId: 1 }, { billId: 2 }], details: { "1": {}, "2": {} }, purchases: [], receipts: {} });
  await mirrorEntity(session, spec("bill_to_pay"), opts, new Map(), db.request);
  // Koper diz 2 mas devolve 1
  globalThis.fetch = (async (input: URL | string) => {
    const url = new URL(String(input));
    if (url.searchParams.has("billId")) return new Response("{}", { status: 200 });
    return new Response(JSON.stringify({ billsAmount: 2, bills: Number(url.searchParams.get("offset")) === 0 ? [{ billId: 1 }] : [] }), { status: 200 });
  }) as typeof fetch;
  const r = await mirrorEntity(session, spec("bill_to_pay"), opts, new Map(), db.request);
  assert.equal(r.listComplete, false);
  assert.equal(r.list?.missingAtSource, 0);
  assert.equal(db.table.find((x) => x.koper_id === "bossa:2" && x.entity === "mirror.bill_to_pay")!.sync_state, "present");
});

test("sanitização e allowlist de troca de empresa", () => {
  const s = sanitizeKoperPayload({ supplierCpf: "123.456.789-09", customerCnpjCpf: "28555255000130", supPhone: "(47) 99999-1234", email: "fabio@dominio.com", accessToken: "segredo", nested: [{ cellphone: "47988887777", password: "x" }] }) as Record<string, unknown>;
  assert.equal(s.supplierCpf, "***.***.***-09");
  assert.equal(s.customerCnpjCpf, "28555255000130");
  assert.equal(s.supPhone, "(XX) XXXXX-1234");
  assert.equal(s.email, "f***@dominio.com");
  assert.equal("accessToken" in s, false);
  assert.deepEqual(s.nested, [{ cellphone: "(XX) XXXXX-7777" }]);

  const u = new URL("https://api.koper.com.br/login/change_company?changeCompany=1");
  const ok = JSON.stringify({ accessToken: "t", toEnterpriseId: "ec9ed276-742a-11ef-8533-1219c832db49", changeCompany: true });
  assert.equal(isAllowedCompanySwitch(u, "POST", ok), true);
  assert.equal(isAllowedCompanySwitch(u, "POST", JSON.stringify({ accessToken: "t", toEnterpriseId: "outra-empresa", changeCompany: true })), false);
  assert.equal(isAllowedCompanySwitch(u, "POST", JSON.stringify({ accessToken: "t", toEnterpriseId: "ec9ed276-742a-11ef-8533-1219c832db49", changeCompany: true, extra: 1 })), false);
  assert.equal(isAllowedCompanySwitch(new URL("https://api.koper.com.br/financial/v1/bills_to_pay"), "POST", ok), false);
  assert.equal(isAllowedCompanySwitch(u, "PUT", ok), false);
});
