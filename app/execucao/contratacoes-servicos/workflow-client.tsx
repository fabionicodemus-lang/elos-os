"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  generateContractFromCompetition,
  saveContractStages,
  saveServiceCompetitionOffer,
  saveServiceRequest,
  startServiceCompetition,
} from "./actions";

export type SupplierOption = { id: string; legal_name: string; trade_name: string | null; tax_id: string | null };
export type BudgetOption = { id: string; code: string | null; name: string };
export type ServiceOption = { id: string; code: string; description: string; unit: string };
export type LocationOption = { id: string; code: string; name: string };
export type ActivityOption = { id: string; service_id: string | null; location_id: string | null; code: string; name: string; planned_start: string; planned_finish: string };
export type RequestRecord = {
  id: string; budget_id: string | null; request_number: string; title: string; scope_summary: string; status: string;
  needed_start: string | null; needed_finish: string | null; notes: string | null;
};
export type RequestItem = {
  id?: string; request_id?: string; service_id: string; location_id: string | null; schedule_activity_id: string | null;
  service_code: string; service_name: string; location_name: string | null; unit_snapshot: string;
  requested_quantity: number; estimated_unit_price: number; estimated_total: number; scope_notes: string | null; measurement_notes: string | null;
};
export type CompetitionRecord = {
  id: string; request_id: string; competition_number: string; title: string; status: string; response_deadline: string | null;
  award_criteria: string; notes: string | null; winner_offer_id: string | null; winner_supplier_id: string | null; generated_contract_id: string | null;
};
export type OfferRecord = {
  id: string; competition_id: string; supplier_id: string; status: string; proposal_number: string | null; proposal_date: string | null;
  validity_date: string | null; payment_days: number; proposed_start: string | null; proposed_finish: string | null;
  total_amount: number; technical_score: number | null; commercial_score: number | null; notes: string | null;
};
export type OfferItemRecord = {
  id?: string; offer_id?: string; request_item_id: string; offered_quantity: number; unit_price: number; total_amount: number;
  meets_specification: boolean; notes: string | null;
};
export type ContractItemRecord = {
  id: string; contract_id: string; service_id: string; location_id: string | null; service_code: string; service_name: string;
  location_name: string | null; unit_snapshot: string; contracted_quantity: number; unit_price: number; total_value: number;
};
export type ContractStageRecord = {
  id?: string; contract_item_id: string; stage_code: string; stage_name: string; description: string | null; measurement_mode: "quantity" | "percent";
  weight_percent: number; unit_snapshot?: string; contracted_quantity?: number; unit_price?: number; total_value?: number;
};

type StageDraft = { code: string; name: string; description: string; measurement_mode: "quantity" | "percent"; weight_percent: number };
type StageGroup = { key: string; name: string; value: number; stages: StageDraft[] };

function money(value: number) { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value || 0)); }
function number(value: number, digits = 4) { return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: digits }).format(Number(value || 0)); }
function today() { return new Date().toISOString().slice(0, 10); }
function addMonths(value: string, months: number) { const date = new Date(`${value}T12:00:00Z`); date.setUTCMonth(date.getUTCMonth() + months); return date.toISOString().slice(0, 10); }
function supplierName(supplier?: SupplierOption | null) { return supplier ? supplier.trade_name || supplier.legal_name : "Fornecedor"; }
function defaultStage(): StageDraft { return { code: "ET-01", name: "Serviço completo", description: "", measurement_mode: "quantity", weight_percent: 100 }; }
function emptyRequestItem(): RequestItem {
  return { service_id: "", location_id: null, schedule_activity_id: null, service_code: "", service_name: "", location_name: null, unit_snapshot: "", requested_quantity: 1, estimated_unit_price: 0, estimated_total: 0, scope_notes: null, measurement_notes: null };
}

