import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { calculateFeasibility } from "@/lib/commercial/feasibility.mjs";
import { requireCompanyPermission } from "@/lib/workspace";
import { approveAndConvertFeasibilityStudy, updateFeasibilityStudy } from "../actions";
import {
  FeasibilityConstructionAreasManager,
  FeasibilitySalesVelocitiesManager,
  FeasibilityUnitTypesManager,
  type FeasibilityConstructionArea,
  type FeasibilitySalesVelocity,
  type FeasibilityUnitType,
} from "./managed-assumptions";
import { FeasibilityCubBaseline } from "./cub-baseline";
import { TaxRegimeFields } from "./tax-regime-fields";
import "../feasibility.css";

type CashflowRow = {
  month:number; sales:number; receipts:number; land:number; projects:number; construction:number;
  commission:number; taxes:number; marketing:number; centralOffice:number; financial:number;
  contingency:number; net:number; cumulative:number;
};
type FeasibilityMetrics = {
  gross_vgv:number; total_units:number; barter_vgv:number; barter_units:number; available_vgv:number; available_units:number;
  profit:number; margin_pct:number; irr_annual_pct:number|null; irr_monthly_pct:number|null; exposure_max:number; exposure_month:number;
  npv:number; built_area_m2:number; apartment_area_m2:number; construction_cost:number; total_cost:number; payback_month:number|null;
  land_cost:number; design_cost:number; commission_cost:number; marketing_cost:number; tax_cost:number; central_office_cost:number;
  financial_cost:number; contingency_cost:number;
};
type Study = {
  id:string; name:string; code:string|null; status:string; converted_project_id:string|null;
  approved_metrics:FeasibilityMetrics|null; approved_cashflow:CashflowRow[]|null;
  construction_start_date:string|null; preconstruction_months:number|null; project_type:string|null; city:string|null; state:string|null;
  legal_entity_id:string|null; apartment_cost_m2:number|null; garage_stairs_area_m2:number|null; garage_stairs_cost_m2:number|null;
  lobby_area_m2:number|null; lobby_cost_m2:number|null; decorated_common_area_m2:number|null; decorated_common_cost_m2:number|null;
  design_cost_m2:number|null; contingency_pct:number|null; land_cash_amount:number|null; iptu_amount:number|null; onerous_grant_amount:number|null;
  other_land_amount:number|null; commission_pct:number|null; tax_regime:string|null; tax_rate_pct:number|null; marketing_amount:number|null;
  central_office_amount:number|null; financial_cost_amount:number|null; construction_duration_months:number|null; sales_start_offset_months:number|null;
  sales_velocity_units_month:number|null; entry_pct:number|null; during_construction_pct:number|null; keys_pct:number|null; post_keys_pct:number|null;
  post_keys_months:number|null; discount_rate_annual_pct:number|null; notes:string|null;
  vgv_cub_index_name:string|null; vgv_cub_reference_month:string|null; vgv_cub_base_value:number|null;
  cost_cub_index_name:string|null; cost_cub_reference_month:string|null; cost_cub_base_value:number|null;
};
type Entity = { id:string; legal_name:string; trade_name:string|null; entity_type:string };

function money(value: unknown) { return new Intl.NumberFormat("pt-BR", { style:"currency", currency:"BRL", maximumFractionDigits:0 }).format(Number(value ?? 0)); }
function number(value: unknown, digits = 1) { return Number(value ?? 0).toLocaleString("pt-BR", { maximumFractionDigits:digits }); }
function pct(value: unknown) { return value == null || !Number.isFinite(Number(value)) ? "—" : `${number(value, 1)}%`; }
function monthLabel(study: Study, month: number) {
  if (!study.construction_start_date) return `Mês ${month}`;
  const start = new Date(`${study.construction_start_date}T12:00:00`);
  start.setMonth(start.getMonth() - Number(study.preconstruction_months ?? 0) + month);
  return new Intl.DateTimeFormat("pt-BR", { month:"short", year:"2-digit" }).format(start);
}

