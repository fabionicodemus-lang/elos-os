"use client";

import { useMemo, useRef, useState } from "react";
import {
  approveServiceCompetition,
  createContractFromServiceRequest,
  openServiceCompetition,
  saveServiceProposal,
  saveServiceRequest,
} from "./actions";

export type SupplierOption = { id: string; legal_name: string; trade_name: string | null; tax_id: string | null };
export type ServiceOption = { id: string; code: string; description: string; unit: string };
export type BudgetOption = { id: string; code: string | null; name: string };
export type LocationOption = { id: string; code: string; name: string };
export type ActivityOption = { id: string; service_id: string | null; location_id: string | null; code: string; name: string; planned_start: string; planned_finish: string };
export type ServiceRequestRecord = {
  id: string; request_number: string; title: string; scope_summary: string; status: string; budget_id: string | null;
  service_id: string; location_id: string | null; schedule_activity_id: string | null; service_code: string; service_name: string;
  unit_snapshot: string; location_name: string | null; requested_quantity: number; estimated_unit_price: number; estimated_total: number;
  desired_start: string; desired_finish: string; notes: string | null; selected_supplier_id: string | null;
  selected_proposal_id: string | null; approved_total: number | null; approval_justification: string | null; contract_id: string | null;
};
export type ProposalRecord = {
  id: string; request_id: string; supplier_id: string; supplier_name: string; proposal_number: string | null; proposal_date: string | null;
  validity_date: string | null; total_price: number; duration_days: number | null; payment_terms: string | null; warranty_months: number;
  technical_score: number; commercial_score: number; is_qualified: boolean; is_selected: boolean; notes: string | null;
};

type Stage = { name: string; weight_percent: number };

function money(value: number) { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value || 0)); }
function today() { return new Date().toISOString().slice(0, 10); }
function addMonths(value: string, months: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString().slice(0, 10);
}
function supplierLabel(supplier: SupplierOption) { return `${supplier.trade_name || supplier.legal_name}${supplier.tax_id ? ` · ${supplier.tax_id}` : ""}`; }

export function NewServiceRequestButton({ services, budgets, locations, activities }: {
  services: ServiceOption[]; budgets: BudgetOption[]; locations: LocationOption[]; activities: ActivityOption[];
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [serviceId, setServiceId] = useState("");
  const [activityId, setActivityId] = useState("");
  const service = services.find((item) => item.id === serviceId) ?? null;
  const activity = activities.find((item) => item.id === activityId) ?? null;

  function chooseActivity(value: string) {
    setActivityId(value);
    const selected = activities.find((item) => item.id === value);
    if (selected?.service_id) setServiceId(selected.service_id);
  }

  return <>
    <button className="elos-button service-flow-main-button" type="button" onClick={() => dialog.current?.showModal()}>+ Nova solicitação de serviço</button>
    <dialog ref={dialog} className="service-flow-dialog">
      <form action={saveServiceRequest}>
        <div className="service-flow-dialog-head"><div><span>Etapa 1</span><h2>Solicitação de serviços</h2><p>Defina a necessidade técnica antes de consultar fornecedores.</p></div><button type="button" onClick={() => dialog.current?.close()}>×</button></div>
        <div className="service-flow-dialog-body service-flow-form-grid">
          <label className="span2">Atividade do cronograma<select name="schedule_activity_id" value={activityId} onChange={(event) => chooseActivity(event.target.value)}><option value="">Sem vínculo específico</option>{activities.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name} · {item.planned_start} a {item.planned_finish}</option>)}</select></label>
          <label className="span2">Serviço a contratar<select name="service_id" value={serviceId} onChange={(event) => setServiceId(event.target.value)} required><option value="">Selecione</option>{services.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.description} · {item.unit}</option>)}</select></label>
          <label>Orçamento aprovado<select name="budget_id" defaultValue=""><option value="">Sem vínculo específico</option>{budgets.map((item) => <option key={item.id} value={item.id}>{item.code ? `${item.code} · ` : ""}{item.name}</option>)}</select></label>
          <label>Local / pavimento<select name="location_id" defaultValue={activity?.location_id ?? ""}><option value="">Toda a obra / não definido</option>{locations.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></label>
          <label className="span2">Título da contratação<input name="title" placeholder="Ex.: Reboco interno da torre" required /></label>
          <label className="span2">Escopo técnico<textarea name="scope_summary" rows={4} placeholder="Inclua limites, materiais, equipamentos, responsabilidades e critérios de aceitação." required /></label>
          <label>Quantidade<input name="requested_quantity" type="number" min="0.000001" step="0.000001" defaultValue="1" required /></label>
          <label>Unidade<input value={service?.unit ?? "—"} readOnly /></label>
          <label>Preço unitário estimado<input name="estimated_unit_price" type="number" min="0" step="0.01" defaultValue="0" /></label>
          <label>Início desejado<input name="desired_start" type="date" defaultValue={activity?.planned_start ?? today()} required /></label>
          <label>Fim desejado<input name="desired_finish" type="date" defaultValue={activity?.planned_finish ?? addMonths(today(), 3)} required /></label>
          <label className="span2">Observações<textarea name="notes" rows={3} placeholder="Documentos necessários, mobilização, condições especiais e observações." /></label>
        </div>
        <div className="service-flow-dialog-foot"><button type="button" onClick={() => dialog.current?.close()}>Cancelar</button><button className="primary" type="submit">Criar solicitação</button></div>
      </form>
    </dialog>
  </>;
}

