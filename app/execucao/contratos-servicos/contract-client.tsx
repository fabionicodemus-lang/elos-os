"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { saveServiceContract } from "./actions";

export type SupplierOption = { id: string; legal_name: string; trade_name: string | null; tax_id: string | null };
export type BudgetOption = { id: string; code: string | null; name: string };
export type ServiceOption = { id: string; code: string; description: string; unit: string };
export type LocationOption = { id: string; code: string; name: string };
export type ActivityOption = { id: string; service_id: string | null; location_id: string | null; code: string; name: string; planned_start: string; planned_finish: string };
export type ContractItem = {
  id?: string; service_id: string; location_id: string | null; schedule_activity_id: string | null;
  service_code: string; service_name: string; location_name: string | null; unit_snapshot: string;
  contracted_quantity: number; unit_price: number; total_value: number; measured_quantity: number; measured_value: number;
  planned_start: string | null; planned_finish: string | null; scope_notes: string | null;
};
export type ContractRecord = {
  id: string; supplier_id: string; budget_id: string | null; title: string; scope_summary: string;
  start_date: string; end_date: string; signed_date: string | null; retention_percent: number; guarantee_percent: number;
  guarantee_months: number; payment_days: number; adjustment_index: string | null; adjustment_base_date: string | null;
  contact_name: string | null; contact_phone: string | null; contact_email: string | null; notes: string | null;
  status: string;
};

type ServiceContractDialogProps = {
  suppliers: SupplierOption[]; budgets: BudgetOption[]; services: ServiceOption[]; locations: LocationOption[]; activities: ActivityOption[];
  contract?: ContractRecord | null; items?: ContractItem[]; autoOpen?: boolean; label?: string;
};

function emptyItem(): ContractItem {
  return { service_id: "", location_id: null, schedule_activity_id: null, service_code: "", service_name: "", location_name: null, unit_snapshot: "", contracted_quantity: 1, unit_price: 0, total_value: 0, measured_quantity: 0, measured_value: 0, planned_start: null, planned_finish: null, scope_notes: null };
}
function money(value: number) { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value || 0)); }
function today() { return new Date().toISOString().slice(0, 10); }
function addMonths(value: string, months: number) { const date = new Date(`${value}T12:00:00Z`); date.setUTCMonth(date.getUTCMonth() + months); return date.toISOString().slice(0, 10); }

export function ServiceContractDialog(props: ServiceContractDialogProps) {
  if (!props.contract) return <Link className="elos-button contract-main-button" href="/execucao/contratos-servicos/novo">{props.label ?? "+ Nova contratação"}</Link>;
  return <ServiceContractEditor {...props} contract={props.contract} />;
}