export function ServiceRequestDialog({ budgets, services, locations, activities, request, items = [], autoOpen = false, label }: {
  budgets: BudgetOption[]; services: ServiceOption[]; locations: LocationOption[]; activities: ActivityOption[];
  request?: RequestRecord | null; items?: RequestItem[]; autoOpen?: boolean; label?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [rows, setRows] = useState<RequestItem[]>(items.length ? items : [emptyRequestItem()]);
  const serviceMap = useMemo(() => new Map(services.map((item) => [item.id, item])), [services]);
  const locationMap = useMemo(() => new Map(locations.map((item) => [item.id, item])), [locations]);
  const activityMap = useMemo(() => new Map(activities.map((item) => [item.id, item])), [activities]);
  useEffect(() => { if (autoOpen) dialog.current?.showModal(); }, [autoOpen]);
  const estimate = rows.reduce((sum, row) => sum + Number(row.requested_quantity || 0) * Number(row.estimated_unit_price || 0), 0);

  function update(index: number, patch: Partial<RequestItem>) {
    setRows((current) => current.map((row, rowIndex) => rowIndex === index ? {
      ...row, ...patch,
      estimated_total: Number((Number(patch.requested_quantity ?? row.requested_quantity) * Number(patch.estimated_unit_price ?? row.estimated_unit_price)).toFixed(2)),
    } : row));
  }
  function chooseService(index: number, serviceId: string) {
    const service = serviceMap.get(serviceId);
    update(index, service ? { service_id: service.id, service_code: service.code, service_name: service.description, unit_snapshot: service.unit } : emptyRequestItem());
  }
  function chooseActivity(index: number, activityId: string) {
    const activity = activityMap.get(activityId);
    if (!activity) { update(index, { schedule_activity_id: null }); return; }
    const service = activity.service_id ? serviceMap.get(activity.service_id) : null;
    const location = activity.location_id ? locationMap.get(activity.location_id) : null;
    update(index, {
      schedule_activity_id: activity.id,
      service_id: activity.service_id ?? "",
      service_code: service?.code ?? activity.code,
      service_name: service?.description ?? activity.name,
      unit_snapshot: service?.unit ?? "vb",
      location_id: activity.location_id,
      location_name: location ? `${location.code} · ${location.name}` : null,
    });
  }
  const payload = rows.filter((row) => row.service_id && row.requested_quantity > 0).map((row) => ({
    service_id: row.service_id,
    location_id: row.location_id,
    schedule_activity_id: row.schedule_activity_id,
    quantity: row.requested_quantity,
    estimated_unit_price: row.estimated_unit_price,
    scope_notes: row.scope_notes,
    measurement_notes: row.measurement_notes,
  }));

  return <>
    <button className="elos-button" type="button" onClick={() => dialog.current?.showModal()}>{label ?? (request ? "Editar solicitação" : "+ Solicitar serviço")}</button>
    <dialog ref={dialog} className="contract-workflow-dialog wide">
      <form action={saveServiceRequest}>
        <input type="hidden" name="request_id" value={request?.id ?? ""} />
        <input type="hidden" name="items_json" value={JSON.stringify(payload)} />
        <header><div><span>Etapa 1</span><h2>Solicitação de Serviços</h2><p>A obra define o que precisa contratar antes de consultar fornecedores.</p></div><button type="button" onClick={() => dialog.current?.close()}>×</button></header>
        <div className="workflow-dialog-body">
          <section className="workflow-form-grid">
            <label>Orçamento aprovado<select name="budget_id" defaultValue={request?.budget_id ?? ""}><option value="">Sem vínculo específico</option>{budgets.map((budget) => <option key={budget.id} value={budget.id}>{budget.code ? `${budget.code} · ` : ""}{budget.name}</option>)}</select></label>
            <label>Início necessário<input name="needed_start" type="date" defaultValue={request?.needed_start ?? ""} /></label>
            <label>Conclusão necessária<input name="needed_finish" type="date" defaultValue={request?.needed_finish ?? ""} /></label>
            <label className="span3">Título da contratação<input name="title" defaultValue={request?.title ?? ""} placeholder="Ex.: Contratação do reboco interno" required /></label>
            <label className="span3">Escopo geral<textarea name="scope_summary" rows={3} defaultValue={request?.scope_summary ?? ""} placeholder="Inclua fornecimentos, responsabilidades, exclusões e requisitos técnicos." required /></label>
          </section>
          <section className="workflow-items-section">
            <div className="workflow-section-head"><div><span>Serviços solicitados</span><h3>Escopo vinculado ao orçamento e cronograma</h3></div><strong>{money(estimate)}</strong></div>
            {rows.map((row, index) => <article className="workflow-item-card" key={index}>
              <b>{String(index + 1).padStart(2, "0")}</b>
              <div className="workflow-item-fields">
                <label className="span3">Atividade do cronograma<select value={row.schedule_activity_id ?? ""} onChange={(event) => chooseActivity(index, event.target.value)}><option value="">Vincular manualmente</option>{activities.map((activity) => <option key={activity.id} value={activity.id}>{activity.code} · {activity.name}</option>)}</select></label>
                <label className="span3">Serviço / centro de custo<select value={row.service_id} onChange={(event) => chooseService(index, event.target.value)} required><option value="">Selecione</option>{services.map((service) => <option key={service.id} value={service.id}>{service.code} · {service.description} · {service.unit}</option>)}</select></label>
                <label>Local<select value={row.location_id ?? ""} onChange={(event) => { const location = locationMap.get(event.target.value); update(index, { location_id: event.target.value || null, location_name: location ? `${location.code} · ${location.name}` : null }); }}><option value="">Todos / geral</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.code} · {location.name}</option>)}</select></label>
                <label>Quantidade<input type="number" min="0.000001" step="0.000001" value={row.requested_quantity} onChange={(event) => update(index, { requested_quantity: Number(event.target.value) })} /></label>
                <label>Unidade<input value={row.unit_snapshot} readOnly /></label>
                <label>Preço estimado<input type="number" min="0" step="0.000001" value={row.estimated_unit_price} onChange={(event) => update(index, { estimated_unit_price: Number(event.target.value) })} /></label>
                <label className="span3">Detalhes do escopo<input value={row.scope_notes ?? ""} onChange={(event) => update(index, { scope_notes: event.target.value })} placeholder="Critérios técnicos, inclusões e exclusões" /></label>
                <label className="span3">Critério preliminar de medição<input value={row.measurement_notes ?? ""} onChange={(event) => update(index, { measurement_notes: event.target.value })} placeholder="Ex.: medir por m² aprovado em cada pavimento" /></label>
              </div>
              <button type="button" className="workflow-remove" onClick={() => setRows((current) => current.length === 1 ? [emptyRequestItem()] : current.filter((_, rowIndex) => rowIndex !== index))}>Remover</button>
            </article>)}
            <button type="button" className="workflow-add" onClick={() => setRows((current) => [...current, emptyRequestItem()])}>+ Adicionar serviço</button>
          </section>
          <label className="workflow-notes">Observações<textarea name="notes" rows={3} defaultValue={request?.notes ?? ""} /></label>
        </div>
        <footer><span>{payload.length} serviço(s) · estimativa {money(estimate)}</span><div><button type="button" onClick={() => dialog.current?.close()}>Cancelar</button><button className="primary" type="submit" disabled={!payload.length}>Salvar solicitação</button></div></footer>
      </form>
    </dialog>
  </>;
}