export default async function FeasibilityStudyPage({ params, searchParams }: { params: Promise<{ studyId:string }>; searchParams: Promise<{ error?:string; success?:string }> }) {
  const { studyId } = await params;
  const messages = await searchParams;
  const { supabase, company, companyId, roleKey } = await requireCompanyPermission("commercial.incorporation.view");
  const [studyResult, unitsResult, constructionAreasResult, salesVelocitiesResult, entitiesResult, manageResult, approveResult] = await Promise.all([
    supabase.from("commercial_feasibility_studies").select("*").eq("id", studyId).eq("company_id", companyId).maybeSingle(),
    supabase.from("commercial_feasibility_unit_types").select("*").eq("study_id", studyId).eq("company_id", companyId).order("sort_order").order("name"),
    supabase.from("commercial_feasibility_construction_areas").select("*").eq("study_id", studyId).eq("company_id", companyId).order("sort_order").order("name"),
    supabase.from("commercial_feasibility_sales_velocities").select("*").eq("study_id", studyId).eq("company_id", companyId).order("start_offset_months").order("sort_order"),
    supabase.from("legal_entities").select("id,legal_name,trade_name,entity_type").eq("company_id", companyId).eq("status", "active").order("legal_name"),
    supabase.rpc("has_company_permission", { target_company_id:companyId, target_permission:"commercial.incorporation.manage" }),
    supabase.rpc("has_company_permission", { target_company_id:companyId, target_permission:"commercial.incorporation.approve" }),
  ]);
  if (!studyResult.data) notFound();
  const study = studyResult.data as Study;
  const unitTypes = (unitsResult.data ?? []) as FeasibilityUnitType[];
  const constructionAreas = (constructionAreasResult.data ?? []) as FeasibilityConstructionArea[];
  const salesVelocities = (salesVelocitiesResult.data ?? []) as FeasibilitySalesVelocity[];
  const entities = (entitiesResult.data ?? []) as Entity[];
  const canManage = roleKey === "owner" || roleKey === "admin" || manageResult.data === true;
  const canApprove = roleKey === "owner" || roleKey === "admin" || approveResult.data === true;
  const editable = study.status === "draft" && canManage;
  const calculated = study.status === "converted" && study.approved_metrics
    ? { ...study.approved_metrics, cashflow: study.approved_cashflow ?? [] }
    : calculateFeasibility(study, unitTypes, { constructionAreas, salesVelocities });
  const cashflow = (calculated.cashflow ?? []) as CashflowRow[];
  const totalPayment = Number(study.entry_pct ?? 0) + Number(study.during_construction_pct ?? 0) + Number(study.keys_pct ?? 0) + Number(study.post_keys_pct ?? 0);

  const costRows = [
    ["Terreno e Viabilização", calculated.land_cost],
    ["Projetos e Aprovações", calculated.design_cost],
    ["Obra", calculated.construction_cost],
    ["Comercial / Comissão", calculated.commission_cost],
    ["Marketing", calculated.marketing_cost],
    ["Impostos sobre vendas", calculated.tax_cost],
    ["Escritório Central", calculated.central_office_cost],
    ["Financeiro", calculated.financial_cost],
    ["Contingência", calculated.contingency_cost],
  ];

  const managedStructureError = constructionAreasResult.error || salesVelocitiesResult.error;

  return <AppShell activeGroup="commercial" activeItem="feasibility"
    eyebrow="Comercial · Incorporação · Viabilidade" title={study.name}
    description={`${company.name} · ${study.code ? `${study.code} · ` : ""}${study.status === "converted" ? "baseline econômico aprovado" : "estudo em elaboração"}`}
    actions={<><Link className="elos-button" prefetch={false} href="/comercial/incorporacao/viabilidade">Todos os estudos</Link>{study.converted_project_id ? <Link className="elos-button" prefetch={false} href="/empreendimentos">Abrir empreendimentos</Link> : null}</>}>
    {messages.error ? <div className="auth-message error workspace-message">{messages.error}</div> : null}
    {messages.success ? <div className="auth-message success workspace-message">{messages.success}</div> : null}
    {studyResult.error || unitsResult.error || managedStructureError ? <div className="auth-message error workspace-message">A estrutura de viabilidade precisa estar atualizada. Aplique a migration mais recente para gerenciar áreas e velocidades de venda.</div> : null}

    <section className="feasibility-kpis">
      <article><span>VGV bruto</span><strong>{money(calculated.gross_vgv)}</strong><small>{calculated.total_units} unidade(s)</small></article>
      <article><span>Permuta física</span><strong>{money(calculated.barter_vgv)}</strong><small>{calculated.barter_units} unidade(s) fora do VGV disponível</small></article>
      <article><span>VGV disponível</span><strong>{money(calculated.available_vgv)}</strong><small>{calculated.available_units} unidade(s) comercializável(is)</small></article>
      <article className={Number(calculated.profit) >= 0 ? "positive" : "danger"}><span>Lucro projetado</span><strong>{money(calculated.profit)}</strong><small>após todos os custos estimados</small></article>
      <article className={Number(calculated.margin_pct) >= 20 ? "positive" : ""}><span>Margem</span><strong>{pct(calculated.margin_pct)}</strong><small>sobre VGV disponível</small></article>
      <article><span>TIR do projeto</span><strong>{pct(calculated.irr_annual_pct)}</strong><small>{calculated.irr_monthly_pct == null ? "fluxo ainda insuficiente" : `${pct(calculated.irr_monthly_pct)} a.m.`}</small></article>
      <article className="danger"><span>Exposição máxima</span><strong>{money(calculated.exposure_max)}</strong><small>{monthLabel(study, Number(calculated.exposure_month ?? 0))}</small></article>
      <article><span>VPL</span><strong>{money(calculated.npv)}</strong><small>taxa de desconto {pct(study.discount_rate_annual_pct)} a.a.</small></article>
      <article><span>Área construída</span><strong>{number(calculated.built_area_m2, 0)} m²</strong><small>{number(calculated.apartment_area_m2, 0)} m² em apartamentos</small></article>
      <article><span>Custo da obra</span><strong>{money(calculated.construction_cost)}</strong><small>{calculated.built_area_m2 > 0 ? money(Number(calculated.construction_cost) / Number(calculated.built_area_m2)) : "—"} / m² médio</small></article>
      <article><span>Custo total</span><strong>{money(calculated.total_cost)}</strong><small>{calculated.available_vgv > 0 ? pct(Number(calculated.total_cost) / Number(calculated.available_vgv) * 100) : "—"} do VGV disponível</small></article>
      <article><span>Payback</span><strong>{calculated.payback_month == null ? "—" : monthLabel(study, Number(calculated.payback_month))}</strong><small>retorno acumulado ao caixa positivo</small></article>
    </section>

    {study.status === "converted" ? <div className="feasibility-note"><strong>Baseline aprovado e congelado.</strong> Este estudo originou o empreendimento e permanece como referência histórica para comparar a viabilidade inicial com a previsão atual e o realizado.</div> : null}

    <FeasibilityCubBaseline
      studyId={study.id}
      editable={editable}
      vgvIndexName={study.vgv_cub_index_name}
      vgvReferenceMonth={study.vgv_cub_reference_month}
      vgvBaseValue={study.vgv_cub_base_value}
      costIndexName={study.cost_cub_index_name}
      costReferenceMonth={study.cost_cub_reference_month}
      costBaseValue={study.cost_cub_base_value}
      grossVgv={Number(calculated.gross_vgv ?? 0)}
      availableVgv={Number(calculated.available_vgv ?? 0)}
      constructionCost={Number(calculated.construction_cost ?? 0)}
      totalCost={Number(calculated.total_cost ?? 0)}
    />

    <form action={updateFeasibilityStudy}>
      <input type="hidden" name="study_id" value={study.id} />
      <section className="feasibility-card feasibility-section">
        <div className="feasibility-section-title"><div><span>Identificação</span><h2>Oportunidade e premissas gerais</h2></div><p>O estudo pode existir antes da SPE; a empresa fiscal pode ser vinculada antes da aprovação.</p></div>
        <div className="feasibility-form">
          <label className="span-2">Nome<input name="name" defaultValue={study.name} disabled={!editable} required /></label>
          <label>Código<input name="code" defaultValue={study.code ?? ""} disabled={!editable} /></label>
          <label>Tipo<select name="project_type" defaultValue={study.project_type ?? "residential"} disabled={!editable}><option value="residential">Residencial</option><option value="commercial">Comercial</option><option value="mixed">Misto</option><option value="other">Outro</option></select></label>
          <label>Cidade<input name="city" defaultValue={study.city ?? ""} disabled={!editable} /></label>
          <label>UF<input name="state" maxLength={2} defaultValue={study.state ?? ""} disabled={!editable} /></label>
          <label className="span-2">Empresa / SPE<select name="legal_entity_id" defaultValue={study.legal_entity_id ?? ""} disabled={!editable}><option value="">Definir depois</option>{entities.map(entity => <option key={entity.id} value={entity.id}>{entity.trade_name || entity.legal_name} · {entity.entity_type}</option>)}</select></label>
        </div>
      </section>

      <section className="feasibility-card feasibility-section">
        <div className="feasibility-section-title"><div><span>Custo da obra</span><h2>Premissas gerais da construção</h2></div><p>As áreas adicionais são cadastradas e gerenciadas logo abaixo, com custo/m² individual.</p></div>
        <div className="feasibility-form">
          <label>Área apartamentos<input value={number(calculated.apartment_area_m2, 2)} disabled /></label>
          <label>Custo apartamentos / m²<input name="apartment_cost_m2" type="number" step="0.01" min="0" defaultValue={study.apartment_cost_m2 ?? 0} disabled={!editable} /></label>
          <label>Projetos / m² construído<input name="design_cost_m2" type="number" step="0.01" min="0" defaultValue={study.design_cost_m2 ?? 0} disabled={!editable} /></label>
          <label>Contingência obra (%)<input name="contingency_pct" type="number" step="0.01" min="0" max="100" defaultValue={study.contingency_pct ?? 0} disabled={!editable} /></label>
        </div>
        <input type="hidden" name="garage_stairs_area_m2" value={study.garage_stairs_area_m2 ?? 0} />
        <input type="hidden" name="garage_stairs_cost_m2" value={study.garage_stairs_cost_m2 ?? 0} />
        <input type="hidden" name="lobby_area_m2" value={study.lobby_area_m2 ?? 0} />
        <input type="hidden" name="lobby_cost_m2" value={study.lobby_cost_m2 ?? 0} />
        <input type="hidden" name="decorated_common_area_m2" value={study.decorated_common_area_m2 ?? 0} />
        <input type="hidden" name="decorated_common_cost_m2" value={study.decorated_common_cost_m2 ?? 0} />
      </section>

      <section className="feasibility-card feasibility-section">
        <div className="feasibility-section-title"><div><span>Terreno e Viabilização</span><h2>Desembolsos do terreno</h2></div><p>A permuta física não entra aqui: ela reduz o VGV disponível.</p></div>
        <div className="feasibility-form">
          <label>Valor em dinheiro ao proprietário<input name="land_cash_amount" type="number" step="0.01" min="0" defaultValue={study.land_cash_amount ?? 0} disabled={!editable} /></label>
          <label>IPTU assumido<input name="iptu_amount" type="number" step="0.01" min="0" defaultValue={study.iptu_amount ?? 0} disabled={!editable} /></label>
          <label>Outorga onerosa prevista<input name="onerous_grant_amount" type="number" step="0.01" min="0" defaultValue={study.onerous_grant_amount ?? 0} disabled={!editable} /></label>
          <label>Outros custos do terreno<input name="other_land_amount" type="number" step="0.01" min="0" defaultValue={study.other_land_amount ?? 0} disabled={!editable} /></label>
        </div>
      </section>

      <section className="feasibility-card feasibility-section">
        <div className="feasibility-section-title"><div><span>Venda, tributação e estrutura</span><h2>Custos da incorporação</h2></div><p>RET sugere 4%; a alíquota permanece editável e congelada no estudo aprovado.</p></div>
        <div className="feasibility-form">
          <label>Comissão de venda (%)<input name="commission_pct" type="number" step="0.01" min="0" max="100" defaultValue={study.commission_pct ?? 6} disabled={!editable} /></label>
          <TaxRegimeFields regime={study.tax_regime ?? "ret"} rate={Number(study.tax_rate_pct ?? 4)} disabled={!editable} />
          <label>Marketing total<input name="marketing_amount" type="number" step="0.01" min="0" defaultValue={study.marketing_amount ?? 0} disabled={!editable} /></label>
          <label>Escritório Central<input name="central_office_amount" type="number" step="0.01" min="0" defaultValue={study.central_office_amount ?? 0} disabled={!editable} /></label>
          <label>Custo financeiro previsto<input name="financial_cost_amount" type="number" step="0.01" min="0" defaultValue={study.financial_cost_amount ?? 0} disabled={!editable} /></label>
        </div>
      </section>

      <section className="feasibility-card feasibility-section">
        <div className="feasibility-section-title"><div><span>Prazo e recebimentos</span><h2>Fluxo do empreendimento</h2></div><p>As velocidades de venda são gerenciadas por fases logo abaixo.</p></div>
        <div className="feasibility-form">
          <label>Meses de pré-obra<input name="preconstruction_months" type="number" min="0" max="60" defaultValue={study.preconstruction_months ?? 6} disabled={!editable} /></label>
          <label>Início previsto da obra<input name="construction_start_date" type="date" defaultValue={study.construction_start_date ?? ""} disabled={!editable} /></label>
          <label>Duração da obra (meses)<input name="construction_duration_months" type="number" min="1" max="180" defaultValue={study.construction_duration_months ?? 36} disabled={!editable} /></label>
          <label>Entrada (%)<input name="entry_pct" type="number" min="0" max="100" step="0.01" defaultValue={study.entry_pct ?? 10} disabled={!editable} /></label>
          <label>Durante obra (%)<input name="during_construction_pct" type="number" min="0" max="100" step="0.01" defaultValue={study.during_construction_pct ?? 40} disabled={!editable} /></label>
          <label>Chaves (%)<input name="keys_pct" type="number" min="0" max="100" step="0.01" defaultValue={study.keys_pct ?? 20} disabled={!editable} /></label>
          <label>Pós-chaves (%)<input name="post_keys_pct" type="number" min="0" max="100" step="0.01" defaultValue={study.post_keys_pct ?? 30} disabled={!editable} /></label>
          <label>Pós-chaves (meses)<input name="post_keys_months" type="number" min="1" max="240" defaultValue={study.post_keys_months ?? 24} disabled={!editable} /></label>
          <label>Taxa de desconto VPL (% a.a.)<input name="discount_rate_annual_pct" type="number" step="0.01" defaultValue={study.discount_rate_annual_pct ?? 15} disabled={!editable} /></label>
          <label className="span-2">Notas<textarea name="notes" defaultValue={study.notes ?? ""} disabled={!editable} /></label>
        </div>
        <input type="hidden" name="sales_start_offset_months" value={study.sales_start_offset_months ?? -3} />
        <input type="hidden" name="sales_velocity_units_month" value={study.sales_velocity_units_month ?? 2} />
        <div className={`feasibility-note ${Math.abs(totalPayment - 100) > 0.001 ? "feasibility-warning" : ""}`} style={{marginTop:12}}>Fluxo do cliente: {number(totalPayment,2)}% distribuído entre entrada, obra, chaves e pós-chaves. A obra utiliza uma curva física estimada em S para projetar os desembolsos.</div>
        {editable ? <div className="feasibility-actions"><button className="feasibility-primary" type="submit">Salvar e recalcular</button></div> : null}
      </section>
    </form>

    <FeasibilityUnitTypesManager studyId={study.id} unitTypes={unitTypes} editable={editable} />
    <FeasibilityConstructionAreasManager
      studyId={study.id}
      constructionAreas={constructionAreas}
      apartmentAreaM2={Number(calculated.apartment_area_m2 ?? 0)}
      apartmentCostM2={Number(study.apartment_cost_m2 ?? 0)}
      editable={editable}
    />
    <FeasibilitySalesVelocitiesManager studyId={study.id} salesVelocities={salesVelocities} editable={editable} />

    <section className="feasibility-two feasibility-section">
      <div className="feasibility-card"><div className="feasibility-section-title"><div><span>Resultado econômico</span><h2>Composição dos custos</h2></div></div><div className="registry-table-wrap"><table className="registry-table feasibility-metric-table"><thead><tr><th>Conta</th><th>Valor</th></tr></thead><tbody>{costRows.map(([label,value]) => <tr key={String(label)}><td>{label}</td><td><strong>{money(value)}</strong></td></tr>)}<tr><td><strong>Custo total</strong></td><td><strong>{money(calculated.total_cost)}</strong></td></tr><tr><td><strong>Lucro</strong></td><td><strong>{money(calculated.profit)}</strong></td></tr></tbody></table></div></div>
      <div className="feasibility-card"><div className="feasibility-section-title"><div><span>Terreno</span><h2>Carga econômica</h2></div></div><p className="feasibility-note">A permuta é apresentada como carga econômica do terreno para comparação entre oportunidades, mas não é somada novamente ao custo da DRE.</p><div className="registry-table-wrap"><table className="registry-table feasibility-metric-table"><tbody><tr><td>Permuta física pelo VGV</td><td><strong>{money(calculated.barter_vgv)}</strong></td></tr><tr><td>Terreno e Viabilização em caixa</td><td><strong>{money(calculated.land_cost)}</strong></td></tr><tr><td><strong>Carga econômica do terreno</strong></td><td><strong>{money(Number(calculated.barter_vgv)+Number(calculated.land_cost))}</strong></td></tr><tr><td>Carga / VGV bruto</td><td><strong>{calculated.gross_vgv > 0 ? pct((Number(calculated.barter_vgv)+Number(calculated.land_cost))/Number(calculated.gross_vgv)*100) : "—"}</strong></td></tr></tbody></table></div></div>
    </section>

    <section className="feasibility-card feasibility-section">
      <div className="feasibility-section-title"><div><span>Fluxo projetado</span><h2>Entradas, saídas e exposição de caixa</h2></div><p>{cashflow.length} mês(es) simulados</p></div>
      <div className="registry-table-wrap feasibility-flow"><table className="registry-table"><thead><tr><th>Mês</th><th>Vendas</th><th>Recebimentos</th><th>Terreno</th><th>Projetos</th><th>Obra</th><th>Comissão</th><th>Impostos</th><th>Marketing</th><th>Central</th><th>Financeiro</th><th>Contingência</th><th>Caixa mês</th><th>Acumulado</th></tr></thead><tbody>{cashflow.map(row => <tr key={row.month}><td><strong>{monthLabel(study,row.month)}</strong></td><td>{money(row.sales)}</td><td>{money(row.receipts)}</td><td>{money(row.land)}</td><td>{money(row.projects)}</td><td>{money(row.construction)}</td><td>{money(row.commission)}</td><td>{money(row.taxes)}</td><td>{money(row.marketing)}</td><td>{money(row.centralOffice)}</td><td>{money(row.financial)}</td><td>{money(row.contingency)}</td><td><strong>{money(row.net)}</strong></td><td><strong>{money(row.cumulative)}</strong></td></tr>)}</tbody></table></div>
    </section>

    {study.status === "draft" && canApprove ? <section className="feasibility-card feasibility-section">
      <div className="feasibility-section-title"><div><span>Decisão de investimento</span><h2>Aprovar permuta e criar empreendimento</h2></div><p>Esta ação congela o estudo e cria a obra em Planejamento.</p></div>
      <div className="feasibility-note feasibility-warning">Depois da aprovação, as premissas deste estudo não poderão ser alteradas. O snapshot passa a ser o baseline econômico original do empreendimento.</div>
      <form action={approveAndConvertFeasibilityStudy} className="feasibility-actions"><input type="hidden" name="study_id" value={study.id}/><button className="feasibility-primary" type="submit">Aprovar permuta e criar empreendimento</button></form>
    </section> : null}
  </AppShell>;
}