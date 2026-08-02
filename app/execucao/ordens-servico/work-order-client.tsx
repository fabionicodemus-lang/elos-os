"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FinancialInstallmentEditor } from "@/components/financial-installment-editor";
import {
  buildFinancialInstallments,
  financialInstallmentSummary,
  localTodayIso,
  suggestedFirstDueDate,
  type FinancialInstallmentDraft,
} from "@/lib/financial-installments";
import { acceptWorkOrder, saveWorkOrder, updateWorkOrderProgress } from "./actions";

export type ContractItemOption = {
  id: string; contract_id: string; service_code: string; service_name: string; location_name: string | null;
  unit_snapshot: string; unit_price: number; contracted_quantity: number; available_quantity: number;
  planned_start: string | null; planned_finish: string | null;
};
export type ContractOption = {
  id: string; contract_number: string; title: string; supplier_name: string; start_date: string; end_date: string;
};
export type WorkOrderRecord = {
  id: string; contract_id: string; title: string; scope_summary: string; planned_start: string; planned_finish: string;
  supplier_contact_name: string | null; supplier_contact_phone: string | null; site_instructions: string | null;
  safety_instructions: string | null; quality_requirements: string | null; notes: string | null; status: string;
};
export type WorkOrderItemRecord = {
  id: string; contract_item_id: string; service_code: string; service_name: string; location_name: string | null;
  unit_snapshot: string; unit_price: number; authorized_quantity: number; authorized_value: number;
  executed_quantity: number; executed_value: number; accepted_quantity: number; measured_quantity: number;
  planned_start: string | null; planned_finish: string | null; scope_notes: string | null;
};
export type PrerequisiteRecord = { id?: string; code: string | null; title: string; is_required: boolean; is_completed: boolean; notes: string | null };

type DraftItem = { contract_item_id: string; authorized_quantity: number; planned_start: string | null; planned_finish: string | null; notes: string | null };
type DraftPrerequisite = { code: string; title: string; is_required: boolean; is_completed: boolean; notes: string };
type FinancialMode = "none" | "forecast_only" | "payable_on_acceptance";

const defaultPrerequisites: DraftPrerequisite[] = [
  { code: "CONTRACT", title: "Contrato assinado e ativo", is_required: true, is_completed: true, notes: "" },
  { code: "SITE", title: "Frente de serviço liberada", is_required: true, is_completed: false, notes: "" },
  { code: "PROJECTS", title: "Projetos e detalhes executivos liberados", is_required: true, is_completed: false, notes: "" },
  { code: "SAFETY", title: "Documentação e orientações de segurança conferidas", is_required: true, is_completed: false, notes: "" },
];
function today() { return localTodayIso(); }
function money(value: number) { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value || 0)); }
function emptyItem(): DraftItem { return { contract_item_id: "", authorized_quantity: 0, planned_start: null, planned_finish: null, notes: null }; }