export function CompetitionStartDialog({ request }: { request: RequestRecord }) {
  const dialog = useRef<HTMLDialogElement>(null);
  return <>
    <button className="table-action" type="button" onClick={() => dialog.current?.showModal()}>Abrir concorrência</button>
    <dialog ref={dialog} className="contract-workflow-dialog compact"><form action={startServiceCompetition}>
      <input type="hidden" name="request_id" value={request.id} />
      <header><div><span>Etapa 2</span><h2>Abrir mapa de concorrência</h2><p>{request.request_number} · {request.title}</p></div><button type="button" onClick={() => dialog.current?.close()}>×</button></header>
      <div className="workflow-dialog-body workflow-form-grid">
        <label>Prazo para propostas<input name="response_deadline" type="date" /></label>
        <label className="span3">Critério de escolha<textarea name="award_criteria" rows={3} defaultValue="Melhor combinação de preço, prazo, capacidade técnica e condições comerciais" /></label>
        <label className="span3">Observações<textarea name="notes" rows={3} /></label>
      </div>
      <footer><span>O mapa ficará aberto para propostas.</span><div><button type="button" onClick={() => dialog.current?.close()}>Cancelar</button><button className="primary" type="submit">Abrir mapa</button></div></footer>
    </form></dialog>
  </>;
}

