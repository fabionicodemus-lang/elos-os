// Elos OS — Cronograma: formato portátil (HTML autossuficiente) para ida e volta.
//
// O botão "Exportar HTML" gera um arquivo único que (1) desenha o cronograma no
// mesmo padrão visual do sistema e (2) carrega, embutido, o modelo completo em
// JSON num bloco <script type="application/json" id="elos-cronograma">. Uma IA
// externa edita esse JSON (datas, durações, equipes e predecessoras) e o mesmo
// arquivo é reimportado. Os VALORES ficam travados no orçamento — a reimportação
// nunca altera valor, apenas o planejamento no tempo e as amarrações.

export const SCHEMA_VERSION = 1;
export const PAYLOAD_SCRIPT_ID = "elos-cronograma";
export const PAYLOAD_KIND = "cronograma";

const AI_INSTRUCTIONS = [
  "Este arquivo é o cronograma físico do Elos OS e volta para o sistema por reimportação.",
  "Edite SOMENTE o JSON dentro de <script id=\"elos-cronograma\">.",
  "Você pode alterar, em cada atividade: plannedStart (AAAA-MM-DD), durationDays (inteiro > 0), teamCount e productivity.",
  "Você pode alterar as amarrações no array dependencies: predecessorCode, successorCode, relationType (FS, SS, FF ou SF) e lagDays (inteiro).",
  "NÃO altere plannedCost, serviceId, locationId, quantity nem os códigos das atividades: o valor é travado no orçamento e a reimportação os ignora.",
  "Use os códigos existentes das atividades (campo code) para montar as predecessoras.",
  "Datas devem cair em dias úteis conforme meta.workOnSaturday; o sistema normaliza para o próximo dia útil se necessário.",
].join(" ");