function ServiceContractEditor({ suppliers, budgets, services, locations, activities, contract, items = [], autoOpen = false, label }: Omit<ServiceContractDialogProps, "contract"> & { contract: ContractRecord }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [rows, setRows] = useState<ContractItem[]>(items.length ? items : [emptyItem()]);
  const [startDate, setStartDate] = useState(contract.start_date ?? today());
  const serviceMap = useMemo(() => new Map(services.map((item) => [item.id, item])), [services]);
  const locationMap = useMemo(() => new Map(locations.map((item) => [item.id, item])), [locations]);
  const activityMap = useMemo(() => new Map(activities.map((item) => [item.id, item])), [activities]);
  const total = rows.reduce((sum, row) => sum + Number(row.contracted_quantity || 0) * Number(row.unit_price || 0), 0);
  useEffect(() => { if (autoOpen) ref.current?.showModal(); }, [autoOpen]);

  function update(index: number, patch: Partial<ContractItem>) {
    setRows((current) => current.map((row, itemIndex) => itemIndex === index ? { ...row, ...patch, total_value: Number((Number(patch.contracted_quantity ?? row.contracted_quantity) * Number(patch.unit_price ?? row.unit_price)).toFixed(2)) } : row));
  }
  function chooseService(index: number, serviceId: string) {
    const service = serviceMap.get(serviceId);
    update(index, service ? { service_id: service.id, service_code: service.code, service_name: service.description, unit_snapshot: service.unit } : emptyItem());
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
      planned_start: activity.planned_start,
      planned_finish: activity.planned_finish,
    });
  }

  return <>
    <button className="elos-button contract-main-button" type="button" onClick={() => ref.current?.showModal()}>{label ?? "Editar contrato"}</button>
    <dialog ref={ref} className="contract-dialog">
      <form action={saveServiceContract}>
        <input type="hidden" name="contract_id" value={contract.id} />
        <input type="hidden" name="items_json" value={JSON.stringify(rows.filter((row) => row.service_id).map((row) => ({
          service_id: row.service_id, location_id: row.location_id, schedule_activity_id: row.schedule_activity_id,
          quantity: row.contracted_quantity, unit_price: row.unit_price, planned_start: row.planned_start, planned_finish: row.planned_finish, notes: row.scope_notes,
        })))} />
        <div className="contract-dialog-head"><div><span>Execução · Contratos</span><h2>Editar contrato em elaboração</h2><p>Fornecedor ativo, escopo técnico e apropriação por serviço da obra.</p></div><button type="button" onClick={() => ref.current?.close()}>×</button></div>
        <div className="contract-dialog-body">
          <section className="contract-form-grid">
            <label className="span2">Fornecedor / prestador<select name="supplier_id" defaultValue={contract.supplier_id} required><option value="">Selecione</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.trade_name || supplier.legal_name}{supplier.tax_id ? ` · ${supplier.tax_id}` : ""}</option>)}</select></label>
            <label>Orçamento aprovado<select name="budget_id" defaultValue={contract.budget_id ?? ""}><option value="">Sem vínculo específico</option>{budgets.map((budget) => <option key={budget.id} value={budget.id}>{budget.code ? `${budget.code} · ` : ""}{budget.name}</option>)}</select></label>
            <label>Data da assinatura<input name="signed_date" type="date" defaultValue={contract.signed_date ?? ""} /></label>
            <label className="span2">Título do contrato<input name="title" defaultValue={contract.title} placeholder="Ex.: Execução de alvenaria e reboco interno" required /></label>
            <label className="span2">Resumo do escopo<textarea name="scope_summary" rows={3} defaultValue={contract.scope_summary} placeholder="Descreva o objeto, limites, fornecimentos incluídos e responsabilidades principais." required /></label>
            <label>Início da vigência<input name="start_date" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} required /></label>
            <label>Fim da vigência<input name="end_date" type="date" defaultValue={contract.end_date ?? addMonths(startDate, 6)} required /></label>
            <label>Retenção contratual (%)<input name="retention_percent" type="number" min="0" max="100" step="0.01" defaultValue={contract.retention_percent ?? 5} /></label>
            <label>Garantia retida (%)<input name="guarantee_percent" type="number" min="0" max="100" step="0.01" defaultValue={contract.guarantee_percent ?? 0} /></label>
            <label>Garantia do serviço (meses)<input name="guarantee_months" type="number" min="0" max="240" defaultValue={contract.guarantee_months ?? 60} /></label>
            <label>Prazo de pagamento (dias)<input name="payment_days" type="number" min="0" max="365" defaultValue={contract.payment_days ?? 15} /></label>
            <label>Índice de reajuste<input name="adjustment_index" defaultValue={contract.adjustment_index ?? ""} placeholder="Ex.: CUB-SC, INCC ou sem reajuste" /></label>
            <label>Data-base do reajuste<input name="adjustment_base_date" type="date" defaultValue={contract.adjustment_base_date ?? ""} /></label>
          </section>

          <section className="contract-scope-section">
            <div className="contract-section-title"><div><span>Escopo contratado</span><h3>Serviços, locais, quantidades e valores</h3></div><strong>{money(total)}</strong></div>
            <div className="contract-items">
              {rows.map((row, index) => <article className="contract-item" key={index}>
                <div className="contract-item-number">{String(index + 1).padStart(2, "0")}</div>
                <div className="contract-item-fields">
                  <label className="wide">Atividade do cronograma<select value={row.schedule_activity_id ?? ""} onChange={(event) => chooseActivity(index, event.target.value)}><option value="">Vincular manualmente</option>{activities.map((activity) => <option key={activity.id} value={activity.id}>{activity.code} · {activity.name} · {activity.planned_start.slice(8,10)}/{activity.planned_start.slice(5,7)} a {activity.planned_finish.slice(8,10)}/{activity.planned_finish.slice(5,7)}</option>)}</select></label>
                  <label className="wide">Serviço / centro de custo<select value={row.service_id} onChange={(event) => chooseService(index, event.target.value)} required><option value="">Selecione o serviço</option>{services.map((service) => <option key={service.id} value={service.id}>{service.code} · {service.description} · {service.unit}</option>)}</select></label>
                  <label>Local<select value={row.location_id ?? ""} onChange={(event) => { const location = locationMap.get(event.target.value); update(index, { location_id: event.target.value || null, location_name: location ? `${location.code} · ${location.name}` : null }); }}><option value="">Todos / não definido</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.code} · {location.name}</option>)}</select></label>
                  <label>Quantidade<input type="number" min="0.000001" step="0.000001" value={row.contracted_quantity} onChange={(event) => update(index, { contracted_quantity: Number(event.target.value) })} /></label>
                  <label>Unidade<input value={row.unit_snapshot} readOnly /></label>
                  <label>Preço unitário<input type="number" min="0" step="0.000001" value={row.unit_price} onChange={(event) => update(index, { unit_price: Number(event.target.value) })} /></label>
                  <label>Total<input value={money(row.contracted_quantity * row.unit_price)} readOnly /></label>
                  <label>Início previsto<input type="date" value={row.planned_start ?? ""} onChange={(event) => update(index, { planned_start: event.target.value || null })} /></label>
                  <label>Fim previsto<input type="date" value={row.planned_finish ?? ""} onChange={(event) => update(index, { planned_finish: event.target.value || null })} /></label>
                  <label className="wide">Detalhe do escopo<input value={row.scope_notes ?? ""} onChange={(event) => update(index, { scope_notes: event.target.value })} placeholder="Exclusões, critérios de medição e observações deste item" /></label>
                </div>
                <button className="contract-remove-item" type="button" onClick={() => setRows((current) => current.length === 1 ? [emptyItem()] : current.filter((_, itemIndex) => itemIndex !== index))}>Remover</button>
              </article>)}
            </div>
            <button className="contract-add-item" type="button" onClick={() => setRows((current) => [...current, emptyItem()])}>+ Adicionar serviço ao contrato</button>
          </section>

          <section className="contract-form-grid">
            <label>Contato do fornecedor<input name="contact_name" defaultValue={contract.contact_name ?? ""} /></label>
            <label>Telefone<input name="contact_phone" defaultValue={contract.contact_phone ?? ""} /></label>
            <label>E-mail<input name="contact_email" type="email" defaultValue={contract.contact_email ?? ""} /></label>
            <label className="span2">Observações contratuais<textarea name="notes" rows={3} defaultValue={contract.notes ?? ""} placeholder="Seguros, documentos, condições especiais, retenções tributárias e demais observações." /></label>
          </section>
        </div>
        <div className="contract-dialog-foot"><div><small>Valor original calculado pelos itens</small><strong>{money(total)}</strong></div><div><button type="button" onClick={() => ref.current?.close()}>Cancelar</button><button className="primary" type="submit">Salvar alterações</button></div></div>
      </form>
    </dialog>
  </>;
}