export function CompetitionOfferDialog({ competition, requestItems, suppliers, offer, offerItems = [], label }: {
  competition: CompetitionRecord; requestItems: RequestItem[]; suppliers: SupplierOption[]; offer?: OfferRecord | null; offerItems?: OfferItemRecord[]; label?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const itemMap = useMemo(() => new Map(offerItems.map((item) => [item.request_item_id, item])), [offerItems]);
  const [rows, setRows] = useState(() => requestItems.map((item) => ({
    request_item_id: item.id!,
    quantity: Number(itemMap.get(item.id!)?.offered_quantity ?? item.requested_quantity),
    unit_price: Number(itemMap.get(item.id!)?.unit_price ?? 0),
    meets_specification: itemMap.get(item.id!)?.meets_specification ?? true,
    notes: itemMap.get(item.id!)?.notes ?? "",
  })));
  const total = rows.reduce((sum, row) => sum + row.quantity * row.unit_price, 0);
  function update(id: string, patch: Partial<(typeof rows)[number]>) { setRows((current) => current.map((row) => row.request_item_id === id ? { ...row, ...patch } : row)); }
  const payload = rows.map((row) => ({ request_item_id: row.request_item_id, quantity: row.quantity, unit_price: row.unit_price, meets_specification: row.meets_specification, notes: row.notes || null }));
  return <>
    <button className="table-action" type="button" onClick={() => dialog.current?.showModal()}>{label ?? (offer ? "Editar proposta" : "+ Incluir proposta")}</button>
    <dialog ref={dialog} className="contract-workflow-dialog wide"><form action={saveServiceCompetitionOffer}>
      <input type="hidden" name="competition_id" value={competition.id} /><input type="hidden" name="offer_id" value={offer?.id ?? ""} /><input type="hidden" name="items_json" value={JSON.stringify(payload)} />
      <header><div><span>Etapa 2</span><h2>Proposta do fornecedor</h2><p>{competition.competition_number} · valores e condições para comparação.</p></div><button type="button" onClick={() => dialog.current?.close()}>×</button></header>
      <div className="workflow-dialog-body">
        <section className="workflow-form-grid">
          <label className="span2">Fornecedor<select name="supplier_id" defaultValue={offer?.supplier_id ?? ""} required><option value="">Selecione</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplierName(supplier)}{supplier.tax_id ? ` · ${supplier.tax_id}` : ""}</option>)}</select></label>
          <label>Nº proposta<input name="proposal_number" defaultValue={offer?.proposal_number ?? ""} /></label>
          <label>Data da proposta<input name="proposal_date" type="date" defaultValue={offer?.proposal_date ?? today()} /></label>
          <label>Validade<input name="validity_date" type="date" defaultValue={offer?.validity_date ?? ""} /></label>
          <label>Prazo de pagamento (dias)<input name="payment_days" type="number" min="0" max="365" defaultValue={offer?.payment_days ?? 15} /></label>
          <label>Início proposto<input name="proposed_start" type="date" defaultValue={offer?.proposed_start ?? ""} /></label>
          <label>Conclusão proposta<input name="proposed_finish" type="date" defaultValue={offer?.proposed_finish ?? ""} /></label>
          <label>Nota técnica (0–100)<input name="technical_score" type="number" min="0" max="100" step="0.01" defaultValue={offer?.technical_score ?? ""} /></label>
          <label>Nota comercial (0–100)<input name="commercial_score" type="number" min="0" max="100" step="0.01" defaultValue={offer?.commercial_score ?? ""} /></label>
        </section>
        <section className="offer-items"><div className="workflow-section-head"><div><span>Composição da proposta</span><h3>Preço por serviço solicitado</h3></div><strong>{money(total)}</strong></div>
          {requestItems.map((item) => { const row = rows.find((entry) => entry.request_item_id === item.id)!; return <article key={item.id}>
            <div><strong>{item.service_code} · {item.service_name}</strong><span>{item.location_name || "Todos / geral"} · {number(item.requested_quantity)} {item.unit_snapshot}</span></div>
            <label>Quantidade<input type="number" min="0.000001" step="0.000001" value={row.quantity} onChange={(event) => update(item.id!, { quantity: Number(event.target.value) })} /></label>
            <label>Preço unitário<input type="number" min="0" step="0.000001" value={row.unit_price} onChange={(event) => update(item.id!, { unit_price: Number(event.target.value) })} /></label>
            <div><span>Total</span><strong>{money(row.quantity * row.unit_price)}</strong></div>
            <label className="offer-check"><input type="checkbox" checked={row.meets_specification} onChange={(event) => update(item.id!, { meets_specification: event.target.checked })} />Atende à especificação</label>
            <input value={row.notes} onChange={(event) => update(item.id!, { notes: event.target.value })} placeholder="Observações técnicas ou comerciais" />
          </article>; })}
        </section>
        <label className="workflow-notes">Observações gerais<textarea name="notes" rows={3} defaultValue={offer?.notes ?? ""} /></label>
      </div>
      <footer><span>Total proposto: {money(total)}</span><div><button type="button" onClick={() => dialog.current?.close()}>Cancelar</button><button className="primary" type="submit">Salvar proposta</button></div></footer>
    </form></dialog>
  </>;
}