function escapeForScript(json) {
  // Evita quebrar o </script>; mantém o conteúdo como JSON válido.
  // A extração desfaz este escape antes do JSON.parse.
  return json.replace(/</g, "\\u003c");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Normaliza o modelo para o payload canônico (o que é embutido e reimportado).
 */
export function buildSchedulePayload(model) {
  const meta = model.meta ?? {};
  return {
    meta: {
      app: "Elos OS",
      kind: PAYLOAD_KIND,
      schemaVersion: SCHEMA_VERSION,
      baselineId: meta.baselineId ?? null,
      baselineCode: meta.baselineCode ?? null,
      baselineVersion: meta.baselineVersion ?? null,
      budgetId: meta.budgetId ?? null,
      projectName: meta.projectName ?? null,
      workOnSaturday: Boolean(meta.workOnSaturday),
      startDate: meta.startDate ?? null,
      exportedAt: meta.exportedAt ?? null,
    },
    instructions: AI_INSTRUCTIONS,
    locations: (model.locations ?? []).map((location) => ({ id: location.id, code: location.code, name: location.name })),
    services: (model.services ?? []).map((service) => ({ id: service.id, code: service.code, description: service.description })),
    activities: (model.activities ?? []).map((activity) => ({
      code: activity.code,
      name: activity.name,
      serviceId: activity.serviceId ?? null,
      locationId: activity.locationId ?? null,
      plannedStart: activity.plannedStart,
      plannedFinish: activity.plannedFinish,
      durationDays: Number(activity.durationDays) || 0,
      teamCount: Number(activity.teamCount) || 1,
      productivity: Number(activity.productivity) || 0,
      quantity: Number(activity.quantity) || 0,
      plannedCost: Number(activity.plannedCost) || 0,
      planningStatus: activity.planningStatus ?? "draft",
      color: activity.color ?? "#008780",
      textColor: activity.textColor ?? "#ffffff",
      abbr: activity.abbr ?? "",
    })),
    dependencies: (model.dependencies ?? []).map((dependency) => ({
      predecessorCode: dependency.predecessorCode,
      successorCode: dependency.successorCode,
      relationType: dependency.relationType ?? "FS",
      lagDays: Number(dependency.lagDays) || 0,
    })),
  };
}

/**
 * Valida um payload extraído de um HTML reimportado.
 * Retorna { ok, payload, error }.
 */
export function validateSchedulePayload(payload) {
  if (!payload || typeof payload !== "object") return { ok: false, error: "Arquivo sem dados do cronograma." };
  const meta = payload.meta;
  if (!meta || meta.kind !== PAYLOAD_KIND) return { ok: false, error: "Este arquivo não é um cronograma do Elos OS." };
  if (Number(meta.schemaVersion) !== SCHEMA_VERSION) return { ok: false, error: `Versão de formato incompatível (esperado ${SCHEMA_VERSION}).` };
  if (!Array.isArray(payload.activities)) return { ok: false, error: "O arquivo não contém a lista de atividades." };
  if (!Array.isArray(payload.dependencies)) return { ok: false, error: "O arquivo não contém a lista de predecessoras." };
  return { ok: true, payload };
}

/**
 * Extrai e valida o payload embutido num HTML exportado.
 */
export function extractSchedulePayload(html) {
  if (typeof html !== "string" || !html.includes(PAYLOAD_SCRIPT_ID)) {
    return { ok: false, error: "Não foi possível localizar os dados do cronograma neste arquivo." };
  }
  const pattern = new RegExp(
    `<script[^>]*id=["']${PAYLOAD_SCRIPT_ID}["'][^>]*>([\\s\\S]*?)<\\/script>`,
    "i",
  );
  const match = html.match(pattern);
  if (!match) return { ok: false, error: "Bloco de dados do cronograma ausente ou malformado." };
  let parsed;
  try {
    parsed = JSON.parse(match[1].replace(/\\u003c/g, "<").trim());
  } catch {
    return { ok: false, error: "Os dados do cronograma no arquivo estão corrompidos (JSON inválido)." };
  }
  return validateSchedulePayload(parsed);
}

// Visualizador embutido no arquivo exportado. Roda no navegador ao abrir o
// arquivo e desenha o Gantt a partir do JSON — assim o que a IA edita no JSON
// aparece no visual. Escrito como função para ser serializado com toString().
function scheduleViewerScript() {
  var host = document.getElementById("elos-gantt");
  var dataEl = document.getElementById("elos-cronograma");
  if (!host || !dataEl) return;
  var model;
  try { model = JSON.parse(dataEl.textContent); } catch { host.textContent = "Dados inválidos."; return; }

  function parseDate(value) { return new Date(String(value).slice(0, 10) + "T12:00:00Z"); }
  function addDays(date, days) { var r = new Date(date); r.setUTCDate(r.getUTCDate() + days); return r; }
  function startOfWeek(date) { var r = new Date(date); var day = r.getUTCDay(); r.setUTCDate(r.getUTCDate() - (day === 0 ? 6 : day - 1)); return r; }
  function daysBetween(a, b) { return Math.round((b.getTime() - a.getTime()) / 86400000); }
  function two(n) { return (n < 10 ? "0" : "") + n; }
  function fmt(date) { return two(date.getUTCDate()) + "/" + two(date.getUTCMonth() + 1); }
  function money(value) { try { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(value || 0); } catch { return "R$ " + (value || 0); } }
  var months = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

  var acts = (model.activities || []).filter(function (a) { return a.plannedStart && a.plannedFinish; });
  if (!acts.length) { host.innerHTML = '<p style="padding:24px;color:#64748b">Sem atividades para exibir.</p>'; return; }

  var starts = acts.map(function (a) { return parseDate(a.plannedStart).getTime(); });
  var finishes = acts.map(function (a) { return parseDate(a.plannedFinish).getTime(); });
  var minD = startOfWeek(new Date(Math.min.apply(null, starts)));
  var maxD = addDays(startOfWeek(new Date(Math.max.apply(null, finishes))), 6);
  var weeks = []; for (var c = new Date(minD); c <= maxD; c = addDays(c, 7)) weeks.push(new Date(c));
  var weekW = 36, timelineW = Math.max(600, weeks.length * weekW), totalDays = Math.max(1, daysBetween(minD, maxD));
  function x(value) { return daysBetween(minD, parseDate(value)) / totalDays * timelineW; }
  function barW(a) { return Math.max(6, (daysBetween(parseDate(a.plannedStart), parseDate(a.plannedFinish)) + 1) / totalDays * timelineW); }

  var locMap = {}; (model.locations || []).forEach(function (l) { locMap[l.id] = l; });
  var order = (model.locations || []).map(function (l) { return l.id; });
  order.push("__none__");
  var byLoc = {}; acts.forEach(function (a) { var k = a.locationId || "__none__"; (byLoc[k] = byLoc[k] || []).push(a); });

  var monthBand = weeks.map(function (w, i) {
    var prev = weeks[i - 1];
    if (prev && prev.getUTCMonth() === w.getUTCMonth()) return "";
    var span = 1; while (weeks[i + span] && weeks[i + span].getUTCMonth() === w.getUTCMonth()) span += 1;
    return '<div class="mb" style="left:' + (i * weekW) + 'px;width:' + (span * weekW) + 'px">' + months[w.getUTCMonth()] + " " + w.getUTCFullYear() + "</div>";
  }).join("");
  var weekBand = weeks.map(function (w) { return '<div class="wk" style="width:' + weekW + 'px">' + fmt(w) + "</div>"; }).join("");

  var today = new Date(); var todayX = daysBetween(minD, today) / totalDays * timelineW;
  var todayLine = (todayX >= 0 && todayX <= timelineW) ? '<div class="today" style="left:' + todayX + 'px"></div>' : "";

  var rows = "";
  order.forEach(function (locId) {
    var items = byLoc[locId]; if (!items || !items.length) return;
    var loc = locMap[locId];
    var label = loc ? (loc.code + " · " + loc.name) : "Geral da obra";
    var summary = items.map(function (a) {
      return '<div class="sbar" style="left:' + x(a.plannedStart) + 'px;width:' + barW(a) + 'px;background:' + a.color + ';color:' + a.textColor + '" title="' + a.name + '">' + (a.abbr || "") + "</div>";
    }).join("");
    rows += '<div class="grp"><div class="grp-meta">' + label + ' <i>' + items.length + '</i></div><div class="grp-tl" style="width:' + timelineW + 'px">' + summary + todayLine + "</div></div>";
    items.forEach(function (a) {
      rows += '<div class="row">'
        + '<div class="meta"><div class="c">' + a.code + '</div><div class="n">' + a.name + '</div><div class="d">' + fmt(parseDate(a.plannedStart)) + '</div><div class="d">' + (a.durationDays || 0) + 'd</div><div class="v">' + money(a.plannedCost) + '</div></div>'
        + '<div class="tl" style="width:' + timelineW + 'px"><div class="bar" style="left:' + x(a.plannedStart) + 'px;width:' + barW(a) + 'px;background:' + a.color + ';color:' + a.textColor + '"><span>' + (a.abbr || "") + '</span></div>' + todayLine + '</div>'
        + '</div>';
    });
  });

  host.innerHTML =
    '<div class="head"><div class="mhead">ID / Serviço · Início · Duração · Valor</div><div class="thead" style="width:' + timelineW + 'px"><div class="mbrow">' + monthBand + '</div><div class="wkrow">' + weekBand + '</div>' + todayLine + '</div></div>' + rows;
}

/**
 * Gera o documento HTML autossuficiente do cronograma, com o JSON embutido.
 */
export function buildScheduleHtml(model) {
  const payload = buildSchedulePayload(model);
  const json = escapeForScript(JSON.stringify(payload, null, 2));
  const title = `Cronograma · ${payload.meta.projectName ?? "Elos OS"}`;
  const period = payload.meta.startDate ? `Início ${payload.meta.startDate}` : "";
  const budgetTotal = payload.activities.reduce((sum, activity) => sum + (Number(activity.plannedCost) || 0), 0);
  const budgetLabel = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(budgetTotal);

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
  :root { --teal: #008780; --bg: #eef1f0; --ink: #0f172a; --muted: #64748b; --line: #d7dedb; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: "IBM Plex Sans", system-ui, -apple-system, Segoe UI, Roboto, sans-serif; background: var(--bg); color: var(--ink); }
  header.top { background: #0f2b29; color: #fff; padding: 18px 24px; display: flex; align-items: center; gap: 16px; }
  header.top .brand { width: 40px; height: 40px; border-radius: 10px; background: var(--teal); display: grid; place-items: center; font-weight: 700; font-size: 20px; }
  header.top h1 { font-size: 18px; margin: 0; font-family: "Space Grotesk", system-ui, sans-serif; }
  header.top small { display: block; color: #b8c9c6; font-size: 12px; }
  .kpis { margin-left: auto; display: flex; gap: 22px; }
  .kpis div span { display: block; font-size: 11px; color: #b8c9c6; text-transform: uppercase; letter-spacing: .04em; }
  .kpis div strong { font-size: 15px; }
  .note { background: #fff7ed; border: 1px solid #fed7aa; color: #9a3412; margin: 16px 24px; padding: 12px 16px; border-radius: 10px; font-size: 13px; line-height: 1.5; }
  .note b { color: #7c2d12; }
  .gantt-wrap { margin: 0 16px 32px; overflow-x: auto; background: #fff; border: 1px solid var(--line); border-radius: 12px; }
  #elos-gantt { min-width: max-content; font-size: 12px; }
  #elos-gantt .head { display: flex; position: sticky; top: 0; background: #f8fafa; border-bottom: 2px solid var(--line); z-index: 2; }
  #elos-gantt .mhead { width: 470px; min-width: 470px; padding: 10px 12px; font-weight: 600; color: var(--muted); border-right: 1px solid var(--line); }
  #elos-gantt .thead { position: relative; height: 44px; }
  #elos-gantt .mbrow { position: relative; height: 22px; border-bottom: 1px solid var(--line); }
  #elos-gantt .mb { position: absolute; top: 0; height: 22px; line-height: 22px; padding-left: 6px; font-weight: 600; color: var(--teal); border-left: 1px solid var(--line); overflow: hidden; white-space: nowrap; }
  #elos-gantt .wkrow { position: relative; height: 22px; display: flex; }
  #elos-gantt .wk { border-left: 1px solid #eef1f0; text-align: center; line-height: 22px; color: var(--muted); font-size: 10px; }
  #elos-gantt .grp { display: flex; background: #f1f5f4; border-bottom: 1px solid var(--line); }
  #elos-gantt .grp-meta { width: 470px; min-width: 470px; padding: 7px 12px; font-weight: 600; border-right: 1px solid var(--line); }
  #elos-gantt .grp-meta i { color: var(--muted); font-style: normal; font-weight: 500; }
  #elos-gantt .grp-tl { position: relative; height: 30px; }
  #elos-gantt .sbar { position: absolute; top: 8px; height: 14px; border-radius: 4px; font-size: 9px; line-height: 14px; text-align: center; opacity: .55; overflow: hidden; }
  #elos-gantt .row { display: flex; border-bottom: 1px solid #eef1f0; }
  #elos-gantt .meta { width: 470px; min-width: 470px; display: grid; grid-template-columns: 90px 1fr 56px 46px 86px; align-items: center; gap: 6px; padding: 6px 12px; border-right: 1px solid var(--line); }
  #elos-gantt .meta .c { font-weight: 600; font-size: 11px; }
  #elos-gantt .meta .n { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #elos-gantt .meta .d { color: var(--muted); font-size: 11px; }
  #elos-gantt .meta .v { text-align: right; font-variant-numeric: tabular-nums; }
  #elos-gantt .tl { position: relative; height: 34px; }
  #elos-gantt .bar { position: absolute; top: 7px; height: 20px; border-radius: 6px; box-shadow: 0 1px 2px rgba(15,23,42,.18); display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 600; overflow: hidden; }
  #elos-gantt .today { position: absolute; top: 0; bottom: 0; width: 2px; background: #dc2626; }
  footer { color: var(--muted); font-size: 11px; padding: 8px 24px 24px; }
</style>
</head>
<body>
<header class="top">
  <div class="brand">E</div>
  <div><h1>Cronograma Físico</h1><small>${escapeHtml(payload.meta.projectName ?? "Obra")} · ${escapeHtml(payload.meta.baselineCode ?? "")} ${escapeHtml(period)}</small></div>
  <div class="kpis">
    <div><span>Atividades</span><strong>${payload.activities.length}</strong></div>
    <div><span>Serviços</span><strong>${new Set(payload.activities.map((a) => a.serviceId)).size}</strong></div>
    <div><span>Valor do orçamento</span><strong>${escapeHtml(budgetLabel)}</strong></div>
  </div>
</header>
<div class="note"><b>Editar com IA:</b> altere apenas o JSON no bloco <code>&lt;script id="elos-cronograma"&gt;</code> — datas (<code>plannedStart</code>), durações (<code>durationDays</code>), equipes e as amarrações em <code>dependencies</code>. <b>Não altere valores</b> (<code>plannedCost</code>) nem os códigos: o valor é travado no orçamento e a reimportação os ignora. Depois reimporte este arquivo no Elos OS.</div>
<div class="gantt-wrap"><div id="elos-gantt"></div></div>
<footer>Gerado pelo Elos OS · formato v${SCHEMA_VERSION} · abra este arquivo para visualizar; edite o JSON abaixo para reprogramar.</footer>
<script type="application/json" id="${PAYLOAD_SCRIPT_ID}">
${json}
</script>
<script>(${scheduleViewerScript.toString()})();</script>
</body>
</html>`;
}
