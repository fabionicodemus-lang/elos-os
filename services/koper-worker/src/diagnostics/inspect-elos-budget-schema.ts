const base = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!base || !key) throw new Error("Missing Supabase credentials");
const res = await fetch(`${base}/rest/v1/`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
if (!res.ok) throw new Error(`OpenAPI HTTP ${res.status}`);
const spec = await res.json() as { paths?: Record<string, unknown>; definitions?: Record<string, unknown>; components?: { schemas?: Record<string, unknown> } };
const names = Object.keys(spec.paths ?? {}).map((p) => p.replace(/^\//, ""));
const relevant = names.filter((n) => /(budget|orc|service|servic|input|insum|composition|compos|project|building|obra)/i.test(n)).sort();
console.log("ELOS_BUDGET_SCHEMA", JSON.stringify({ ok:true, relevantCount: relevant.length, relevant }));