function StageEditor({ groups, setGroups }: { groups: StageGroup[]; setGroups: React.Dispatch<React.SetStateAction<StageGroup[]>> }) {
  function updateStage(groupKey: string, index: number, patch: Partial<StageDraft>) {
    setGroups((current) => current.map((group) => group.key === groupKey ? { ...group, stages: group.stages.map((stage, stageIndex) => stageIndex === index ? { ...stage, ...patch } : stage) } : group));
  }
  function addStage(groupKey: string) {
    setGroups((current) => current.map((group) => group.key === groupKey ? { ...group, stages: [...group.stages, { code: `ET-${String(group.stages.length + 1).padStart(2, "0")}`, name: "", description: "", measurement_mode: "quantity", weight_percent: 0 }] } : group));
  }
  function removeStage(groupKey: string, index: number) {
    setGroups((current) => current.map((group) => group.key === groupKey ? { ...group, stages: group.stages.length === 1 ? [defaultStage()] : group.stages.filter((_, stageIndex) => stageIndex !== index) } : group));
  }
  return <section className="stage-editor"><div className="workflow-section-head"><div><span>Etapa 4</span><h3>Etapas que serão medidas</h3></div><p>Em cada serviço, os pesos devem fechar 100%.</p></div>
    {groups.map((group) => { const totalWeight = group.stages.reduce((sum, stage) => sum + Number(stage.weight_percent || 0), 0); return <article className="stage-group" key={group.key}>
      <header><div><strong>{group.name}</strong><span>Valor do serviço: {money(group.value)}</span></div><b className={Math.abs(totalWeight - 100) <= .001 ? "ok" : "error"}>{number(totalWeight, 2)}%</b></header>
      {group.stages.map((stage, index) => <div className="stage-row" key={index}>
        <input value={stage.code} onChange={(event) => updateStage(group.key, index, { code: event.target.value })} placeholder="Código" />
        <input value={stage.name} onChange={(event) => updateStage(group.key, index, { name: event.target.value })} placeholder="Nome da etapa: Chapisco, Reboco..." required />
        <select value={stage.measurement_mode} onChange={(event) => updateStage(group.key, index, { measurement_mode: event.target.value as "quantity" | "percent" })}><option value="quantity">Mesma quantidade do serviço</option><option value="percent">Avanço percentual / marco</option></select>
        <input type="number" min="0.0001" max="100" step="0.0001" value={stage.weight_percent} onChange={(event) => updateStage(group.key, index, { weight_percent: Number(event.target.value) })} />
        <span>{money(group.value * Number(stage.weight_percent || 0) / 100)}</span>
        <input value={stage.description} onChange={(event) => updateStage(group.key, index, { description: event.target.value })} placeholder="Critério de aceite e medição" />
        <button type="button" onClick={() => removeStage(group.key, index)}>×</button>
      </div>)}
      <button className="workflow-add-stage" type="button" onClick={() => addStage(group.key)}>+ Adicionar etapa</button>
    </article>; })}
  </section>;
}