export function WorkOrderDialog({ contracts, contractItems, workOrder, items = [], prerequisites = [], autoOpen = false, label }: {
  contracts: ContractOption[]; contractItems: ContractItemOption[]; workOrder?: WorkOrderRecord | null;
  items?: WorkOrderItemRecord[]; prerequisites?: PrerequisiteRecord[]; autoOpen?: boolean; label?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const initialContract = workOrder?.contract_id ?? contracts[0]?.id ?? "";
  const [contractId, setContractId] = useState(initialContract);
  const [rows, setRows] = useState<DraftItem[]>(items.length ? items.map((item) => ({ contract_item_id: item.contract_item_id, authorized_quantity: Number(item.authorized_quantity), planned_start: item.planned_start, planned_finish: item.planned_finish, notes: item.scope_notes })) : [emptyItem()]);
  const [checks, setChecks] = useState<DraftPrerequisite[]>(prerequisites.length ? prerequisites.map((item) => ({ code: item.code ?? "", title: item.title, is_required: item.is_required, is_completed: item.is_completed, notes: item.notes ?? "" })) : defaultPrerequisites);
  const [financialMode, setFinancialMode] = useState<FinancialMode>("none");
  const [installments, setInstallments] = useState<FinancialInstallmentDraft[]>(() => buildFinancialInstallments({ total: 0, count: 1, firstDueDate: suggestedFirstDueDate(), paymentMethod: "Boleto" }));
  const itemMap = useMemo(() => new Map(contractItems.map((item) => [item.id, item])), [contractItems]);
  const selectedContract = contracts.find((contract) => contract.id === contractId) ?? null;
  const availableItems = contractItems.filter((item) => item.contract_id === contractId);
  const total = rows.reduce((sum, row) => sum + Number(row.authorized_quantity || 0) * Number(itemMap.get(row.contract_item_id)?.unit_price || 0), 0);
  const installmentSummary = financialInstallmentSummary(total, installments);
  useEffect(() => { if (autoOpen) ref.current?.showModal(); }, [autoOpen]);

  function changeContract(value: string) { setContractId(value); setRows([emptyItem()]); setFinancialMode("none"); }
  function updateRow(index: number, patch: Partial<DraftItem>) { setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row)); }
  function chooseItem(index: number, itemId: string) {
    const option = itemMap.get(itemId);
    updateRow(index, { contract_item_id: itemId, authorized_quantity: 0, planned_start: option?.planned_start ?? workOrder?.planned_start ?? null, planned_finish: option?.planned_finish ?? workOrder?.planned_finish ?? null, notes: null });
  }
  function changeFinancialMode(mode: FinancialMode) {
    setFinancialMode(mode);
    if (mode !== "none") {
      setInstallments(buildFinancialInstallments({ total, count: Math.max(1, installments.length), firstDueDate: installments[0]?.due_date || suggestedFirstDueDate(), paymentMethod: installments[0]?.payment_method || "Boleto" }));
    }
  }

  const financeValid = workOrder || financialMode === "none" || installmentSummary.valid;

  return <>
    <button className="elos-button work-order-main-button" type="button" onClick={() => ref.current?.showModal()}>{label ?? (workOrder ? "Editar O.S." : "+ Nova O.S.")}</button>
    <dialog ref={ref} className="work-order-dialog">
      <form action={saveWorkOrder}>
        <input type="hidden" name="work_order_id" value={workOrder?.id ?? ""} />
        <input type="hidden" name="contract_id" value={contractId} />
        <input type="hidden" name="items_json" value={JSON.stringify(rows.filter((row) => row.contract_item_id && row.authorized_quantity > 0))} />
        <input type="hidden" name="prerequisites_json" value={JSON.stringify(checks.filter((item) => item.title.trim()))} />
        <input type="hidden" name="financial_mode" value={workOrder ? "preserve" : financialMode} />
        <div className="work-order-dialog-head"><div><span>Execução · Serviços</span><h2>{workOrder ? "Editar ordem em elaboração" : "Nova ordem de serviço"}</h2><p>Formalize a frente liberada, os serviços autorizados e os pré-requisitos.</p></div><button type="button" onClick={() => ref.current?.close()}>×</button></div>
        <div className="work-order-dialog-body">
          <section className="work-order-form-grid">
            <label className="span2">Contrato ativo<select value={contractId} onChange={(event) => changeContract(event.target.value)} disabled={Boolean(workOrder)} required><option value="">Selecione</option>{contracts.map((contract) => <option key={contract.id} value={contract.id}>{contract.contract_number} · {contract.supplier_name} · {contract.title}</option>)}</select></label>
            <label>Início previsto<input name="planned_start" type="date" min={selectedContract?.start_date} max={selectedContract?.end_date} defaultValue={workOrder?.planned_start ?? selectedContract?.start_date ?? today()} required /></label>
            <label>Fim previsto<input name="planned_finish" type="date" min={selectedContract?.start_date} max={selectedContract?.end_date} defaultValue={workOrder?.planned_finish ?? selectedContract?.end_date ?? today()} required /></label>
            <label className="span2">Título da O.S.<input name="title" defaultValue={workOrder?.title ?? ""} placeholder="Ex.: Executar alvenaria dos pavimentos 6 ao 10" required /></label>
            <label className="span2">Escopo e limite da autorização<textarea name="scope_summary" rows={3} defaultValue={workOrder?.scope_summary ?? ""} placeholder="Descreva exatamente o que está liberado e o que não faz parte desta ordem." required /></label>
            <label>Contato do prestador<input name="supplier_contact_name" defaultValue={workOrder?.supplier_contact_name ?? ""} /></label>
            <label>Telefone<input name="supplier_contact_phone" defaultValue={workOrder?.supplier_contact_phone ?? ""} /></label>
          </section>

          <section className="work-order-scope-section">
            <div className="work-order-section-title"><div><span>Escopo autorizado</span><h3>Itens do contrato</h3></div><strong>{money(total)}</strong></div>
            <div className="work-order-items">{rows.map((row, index) => { const option = itemMap.get(row.contract_item_id); const ownQuantity = items.find((item) => item.contract_item_id === row.contract_item_id)?.authorized_quantity ?? 0; const limit = Number(option?.available_quantity ?? 0) + Number(ownQuantity); return <article key={index} className="work-order-item"><div className="work-order-item-number">{index + 1}</div><div className="work-order-item-fields">
              <label className="wide">Serviço e local<select value={row.contract_item_id} onChange={(event) => chooseItem(index, event.target.value)} required><option value="">Selecione um item contratado</option>{availableItems.map((item) => <option key={item.id} value={item.id}>{item.service_code} · {item.service_name}{item.location_name ? ` · ${item.location_name}` : ""} · disponível {item.available_quantity} {item.unit_snapshot}</option>)}</select></label>
              <label>Quantidade autorizada<input type="number" min="0.000001" max={limit || undefined} step="0.000001" value={row.authorized_quantity} onChange={(event) => updateRow(index, { authorized_quantity: Number(event.target.value) })} /></label>
              <label>Unidade<input value={option?.unit_snapshot ?? ""} readOnly /></label>
              <label>Preço unitário<input value={option ? money(option.unit_price) : ""} readOnly /></label>
              <label>Valor autorizado<input value={option ? money(row.authorized_quantity * option.unit_price) : ""} readOnly /></label>
              <label>Início do item<input type="date" value={row.planned_start ?? ""} onChange={(event) => updateRow(index, { planned_start: event.target.value || null })} /></label>
              <label>Fim do item<input type="date" value={row.planned_finish ?? ""} onChange={(event) => updateRow(index, { planned_finish: event.target.value || null })} /></label>
              <label className="wide">Instruções do item<input value={row.notes ?? ""} onChange={(event) => updateRow(index, { notes: event.target.value })} placeholder="Detalhes, tolerâncias e critérios de medição" /></label>
            </div><button type="button" className="work-order-remove" onClick={() => setRows((current) => current.length === 1 ? [emptyItem()] : current.filter((_, rowIndex) => rowIndex !== index))}>Remover</button></article>; })}</div>
            <button type="button" className="work-order-add" onClick={() => setRows((current) => [...current, emptyItem()])}>+ Adicionar item contratado</button>
          </section>

          {!workOrder ? <section className="work-order-financial-mode">
            <div className="work-order-section-title"><div><span>Financeiro opcional</span><h3>Como tratar o valor da O.S.?</h3></div><strong>{money(total)}</strong></div>
            <label><input type="radio" checked={financialMode === "none"} onChange={() => changeFinancialMode("none")} /><span><strong>Não gerar financeiro</strong><small>Use o fluxo normal de medição e nota fiscal.</small></span></label>
            <label><input type="radio" checked={financialMode === "forecast_only"} onChange={() => changeFinancialMode("forecast_only")} /><span><strong>Somente previsão de parcelas</strong><small>Leva as datas para acompanhamento, sem criar Contas a Pagar.</small></span></label>
            <label><input type="radio" checked={financialMode === "payable_on_acceptance"} onChange={() => changeFinancialMode("payable_on_acceptance")} /><span><strong>Gerar Contas a Pagar no aceite técnico</strong><small>Use apenas quando esta O.S. substituir o faturamento por medição ou nota, evitando duplicidade.</small></span></label>
            {financialMode !== "none" ? <FinancialInstallmentEditor total={total} installments={installments} onChange={setInstallments} inputName="installments_json" eyebrow="Ordem de serviço" title={financialMode === "forecast_only" ? "Previsão de desembolso" : "Parcelas a gerar no aceite"} compact /> : <input type="hidden" name="installments_json" value="[]" />}
            {financialMode === "payable_on_acceptance" ? <p className="work-order-financial-note"><strong>Atenção:</strong> depois do aceite, as parcelas serão títulos financeiros independentes. Não lance novamente a mesma O.S. por medição ou nota fiscal.</p> : null}
          </section> : null}

          <section className="work-order-prerequisites"><div className="work-order-section-title"><div><span>Liberação da frente</span><h3>Pré-requisitos</h3></div><small>Obrigatórios precisam estar concluídos para liberar a O.S.</small></div>
            {checks.map((item, index) => <div className="work-order-prerequisite" key={index}><input type="checkbox" checked={item.is_completed} onChange={(event) => setChecks((current) => current.map((entry, itemIndex) => itemIndex === index ? { ...entry, is_completed: event.target.checked } : entry))} /><input value={item.title} onChange={(event) => setChecks((current) => current.map((entry, itemIndex) => itemIndex === index ? { ...entry, title: event.target.value } : entry))} /><label><input type="checkbox" checked={item.is_required} onChange={(event) => setChecks((current) => current.map((entry, itemIndex) => itemIndex === index ? { ...entry, is_required: event.target.checked } : entry))} /> Obrigatório</label><input value={item.notes} onChange={(event) => setChecks((current) => current.map((entry, itemIndex) => itemIndex === index ? { ...entry, notes: event.target.value } : entry))} placeholder="Observação" /><button type="button" onClick={() => setChecks((current) => current.filter((_, itemIndex) => itemIndex !== index))}>×</button></div>)}
            <button type="button" className="work-order-add" onClick={() => setChecks((current) => [...current, { code: "", title: "", is_required: true, is_completed: false, notes: "" }])}>+ Adicionar pré-requisito</button>
          </section>

          <section className="work-order-form-grid">
            <label className="span2">Instruções da frente<textarea name="site_instructions" rows={3} defaultValue={workOrder?.site_instructions ?? ""} placeholder="Acessos, armazenagem, horários, interferências e organização da frente." /></label>
            <label className="span2">Segurança<textarea name="safety_instructions" rows={3} defaultValue={workOrder?.safety_instructions ?? ""} placeholder="EPIs, liberações, APR, isolamento e riscos específicos." /></label>
            <label className="span2">Requisitos de qualidade<textarea name="quality_requirements" rows={3} defaultValue={workOrder?.quality_requirements ?? ""} placeholder="Critérios de inspeção, tolerâncias, ensaios e registros obrigatórios." /></label>
            <label className="span2">Observações<textarea name="notes" rows={3} defaultValue={workOrder?.notes ?? ""} /></label>
          </section>
        </div>
        <div className="work-order-dialog-foot"><div><small>Valor autorizado</small><strong>{money(total)}</strong></div><div><button type="button" onClick={() => ref.current?.close()}>Cancelar</button><button className="primary" type="submit" disabled={!financeValid || total <= 0}>{workOrder ? "Salvar alterações" : "Criar O.S."}</button></div></div>
      </form>
    </dialog>
  </>;
}

