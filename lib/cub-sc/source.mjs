import { createHash } from "node:crypto";

export const CUB_SOURCE_URL = "https://sinduscon-fpolis.org.br/servico/cub-mensal/";
const months = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

export function cubWindow(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now).map(p => [p.type, p.value]));
  return { month: `${parts.year}-${parts.month}-01`, day: Number(parts.day), open: Number(parts.day) <= 3 };
}

function monthDate(value) {
  const match = value.toLowerCase().match(/^([a-zç]+)\s*\/\s*(20\d{2})$/);
  const month = match ? months.indexOf(match[1]) + 1 : 0;
  if (!month) throw new Error("invalid_source");
  return `${match[2]}-${String(month).padStart(2, "0")}-01`;
}

export function parseCubPublication(html, applicationMonth) {
  if (typeof html !== "string" || html.length > 2_000_000) throw new Error("invalid_source");
  const text = html.replace(/<!--[^]*?-->/g, " ").replace(/<(script|style)\b[^>]*>[^]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;|&#xA0;/gi, " ").replace(/\s+/g, " ").trim();
  const section = text.match(/CUB Norma 2006 ([^]*?) Metodologia/);
  if (!section) throw new Error("invalid_source");
  const result = {};
  let referenceMonth;
  for (const [label, field] of [["Residencial Médio", "residential"], ["Comercial Médio", "commercial"]]) {
    const pattern = new RegExp(`${label} Mês de Referência: ([A-Za-zçÇ]+\\s*\\/\\s*20\\d{2}) Para ser usado em: ([A-Za-zçÇ]+\\s*\\/\\s*20\\d{2}) R\\$\\s*(\\d{1,3}(?:\\.\\d{3})*,\\d{2}) (-?\\d{1,2},\\d{2})%`, "g");
    const matches = [...section[1].matchAll(pattern)];
    if (matches.length !== 1) throw new Error("invalid_source");
    const match = matches[0];
    const reference = monthDate(match[1]), application = monthDate(match[2]);
    if (application !== applicationMonth) throw new Error("not_published");
    const previous = new Date(`${application}T12:00:00Z`);
    previous.setUTCMonth(previous.getUTCMonth() - 1);
    if (reference !== previous.toISOString().slice(0, 10) || (referenceMonth && referenceMonth !== reference)) throw new Error("invalid_source");
    referenceMonth = reference;
    const value = Number(match[3].replaceAll(".", "").replace(",", "."));
    if (!Number.isFinite(value) || value <= 0 || value >= 1_000_000) throw new Error("invalid_source");
    result[field] = value;
  }
  return { application_month: applicationMonth, reference_month: referenceMonth, ...result, source_url: CUB_SOURCE_URL, source_hash: createHash("sha256").update(html).digest("hex") };
}

export async function fetchCubPublication(month, fetcher = fetch) {
  const response = await fetcher(CUB_SOURCE_URL, { redirect: "error", cache: "no-store", signal: AbortSignal.timeout(15000), headers: { Accept: "text/html", "User-Agent": "ElosOS-CUB/1.0" } });
  if (!response.ok || !response.headers.get("content-type")?.includes("text/html") || !response.body) throw new Error("source_unavailable");
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2_000_000) throw new Error("invalid_source");
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  return parseCubPublication(Buffer.concat(chunks).toString("utf8"), month);
}

const unwrap = result => { if (result.error) throw new Error("cub_database_error"); return result.data; };
export async function runCubSync({ db, now = new Date(), fetchPublication = fetchCubPublication }) {
  if (!cubWindow(now).open) return { status: "outside_window" };
  const claim = unwrap(await db.rpc("cub_sc_claim"));
  if (!claim) return { status: "skipped" }; // completed, inactive, or already checked this hour
  let publication = null, failure = null;
  try { publication = await fetchPublication(claim.month); }
  catch (error) { failure = ["not_published", "invalid_source"].includes(error.message) ? error.message : "source_unavailable"; }
  const status = unwrap(await db.rpc("cub_sc_finish", { p_month: claim.month, p_token: claim.token, p_publication: publication, p_failure: failure }));
  return { status };
}