export function OpenCompetitionButton({ requestId }: { requestId: string }) {
  return <form action={openServiceCompetition}><input type="hidden" name="request_id" value={requestId} /><button className="service-flow-primary" type="submit">Abrir mapa de concorrência</button></form>;
}

export function ProposalForm({ requestId, suppliers, proposals }: { requestId: string; suppliers: SupplierOption[]; proposals: ProposalRecord[] }) {
  const [supplierId, setSupplierId] = useState("");
  const existing = proposals.find((item) => item.supplier_id === supplierId) ?? null;
  return <form action={saveServiceProposal} className="service-flow-card service-proposal-form" key={existing?.id ?? "new"}>
    <input type="hidden" name="request_id" value={requestId} />
    <div className="service-flow-card-head"><div><span>Etapa 2</span><h3>Adicionar proposta ao mapa</h3></div><small>Selecione novamente um fornecedor para atualizar a proposta.</small></div>
    <div className="service-flow-form-grid">
      <label className="span2">Fornecedor<select name="supplier_id" value={supplierId} onChange={(event) => setSupplierId(event.target.value)} required><option value="">Selecione</option>{suppliers.map((item) => <option key={item.id} value={item.id}>{supplierLabel(item)}</option>)}</select></label>
      <label>Número da proposta<input name="proposal_number" defaultValue={existing?.proposal_number ?? ""} /></label>
      <label>Data da proposta<input name="proposal_date" type="date" defaultValue={existing?.proposal_date ?? today()} /></label>
      <label>Validade<input name="validity_date" type="date" defaultValue={existing?.validity_date ?? addMonths(today(), 1)} /></label>
      <label>Valor total<input name="total_price" type="number" min="0.01" step="0.01" defaultValue={existing?.total_price ?? ""} required /></label>
      <label>Prazo de execução (dias)<input name="duration_days" type="number" min="0" defaultValue={existing?.duration_days ?? ""} /></label>
      <label>Garantia (meses)<input name="warranty_months" type="number" min="0" max="240" defaultValue={existing?.warranty_months ?? 60} /></label>
      <label>Nota técnica (0–100)<input name="technical_score" type="number" min="0" max="100" step="0.01" defaultValue={existing?.technical_score ?? 100} /></label>
      <label>Nota comercial (0–100)<input name="commercial_score" type="number" min="0" max="100" step="0.01" defaultValue={existing?.commercial_score ?? 100} /></label>
      <label className="span2">Condição de pagamento<input name="payment_terms" defaultValue={existing?.payment_terms ?? ""} placeholder="Ex.: medição mensal, pagamento em 15 dias" /></label>
      <label className="span2">Observações da proposta<textarea name="notes" rows={3} defaultValue={existing?.notes ?? ""} /></label>
      <label className="service-flow-check span2"><input name="is_qualified" type="checkbox" defaultChecked={existing?.is_qualified ?? true} /> Proposta tecnicamente habilitada</label>
    </div>
    <button className="service-flow-primary" type="submit" disabled={!supplierId}>Salvar proposta</button>
  </form>;
}