export function WorkOrderProgressForm({ workOrderId, items }: { workOrderId: string; items: WorkOrderItemRecord[] }) {
  const [rows, setRows] = useState(items.map((item) => ({ work_order_item_id: item.id, executed_quantity: Number(item.executed_quantity) })));
  const executed = rows.reduce((sum, row) => { const item = items.find((entry) => entry.id === row.work_order_item_id); return sum + Number(row.executed_quantity || 0) * Number(item?.unit_price || 0); }, 0);
  return <form action={updateWorkOrderProgress} className="work-order-progress-form"><input type="hidden" name="work_order_id" value={workOrderId} /><input type="hidden" name="items_json" value={JSON.stringify(rows)} /><div className="work-order-section-title"><div><span>Apontamento de campo</span><h3>Atualizar execução</h3></div><strong>{money(executed)}</strong></div>{items.map((item, index) => <label key={item.id}><span><strong>{item.service_code} · {item.service_name}</strong><small>{item.location_name || "Todos os locais"} · autorizado {item.authorized_quantity} {item.unit_snapshot}</small></span><input type="number" min="0" max={item.authorized_quantity} step="0.000001" value={rows[index]?.executed_quantity ?? 0} onChange={(event) => setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, executed_quantity: Number(event.target.value) } : row))} /></label>)}<textarea name="progress_notes" rows={2} placeholder="Observação do avanço, interferências ou justificativas" /><button type="submit">Salvar execução</button></form>;
}