export function ContractGenerationDialog({ competition, request, requestItems, winningOffer, winningItems, supplier }: {
  competition: CompetitionRecord; request: RequestRecord; requestItems: RequestItem[]; winningOffer: OfferRecord; winningItems: OfferItemRecord[]; supplier: SupplierOption | null;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const priceMap = useMemo(() => new Map(winningItems.map((item) => [item.request_item_id, item])), [winningItems]);
  const [startDate, setStartDate] = useState(winningOffer.proposed_start ?? request.needed_start ?? today());
  const [groups, setGroups] = useState<StageGroup[]>(() => requestItems.map((item) => ({ key: item.id!, name: `${item.service_code} · ${item.service_name}`, value: Number(priceMap.get(item.id!)?.total_amount ?? 0), stages: [defaultStage()] })));
  const valid = groups.every((group) => group.stages.length && group.stages.every((stage) => stage.name.trim()) && Math.abs(group.stages.reduce((sum, stage) => sum + Number(stage.weight_percent || 0), 0) - 100) <= .001);
  const payload = groups.map((group) => ({ request_item_id: group.key, stages: group.stages.map((stage) => ({ code: stage.code, name: stage.name, description: stage.description, measurement_mode: stage.measurement_mode, weight_percent: stage.weight_percent })) }));
  return <>
    <button className="elos-button" type="button" onClick={() => dialog.current?.showModal()}>Gerar contrato e etapas</button>
    <dialog ref={dialog} className="contract-workflow-dialog extra-wide"><form action={generateContractFromCompetition}>
      <input type="hidden" name="competition_id" value={competition.id} /><input type="hidden" name="stages_json" value={JSON.stringify(payload)} />
      <header><div><span>Etapas 3 e 4</span><h2>Formular contrato e etapas</h2><p>Fornecedor vencedor: {supplierName(supplier)} · {money(winningOffer.total_amount)}</p></div><button type="button" onClick={() => dialog.current?.close()}>×</button></header>
      <div className="workflow-dialog-body">
        <section className="workflow-form-grid">
          <label className="span3">Título do contrato<input name="title" defaultValue={request.title} required /></label>
          <label className="span3">Escopo contratual<textarea name="scope_summary" rows={3} defaultValue={request.scope_summary} required /></label>
          <label>Assinatura<input name="signed_date" type="date" /></label>
          <label>Início<input name="start_date" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} required /></label>
          <label>Fim<input name="end_date" type="date" defaultValue={winningOffer.proposed_finish ?? request.needed_finish ?? addMonths(startDate, 6)} required /></label>
          <label>Retenção contratual (%)<input name="retention_percent" type="number" min="0" max="100" step="0.01" defaultValue={5} /></label>
          <label>Garantia retida (%)<input name="guarantee_percent" type="number" min="0" max="100" step="0.01" defaultValue={0} /></label>
          <label>Garantia do serviço (meses)<input name="guarantee_months" type="number" min="0" max="240" defaultValue={60} /></label>
          <label>Prazo de pagamento (dias)<input name="payment_days" type="number" min="0" max="365" defaultValue={winningOffer.payment_days} /></label>
          <label>Índice de reajuste<input name="adjustment_index" placeholder="INCC, CUB-SC ou sem reajuste" /></label>
          <label>Data-base<input name="adjustment_base_date" type="date" /></label>
          <label>Contato do fornecedor<input name="contact_name" /></label><label>Telefone<input name="contact_phone" /></label><label>E-mail<input name="contact_email" type="email" /></label>
        </section>
        <StageEditor groups={groups} setGroups={setGroups} />
        <label className="workflow-notes">Observações contratuais<textarea name="notes" rows={3} defaultValue={winningOffer.notes ?? ""} /></label>
      </div>
      <footer><span>{groups.length} serviço(s) · {groups.reduce((sum, group) => sum + group.value, 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</span><div><button type="button" onClick={() => dialog.current?.close()}>Cancelar</button><button className="primary" type="submit" disabled={!valid}>Gerar contrato</button></div></footer>
    </form></dialog>
  </>;
}

export function ContractStagesDialog({ contractId, items, stages, label = "Editar etapas" }: { contractId: string; items: ContractItemRecord[]; stages: ContractStageRecord[]; label?: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const stageMap = useMemo(() => {
    const map = new Map<string, ContractStageRecord[]>();
    stages.forEach((stage) => map.set(stage.contract_item_id, [...(map.get(stage.contract_item_id) ?? []), stage]));
    return map;
  }, [stages]);
  const [groups, setGroups] = useState<StageGroup[]>(() => items.map((item) => ({ key: item.id, name: `${item.service_code} · ${item.service_name}`, value: Number(item.total_value), stages: (stageMap.get(item.id) ?? []).map((stage) => ({ code: stage.stage_code, name: stage.stage_name, description: stage.description ?? "", measurement_mode: stage.measurement_mode, weight_percent: Number(stage.weight_percent) })) || [defaultStage()] })));
  const valid = groups.every((group) => group.stages.length && group.stages.every((stage) => stage.name.trim()) && Math.abs(group.stages.reduce((sum, stage) => sum + Number(stage.weight_percent || 0), 0) - 100) <= .001);
  const payload = groups.map((group) => ({ contract_item_id: group.key, stages: group.stages.map((stage) => ({ code: stage.code, name: stage.name, description: stage.description, measurement_mode: stage.measurement_mode, weight_percent: stage.weight_percent })) }));
  return <>
    <button className="table-action" type="button" onClick={() => dialog.current?.showModal()}>{label}</button>
    <dialog ref={dialog} className="contract-workflow-dialog extra-wide"><form action={saveContractStages}>
      <input type="hidden" name="contract_id" value={contractId} /><input type="hidden" name="stages_json" value={JSON.stringify(payload)} />
      <header><div><span>Etapa 4</span><h2>Etapas de medição do contrato</h2><p>Somente contratos em elaboração e sem medições podem ser alterados.</p></div><button type="button" onClick={() => dialog.current?.close()}>×</button></header>
      <div className="workflow-dialog-body"><StageEditor groups={groups} setGroups={setGroups} /></div>
      <footer><span>Cada serviço deve fechar exatamente 100%.</span><div><button type="button" onClick={() => dialog.current?.close()}>Cancelar</button><button className="primary" type="submit" disabled={!valid}>Salvar etapas</button></div></footer>
    </form></dialog>
  </>;
}
