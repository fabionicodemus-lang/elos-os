import {FINANCE_TITLE_COLUMNS,type FinancialTitleFields} from "@/lib/finance-core/titles.mjs";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { calculateDevelopmentResult } from "@/lib/commercial/development-result.mjs";
import { loadProjectForecast } from "@/lib/forecast/server";
import { loadDevelopmentCosts } from "@/lib/development-costs/server";
import type { DevelopmentCostStatus } from "@/lib/development-costs/summary.mjs";
import { applyFeasibilityDevelopmentBudget, updateDevelopmentBudget } from "./actions";
import { fetchAllRows } from "@/lib/supabase-pagination";
import { requireCompanyPermission } from "@/lib/workspace";
import "./result.css";

type Project = {
  id:string; name:string; code:string|null; status:string; total_units:number|null; built_area_m2:number|null;
  construction_start_date:string|null; delivery_date:string|null;
};
type Profile = { baseline_study_id:string; baseline_metrics:Record<string,unknown>; approved_at:string };
type Study = { id:string; name:string; commission_pct:number|null; tax_rate_pct:number|null; tax_regime:string|null };
type Sale = { id:string; unit_id:string|null; total_amount:number; commission_pct:number|null; commission_amount:number|null; status:string; sale_date:string };
type Unit = { id:string; code:string; status:string; list_price:number|null };
type Receivable = FinancialTitleFields & { id:string; status:string; amount:number; adjusted_amount:number|null; paid_amount:number|null; due_date:string; paid_at:string|null };
type Payable = FinancialTitleFields & { id:string; status:string; amount:number; paid_amount:number|null; due_date:string; paid_at:string|null };

type Result = ReturnType<typeof calculateDevelopmentResult>;

function money(value: unknown) {
  return new Intl.NumberFormat("pt-BR", { style:"currency", currency:"BRL", maximumFractionDigits:0 }).format(Number(value ?? 0));
}
function number(value: unknown, digits = 1) {
  return Number(value ?? 0).toLocaleString("pt-BR", { maximumFractionDigits:digits });
}
function percent(value: unknown) {
  return `${number(value, 1)}%`;
}
function signedMoney(value: unknown) {
  const amount = Number(value ?? 0);
  if (Math.abs(amount) < 0.005) return money(0);
  return `${amount > 0 ? "+" : "−"}${money(Math.abs(amount))}`;
}
function signedPercent(value: unknown) {
  const amount = Number(value ?? 0);
  if (Math.abs(amount) < 0.005) return "0,0 p.p.";
  return `${amount > 0 ? "+" : "−"}${number(Math.abs(amount), 1)} p.p.`;
}
function todayIso() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone:"America/Sao_Paulo", year:"numeric", month:"2-digit", day:"2-digit" }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
function dateBR(value: string | null | undefined) {
  if (!value) return "—";
  const [year,month,day] = value.slice(0,10).split("-");
  return `${day}/${month}/${year}`;
}
function deltaClass(value: number, positiveIsGood = true) {
  if (Math.abs(value) < 0.005) return "neutral";
  return (value > 0) === positiveIsGood ? "positive" : "negative";
}

const centerStatusLabels: Record<DevelopmentCostStatus, string> = {
  ok: "Dentro",
  attention: "Atenção",
  over: "Acima",
  no_budget: "Sem orçado",
};

function centerStatusBadge(status: DevelopmentCostStatus) {
  if (status === "ok") return <span className="cashflow-direction in">{centerStatusLabels[status]}</span>;
  if (status === "over" || status === "no_budget") return <span className="cashflow-direction out">{centerStatusLabels[status]}</span>;
  return <span className="cashflow-direction" style={{ color:"#8b5a15", background:"#fff4da" }}>{centerStatusLabels[status]}</span>;
}