export function WorkOrderAcceptanceForm({ workOrderId }: { workOrderId: string }) {
  const [punchList, setPunchList] = useState("");
  const parsed = punchList.split("\n").map((item) => item.trim()).filter(Boolean).map((description) => ({ description, status: "open" }));
  return <form action={acceptWorkOrder} className="work-order-acceptance-form"><input type="hidden" name="work_order_id" value={workOrderId} /><input type="hidden" name="punch_list_json" value={JSON.stringify(parsed)} /><div className="work-order-section-title"><div><span>Encerramento técnico</span><h3>Aceite da ordem</h3></div></div><div className="work-order-acceptance-grid"><label>Resultado<select name="result" required><option value="approved">Aprovada</option><option value="approved_with_remarks">Aprovada com ressalvas</option><option value="rejected">Devolver para correção</option></select></label><label>Situação da qualidade<select name="quality_status" required><option value="passed">Qualidade aprovada</option><option value="waived">Dispensada formalmente</option><option value="pending">Pendente</option></select></label><label>Referência da vistoria<input name="quality_reference" placeholder="Número ou link da vistoria" /></label></div><label>Ressalvas / pendências<textarea value={punchList} onChange={(event) => setPunchList(event.target.value)} rows={3} placeholder="Uma pendência por linha" /></label><label>Observações do aceite<textarea name="acceptance_notes" rows={3} placeholder="Obrigatório em devolução ou aprovação com ressalvas" /></label><button type="submit">Registrar aceite</button></form>;
}