export function CompetitionApprovalForm({ requestId, proposals }: { requestId: string; proposals: ProposalRecord[] }) {
  const qualified = proposals.filter((item) => item.is_qualified);
  return <form action={approveServiceCompetition} className="service-flow-card service-approval-form">
    <input type="hidden" name="request_id" value={requestId} />
    <div className="service-flow-card-head"><div><span>Etapa 3</span><h3>Aprovação do mapa e fornecedor</h3></div><small>{qualified.length} proposta(s) habilitada(s)</small></div>
    <label>Fornecedor vencedor<select name="proposal_id" required><option value="">Selecione a proposta aprovada</option>{qualified.map((item) => <option key={item.id} value={item.id}>{item.supplier_name} · {money(item.total_price)} · técnica {item.technical_score} · comercial {item.commercial_score}</option>)}</select></label>
    <label>Justificativa da escolha<textarea name="justification" rows={4} placeholder={proposals.length < 2 ? "Obrigatória quando houver apenas uma proposta." : "Preço, técnica, prazo, histórico e demais critérios considerados."} /></label>
    <button className="service-flow-primary" type="submit" disabled={!qualified.length}>Aprovar mapa e definir fornecedor</button>
  </form>;
}

export function ContractStageForm({ request }: { request: ServiceRequestRecord }) {
  const initial = useMemo<Stage[]>(() => request.service_name.toLocaleLowerCase("pt-BR").includes("reboco")
    ? [{ name: "Chapisco", weight_percent: 15 }, { name: "Reboco", weight_percent: 70 }, { name: "Requadros", weight_percent: 15 }]
    : [{ name: "Preparação", weight_percent: 20 }, { name: "Execução", weight_percent: 65 }, { name: "Acabamentos e entrega", weight_percent: 15 }], [request.service_name]);
  const [stages, setStages] = useState(initial);
  const totalWeight = stages.reduce((sum, item) => sum + Number(item.weight_percent || 0), 0);
  const approvedTotal = Number(request.approved_total ?? 0);

  function update(index: number, patch: Partial<Stage>) { setStages((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item)); }

  return <form action={createContractFromServiceRequest} className="service-flow-card service-stage-form">
    <input type="hidden" name="request_id" value={request.id} />
    <input type="hidden" name="stages_json" value={JSON.stringify(stages)} />
    <div className="service-flow-card-head"><div><span>Etapa 4</span><h3>Formulação das etapas de medição</h3></div><strong className={Math.abs(totalWeight - 100) <= 0.01 ? "ok" : "error"}>{totalWeight.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%</strong></div>
    <p className="service-stage-help">O contrato continuará sendo de <strong>{request.service_name}</strong>, mas cada medição será lançada separadamente nas etapas abaixo. O valor aprovado de {money(approvedTotal)} será distribuído pelos pesos.</p>
    <div className="service-stage-list">{stages.map((stage, index) => <article key={index}>
      <span>{String(index + 1).padStart(2, "0")}</span>
      <label>Etapa<input value={stage.name} onChange={(event) => update(index, { name: event.target.value })} required /></label>
      <label>Peso (%)<input type="number" min="0.01" max="100" step="0.01" value={stage.weight_percent} onChange={(event) => update(index, { weight_percent: Number(event.target.value) })} required /></label>
      <div><small>Valor da etapa</small><strong>{money(approvedTotal * Number(stage.weight_percent || 0) / 100)}</strong></div>
      <button type="button" onClick={() => setStages((current) => current.length === 1 ? current : current.filter((_, itemIndex) => itemIndex !== index))}>Remover</button>
    </article>)}</div>
    <button className="service-stage-add" type="button" onClick={() => setStages((current) => [...current, { name: "", weight_percent: 0 }])}>+ Adicionar etapa</button>
    <div className="service-flow-form-grid contract-conditions">
      <label>Início da vigência<input name="start_date" type="date" defaultValue={request.desired_start} required /></label>
      <label>Fim da vigência<input name="end_date" type="date" defaultValue={request.desired_finish} required /></label>
      <label>Retenção contratual (%)<input name="retention_percent" type="number" min="0" max="100" step="0.01" defaultValue="5" /></label>
      <label>Garantia retida (%)<input name="guarantee_percent" type="number" min="0" max="100" step="0.01" defaultValue="0" /></label>
      <label>Prazo de pagamento (dias)<input name="payment_days" type="number" min="0" max="365" defaultValue="15" /></label>
      <label>Índice de reajuste<input name="adjustment_index" placeholder="Ex.: CUB-SC, INCC ou sem reajuste" /></label>
    </div>
    <button className="service-flow-primary" type="submit" disabled={Math.abs(totalWeight - 100) > 0.01 || stages.some((item) => !item.name.trim() || item.weight_percent <= 0)}>Criar contrato com estas etapas</button>
  </form>;
}