function consumptionBar(status: DevelopmentCostStatus, value: number) {
  const width = Math.max(0, Math.min(100, value));
  return <>
    <strong>{percent(value)}</strong>
    <div style={{ width:96, height:7, marginTop:6, marginLeft:"auto", overflow:"hidden", borderRadius:999, background:"#e7eeed" }}>
      <span style={{ display:"block", width:`${width}%`, height:"100%", borderRadius:999,
        background: status === "over" || status === "no_budget" ? "#b75d50" : status === "attention" ? "#c89236" : "#087f72" }} />
    </div>
  </>;
}

export default async function DevelopmentResultPage({ searchParams }: { searchParams: Promise<{ error?:string; success?:string }> }) {
  const params = await searchParams;
  const { supabase, company, companyId, projectId } = await requireCompanyPermission("commercial.incorporation.view");

  if (!projectId) {
    return <AppShell activeGroup="commercial" activeItem="incorporation" eyebrow="Comercial · Incorporação"
      title="Resultado do empreendimento"
      description={`${company.name} · selecione um empreendimento para consolidar viabilidade, vendas, caixa e custos.`}
      actions={<Link className="elos-button" prefetch={false} href="/comercial/incorporacao">Carteira da incorporadora</Link>}>
      <section className="result-empty"><strong>Selecione um empreendimento.</strong><p>O resultado é calculado individualmente porque compara o baseline econômico aprovado com o realizado e a projeção atual da obra.</p></section>
    </AppShell>;
  }

  const [projectResult, profileResult, salesResult, unitsResult, receivablesResult, payablesResult] = await Promise.all([
    supabase.from("projects").select("id,name,code,status,total_units,built_area_m2,construction_start_date,delivery_date").eq("company_id",companyId).eq("id",projectId).maybeSingle(),
    supabase.from("commercial_development_profiles").select("baseline_study_id,baseline_metrics,approved_at").eq("company_id",companyId).eq("project_id",projectId).maybeSingle(),
    fetchAllRows<Sale>(async (from,to) => {
      const { data,error } = await supabase.from("sales").select("id,unit_id,total_amount,commission_pct,commission_amount,status,sale_date").eq("company_id",companyId).eq("project_id",projectId).range(from,to);
      return { data:(data ?? []) as Sale[], error };
    }),
    fetchAllRows<Unit>(async (from,to) => {
      const { data,error } = await supabase.from("units").select("id,code,status,list_price").eq("company_id",companyId).eq("project_id",projectId).range(from,to);
      return { data:(data ?? []) as Unit[], error };
    }),
    fetchAllRows<Receivable>(async (from,to) => {
      const { data,error } = await supabase.from("receivables").select(`id,status,amount,adjusted_amount,paid_amount,due_date,paid_at,${FINANCE_TITLE_COLUMNS}`).eq("company_id",companyId).eq("project_id",projectId).range(from,to);
      return { data:(data ?? []) as unknown as Receivable[], error };
    }),
    fetchAllRows<Payable>(async (from,to) => {
      const { data,error } = await supabase.from("payables").select(`id,status,amount,paid_amount,due_date,paid_at,${FINANCE_TITLE_COLUMNS}`).eq("company_id",companyId).eq("project_id",projectId).range(from,to);
      return { data:(data ?? []) as unknown as Payable[], error };
    }),
  ]);

  const project = projectResult.data as Project | null;
  const profile = profileResult.data as Profile | null;
  const studyResult = profile?.baseline_study_id
    ? await supabase.from("commercial_feasibility_studies").select("id,name,commission_pct,tax_rate_pct,tax_regime").eq("company_id",companyId).eq("id",profile.baseline_study_id).maybeSingle()
    : { data:null, error:null };
  const study = studyResult.data as Study | null;

  const asOfDate = todayIso();
  const [forecastContext, developmentCosts, manageResult] = await Promise.all([
    loadProjectForecast({ supabase, companyId, projectId, asOfDate }),
    loadDevelopmentCosts({ supabase, companyId, projectId }),
    supabase.rpc("has_company_permission", { target_company_id: companyId, target_permission: "commercial.incorporation.manage" }),
  ]);
  const canManage = manageResult.data === true;
  const result = calculateDevelopmentResult({
    baselineMetrics: profile?.baseline_metrics ?? {},
    baselineStudy: study ?? {},
    project: project ?? {},
    sales: salesResult.data,
    units: unitsResult.data,
    receivables: receivablesResult.data,
    payables: payablesResult.data,
    forecast: forecastContext.forecast,
    developmentCosts,
    today: asOfDate,
  }) as Result;

  const sourceErrors = [projectResult.error?.message, profileResult.error?.message, salesResult.error?.message, unitsResult.error?.message, receivablesResult.error?.message, payablesResult.error?.message, studyResult.error?.message, ...forecastContext.errors, ...developmentCosts.errors].filter(Boolean) as string[];
  const costDeviation = result.cost.engineeringProjected - result.baseline.engineeringCost;
  const costDeviationPct = result.baseline.engineeringCost > 0 ? costDeviation / result.baseline.engineeringCost * 100 : 0;
  const healthLabel = result.result.health === "above" ? "Acima do baseline" : result.result.health === "attention" ? "Atenção à margem" : "Abaixo do baseline";

  const resultRows = [
    { label:"VGV disponível / projetado", baseline:result.baseline.vgv, current:result.commercial.projectedVgv, delta:result.commercial.vgvDeviation, good:true },
    { label:"Custo de obra + contingência", baseline:result.baseline.engineeringCost, current:result.cost.engineeringProjected, delta:costDeviation, good:false },
    { label:"Comissões", baseline:result.baseline.commission, current:result.cost.projectedCommission, delta:result.cost.projectedCommission-result.baseline.commission, good:false },
    { label:"Impostos sobre vendas", baseline:result.baseline.taxes, current:result.cost.projectedTaxes, delta:result.cost.projectedTaxes-result.baseline.taxes, good:false },
    { label:"Terreno, outorga, projetos e demais custos", baseline:result.baseline.otherCost, current:result.cost.projectedOtherCost, delta:result.cost.projectedOtherCost-result.baseline.otherCost, good:false },
    { label:"Distratos (devoluções a clientes)", baseline:0, current:result.cost.projectedCancellations, delta:result.cost.projectedCancellations, good:false },
    { label:"Custo total", baseline:result.baseline.totalCost, current:result.cost.projectedTotalCost, delta:result.cost.projectedTotalCost-result.baseline.totalCost, good:false, strong:true },
    { label:"Lucro", baseline:result.baseline.profit, current:result.result.projectedProfit, delta:result.result.profitDeviation, good:true, strong:true },
  ];

  return <AppShell activeGroup="commercial" activeItem="incorporation" eyebrow="Comercial · Incorporação · Resultado"
    title={`Resultado · ${project?.name ?? "Empreendimento"}`}
    description={`${company.name} · baseline aprovado versus vendas, caixa e custo projetado em ${dateBR(asOfDate)}.`}
    actions={<>
      {profile?.baseline_study_id ? <Link className="elos-button" prefetch={false} href={`/comercial/incorporacao/viabilidade/${profile.baseline_study_id}`}>Abrir baseline</Link> : null}
      <Link className="elos-button" prefetch={false} href="/engenharia/previsao-financeira">Previsão da obra</Link>
      <Link className="elos-button" prefetch={false} href="/comercial/incorporacao">Carteira</Link>
    </>}>

    {params.error ? <div className="auth-message error workspace-message">{params.error}</div> : null}
    {params.success ? <div className="auth-message success workspace-message">{params.success}</div> : null}
    {sourceErrors.length ? <div className="auth-message error workspace-message">Parte das fontes não pôde ser lida: {sourceErrors[0]}</div> : null}
    {!profile ? <div className="result-warning"><strong>Sem baseline de viabilidade vinculado.</strong><span>O painel continua mostrando o realizado disponível, mas a comparação inicial só fica completa para empreendimentos criados/aprovados pelo Estudo de Viabilidade.</span></div> : null}

    <section className={`result-hero ${result.result.health}`}>
      <div><span>Resultado projetado no encerramento</span><strong>{money(result.result.projectedProfit)}</strong><small>Lucro do empreendimento, usando o VGV atual do estoque e a previsão vigente de custos.</small></div>
      <div className="result-hero-metric"><span>Margem projetada</span><strong>{percent(result.result.projectedMarginPct)}</strong><small>Baseline {percent(result.baseline.marginPct)}</small></div>
      <div className="result-hero-metric"><span>Desvio de lucro</span><strong className={deltaClass(result.result.profitDeviation,true)}>{signedMoney(result.result.profitDeviation)}</strong><small>{signedPercent(result.result.marginDeviationPct)} de margem</small></div>
      <div className="result-health"><span>Status</span><strong>{healthLabel}</strong><small>{project?.code ? `${project.code} · ` : ""}{project?.status ?? "—"}</small></div>
    </section>

    <section className="result-kpi-grid">
      <article><span>VGV vendido</span><strong>{money(result.commercial.soldVgv)}</strong><small>{result.commercial.soldUnits} unidade(s) ativa(s)</small></article>
      <article><span>Estoque a valor atual</span><strong>{money(result.commercial.inventoryVgv)}</strong><small>{result.commercial.availableUnits} unidade(s) disponível(is)</small></article>
      <article><span>VGV projetado</span><strong>{money(result.commercial.projectedVgv)}</strong><small className={deltaClass(result.commercial.vgvDeviation,true)}>{signedMoney(result.commercial.vgvDeviation)} vs baseline</small></article>
      <article><span>Velocidade comercial acumulada</span><strong>{percent(result.commercial.salesProgressPct)}</strong><small>do estoque comercializável já vendido</small></article>
      <article><span>Ticket médio vendido</span><strong>{money(result.commercial.averageSoldTicket)}</strong><small>baseline {money(result.baseline.averageTicket)}</small></article>
      <article><span>Recebido</span><strong>{money(result.cash.received)}</strong><small>caixa de clientes efetivamente baixado</small></article>
      <article><span>Saldo a receber</span><strong>{money(result.cash.receivableOpen)}</strong><small>carteira financeira em aberto</small></article>
      <article className={result.cash.overdue > 0 ? "danger" : ""}><span>Inadimplência</span><strong>{money(result.cash.overdue)}</strong><small>{result.cash.overdueCount} parcela(s) vencida(s)</small></article>
    </section>

    <section className="result-layout">
      <article className="result-panel result-panel-large">
        <div className="result-heading"><div><span>Resultado econômico</span><h2>Baseline × projeção atual</h2></div><small>Não é DRE contábil; é visão gerencial do empreendimento.</small></div>
        <div className="result-table-wrap"><table className="result-table">
          <thead><tr><th>Indicador</th><th>Baseline</th><th>Projeção atual</th><th>Desvio</th></tr></thead>
          <tbody>
            {resultRows.map((row) => <tr key={row.label} className={row.strong ? "strong" : ""}>
              <td>{row.label}</td><td>{money(row.baseline)}</td><td>{money(row.current)}</td><td className={deltaClass(row.delta,row.good)}>{signedMoney(row.delta)}</td>
            </tr>)}
            <tr className="strong"><td>Margem</td><td>{percent(result.baseline.marginPct)}</td><td>{percent(result.result.projectedMarginPct)}</td><td className={deltaClass(result.result.marginDeviationPct,true)}>{signedPercent(result.result.marginDeviationPct)}</td></tr>
          </tbody>
        </table></div>
      </article>

      <article className="result-panel">
        <div className="result-heading"><div><span>Caixa realizado</span><h2>Entradas e saídas</h2></div><small>somente baixas financeiras</small></div>
        <div className="result-stat-list">
          <div><span>Recebido de clientes</span><strong>{money(result.cash.received)}</strong></div>
          <div><span>Pago pelo empreendimento</span><strong>{money(result.cash.paidOut)}</strong></div>
          <div className="total"><span>Saldo de caixa realizado</span><strong className={result.cash.cashBalance >= 0 ? "positive" : "negative"}>{money(result.cash.cashBalance)}</strong></div>
          <div><span>Contas a receber abertas</span><strong>{money(result.cash.receivableOpen)}</strong></div>
          <div><span>Contas a pagar abertas</span><strong>{money(result.cash.payableOpen)}</strong></div>
        </div>
      </article>
    </section>

    <section className="result-layout">
      <article className="result-panel">
        <div className="result-heading"><div><span>Obra</span><h2>Custo até o fim</h2></div><small>motor da Previsão Financeira</small></div>
        <div className="result-stat-list">
          <div><span>Orçamento / referência</span><strong>{money(result.cost.engineeringBudget || result.baseline.engineeringCost)}</strong></div>
          <div><span>Realizado</span><strong>{money(result.cost.engineeringActual)}</strong></div>
          <div><span>Comprometido</span><strong>{money(result.cost.engineeringCommitted)}</strong></div>
          <div><span>A contratar</span><strong>{money(result.cost.engineeringToCommit)}</strong></div>
          <div className="total"><span>Custo projetado ao final</span><strong>{money(result.cost.engineeringProjected)}</strong></div>
          <div><span>Desvio vs viabilidade</span><strong className={deltaClass(costDeviation,false)}>{signedMoney(costDeviation)} · {costDeviationPct >= 0 ? "+" : ""}{number(costDeviationPct,1)}%</strong></div>
        </div>
      </article>

      <article className="result-panel result-panel-large">
        <div className="result-heading"><div><span>Ciclo completo</span><h2>Da viabilidade ao resultado</h2></div><small>fonte única de verdade</small></div>
        <div className="result-cycle">
          <div><b>1</b><span>Viabilidade</span><strong>{profile ? "Baseline congelado" : "Sem baseline"}</strong></div>
          <i>→</i><div><b>2</b><span>Planejamento e obra</span><strong>{forecastContext.forecast ? "Forecast ativo" : "Sem forecast"}</strong></div>
          <i>→</i><div><b>3</b><span>Comercial</span><strong>{result.commercial.soldUnits} vendida(s)</strong></div>
          <i>→</i><div><b>4</b><span>Financeiro</span><strong>{money(result.cash.received)} recebido</strong></div>
          <i>→</i><div className="active"><b>5</b><span>Resultado</span><strong>{money(result.result.projectedProfit)}</strong></div>
        </div>
        <div className="result-project-meta">
          <span>Área construída <strong>{number(project?.built_area_m2,0)} m²</strong></span>
          <span>Início <strong>{dateBR(project?.construction_start_date)}</strong></span>
          <span>Entrega <strong>{dateBR(project?.delivery_date)}</strong></span>
          <span>Taxa de comissão <strong>{percent(result.rates.commissionRate)}</strong></span>
          <span>Regime / impostos <strong>{study?.tax_regime?.toUpperCase() ?? "—"} · {percent(result.rates.taxRate)}</strong></span>
        </div>
      </article>
    </section>

    <section className="result-panel" id="centros-incorporacao" style={{ marginBottom:16 }}>
      <div className="result-heading">
        <div><span>Custos de incorporação</span><h2>Centros de custo · orçado × apropriado</h2></div>
        <small>Orçado do estudo de viabilidade aprovado; apropriado = títulos rateados no centro (pagos e em aberto). Esses centros não entram no custo da obra.</small>
      </div>
      {canManage && profile ? <form action={applyFeasibilityDevelopmentBudget} style={{ marginBottom:12 }}>
        <button className="elos-button" type="submit">{developmentCosts.rows.length ? "Atualizar orçado pelo estudo" : "Gerar centros pelo estudo de viabilidade"}</button>
      </form> : null}
      {developmentCosts.rows.length ? <div className="result-table-wrap"><table className="result-table">
        <thead><tr><th>Centro</th><th>Orçado</th><th>Pago</th><th>Em aberto</th><th>Apropriado</th><th>Saldo</th><th>Consumo</th><th>Status</th><th>Projeção</th></tr></thead>
        <tbody>
          {developmentCosts.rows.map((row) => {
            const projected = row.category === "cancellations" ? row.appropriated
              : row.category === "commission" ? result.cost.projectedCommission
              : row.category === "taxes" ? result.cost.projectedTaxes
              : Math.max(row.budget, row.appropriated);
            return <tr key={row.serviceId}>
              <td><strong>{row.code}</strong> · {row.name}<br /><small style={{ color:"#64748b" }}>{row.titleCount} título(s){row.budgetSource === "manual" ? " · orçado ajustado à mão" : ""}</small></td>
              <td>{canManage ? <form action={updateDevelopmentBudget} style={{ display:"flex", gap:6, justifyContent:"flex-end" }}>
                <input type="hidden" name="service_id" value={row.serviceId} />
                <input name="budget_amount" defaultValue={number(row.budget, 2)} inputMode="decimal" aria-label={`Orçado de ${row.code}`} style={{ width:120, textAlign:"right" }} />
                <button className="elos-button" type="submit" title="Salvar orçado">OK</button>
              </form> : money(row.budget)}</td>
              <td>{money(row.paid)}</td>
              <td>{money(row.open)}</td>
              <td>{money(row.appropriated)}</td>
              <td className={deltaClass(row.balance, true)}>{signedMoney(row.balance)}</td>
              <td>{consumptionBar(row.status, row.consumptionPct)}</td>
              <td>{row.category === "cancellations" ? <span className="cashflow-direction" style={{ color:"#536164", background:"#edf2f1" }}>Grupo próprio</span> : centerStatusBadge(row.status)}</td>
              <td title={row.rateBased ? "Taxa do estudo sobre o VGV projetado, nunca abaixo do apropriado" : "Maior entre orçado e apropriado"}>{money(projected)}</td>
            </tr>;
          })}
          <tr className="strong">
            <td>Total</td><td>{money(developmentCosts.totals.budget)}</td><td>{money(developmentCosts.totals.paid)}</td><td>{money(developmentCosts.totals.open)}</td>
            <td>{money(developmentCosts.totals.appropriated)}</td><td className={deltaClass(developmentCosts.totals.balance, true)}>{signedMoney(developmentCosts.totals.balance)}</td>
            <td></td><td></td><td>{money(result.cost.developmentCentersProjected + result.cost.projectedCommission + result.cost.projectedTaxes + result.cost.projectedCancellations)}</td>
          </tr>
        </tbody>
      </table></div> : <p style={{ margin:0, color:"#64748b" }}>Os centros de incorporação ainda não foram gerados para esta obra.{profile ? "" : " É preciso ter o estudo de viabilidade aprovado (baseline)."}</p>}
      {result.cost.unallocatedSourceProjected > 0 ? <p style={{ margin:"10px 0 0", color:"#64748b", fontSize:".82rem" }}>
        Há {money(result.cost.unallocatedSourceProjected)} em títulos sem centro de custo (obra ou incorporação ainda não classificados). Eles consomem primeiro o saldo destes centros; só o excesso aumenta o custo projetado.
      </p> : null}
    </section>

    {result.warnings.length ? <section className="result-panel result-warnings"><div className="result-heading"><div><span>Qualidade dos dados</span><h2>Pontos que afetam a precisão</h2></div></div><ul>{result.warnings.map((warning:string) => <li key={warning}>{warning}</li>)}</ul></section> : null}

    <div className="result-footnote">Resultado gerencial calculado em {dateBR(asOfDate)}. O lucro projetado substitui o custo físico previsto na viabilidade pelo forecast atual da obra, atualiza VGV pelo vendido + estoque e recalcula comissão e impostos; valores sem classificação são tratados de forma conservadora.</div>
  </AppShell>;
}
