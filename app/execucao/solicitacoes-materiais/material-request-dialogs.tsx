"use client";

import { useMemo, useRef, useState } from "react";
import { saveMaterialRequest } from "./actions";

export type MaterialInputOption = {
  id: string;
  code: string;
  description: string;
  unit: string;
  category: string;
};

export type MaterialCostCenterOption = {
  id: string;
  budget_id: string;
  code: string;
  name: string;
  unit: string | null;
  group_code: string | null;
};

export type SupplyPlanReference = {
  input_id: string;
  required_quantity: number;
  purchase_quantity: number;
  unit_snapshot: string;
  order_deadline: string;
  first_use_date: string;
};

export type MaterialRequestItemData = {
  id?: string;
  input_id: string;
  quantity: number;
  cost_center_service_id?: string | null;
  cost_center_code: string;
  notes?: string | null;
};

export type MaterialRequestDialogData = {
  id: string;
  request_number: string;
  budget_id: string;
  needed_date: string;
  notes: string | null;
  status: string;
  items: MaterialRequestItemData[];
};

type EditableItem = MaterialRequestItemData & { row_id: string };

type Props = {
  inputs: MaterialInputOption[];
  centers: MaterialCostCenterOption[];
  supplyPlan: SupplyPlanReference[];
  approvedBudgetId: string;
  request?: MaterialRequestDialogData;
};

const categoryLabels: Record<string, string> = {
  material: "Material",
  equipment: "Equipamento",
  freight: "Frete",
  other: "Outro custo",
};

function quantity(value: number) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 }).format(Number(value || 0));
}

function dateBR(value?: string | null) {
  if (!value) return "—";
  const [year, month, day] = value.slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}

function initialRows(request?: MaterialRequestDialogData): EditableItem[] {
  return (request?.items ?? []).map((item, index) => ({ ...item, row_id: item.id ?? `${item.input_id}-${index}` }));
}

function MaterialRequestDialog({ inputs, centers, supplyPlan, approvedBudgetId, request }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [rows, setRows] = useState<EditableItem[]>(() => initialRows(request));
  const [search, setSearch] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [openCenterRow, setOpenCenterRow] = useState<string | null>(null);
  const [centerSearch, setCenterSearch] = useState("");
  const budgetId = request?.budget_id || approvedBudgetId;
  const inputMap = useMemo(() => new Map(inputs.map((item) => [item.id, item])), [inputs]);
  const supplyMap = useMemo(() => new Map(supplyPlan.map((item) => [item.input_id, item])), [supplyPlan]);
  const availableCenters = useMemo(
    () => centers.filter((item) => item.budget_id === budgetId).sort((a, b) => a.code.localeCompare(b.code, "pt-BR", { numeric: true })),
    [centers, budgetId],
  );
  const centerMap = useMemo(() => new Map(availableCenters.map((item) => [item.id, item])), [availableCenters]);
  const filteredInputs = useMemo(() => {
    const normalized = search.trim().toLocaleLowerCase("pt-BR");
    return inputs
      .filter((item) => !rows.some((row) => row.input_id === item.id))
      .filter((item) => !normalized || [item.code, item.description, item.unit].join(" ").toLocaleLowerCase("pt-BR").includes(normalized))
      .slice(0, 150);
  }, [inputs, rows, search]);
  const filteredCenters = useMemo(() => {
    const normalized = centerSearch.trim().toLocaleLowerCase("pt-BR");
    return availableCenters.filter((item) => !normalized || [item.code, item.name, item.group_code ?? "", item.unit ?? ""].join(" ").toLocaleLowerCase("pt-BR").includes(normalized));
  }, [availableCenters, centerSearch]);

  const open = () => {
    setRows(initialRows(request));
    setSearch("");
    setPickerOpen(false);
    setOpenCenterRow(null);
    setCenterSearch("");
    dialogRef.current?.showModal();
  };

  const add = (inputId: string) => {
    const repeatedCenterId = rows[0]?.cost_center_service_id ?? availableCenters[0]?.id ?? null;
    const repeatedCenter = repeatedCenterId ? centerMap.get(repeatedCenterId) : availableCenters[0];
    setRows((current) => [...current, {
      row_id: `${inputId}-${Date.now()}`,
      input_id: inputId,
      quantity: 1,
      cost_center_service_id: repeatedCenter?.id ?? null,
      cost_center_code: repeatedCenter?.code ?? "",
      notes: "",
    }]);
    setPickerOpen(false);
    setSearch("");
  };

  const update = (rowId: string, patch: Partial<EditableItem>) => {
    setRows((current) => current.map((row) => row.row_id === rowId ? { ...row, ...patch } : row));
  };

  const selectCenter = (rowId: string, center: MaterialCostCenterOption) => {
    update(rowId, { cost_center_service_id: center.id, cost_center_code: center.code });
    setOpenCenterRow(null);
    setCenterSearch("");
  };

  const repeatFirstCenter = () => {
    const centerId = rows[0]?.cost_center_service_id;
    const centerCode = rows[0]?.cost_center_code;
    if (!centerId || !centerCode) return;
    setRows((current) => current.map((row) => ({ ...row, cost_center_service_id: centerId, cost_center_code: centerCode })));
  };

  const payload = rows.map(({ input_id, quantity: itemQuantity, cost_center_service_id, cost_center_code, notes }) => ({
    input_id,
    quantity: Number(itemQuantity),
    cost_center_service_id: cost_center_service_id ?? "",
    cost_center_code,
    notes: notes?.trim() || "",
  }));
  const valid = Boolean(budgetId && rows.length && rows.every((row) => row.input_id && row.quantity > 0 && row.cost_center_service_id && row.cost_center_code));

  return <>
    <button className={request ? "table-action" : "elos-button"} type="button" onClick={open}>
      {request ? "Editar" : "+ Nova solicitação"}
    </button>
    <dialog className="material-request-dialog" ref={dialogRef}>
      <form action={saveMaterialRequest}>
        <input type="hidden" name="request_id" value={request?.id ?? ""} />
        <input type="hidden" name="budget_id" value={budgetId} />
        <input type="hidden" name="items_json" value={JSON.stringify(payload)} />
        <header>
          <div><span>EXECUÇÃO · SUPRIMENTOS</span><h2>{request ? `Editar ${request.request_number}` : "Nova solicitação de materiais"}</h2><p>O solicitante será preenchido automaticamente pelo login. Cada item precisa de quantidade e serviço para apropriação do custo.</p></div>
          <button type="button" aria-label="Fechar" onClick={() => dialogRef.current?.close()}>×</button>
        </header>

        <div className="material-request-form-grid">
          <label>Número da solicitação<input value={request?.request_number ?? "Gerado automaticamente"} disabled /></label>
          <label>Data de necessidade<input name="needed_date" type="date" required defaultValue={request?.needed_date ?? new Date().toISOString().slice(0, 10)} /></label>
          <label className="wide">Observações<textarea name="notes" defaultValue={request?.notes ?? ""} rows={3} placeholder="Frente de serviço, condição de entrega, especificação adicional..." /></label>
        </div>

        <section className="material-request-items-section">
          <div className="material-request-section-head">
            <div><span>Materiais solicitados</span><strong>{rows.length} item(ns)</strong></div>
            <div><button type="button" className="secondary" onClick={repeatFirstCenter} disabled={!rows[0]?.cost_center_service_id}>Repetir 1º serviço</button><button type="button" onClick={() => setPickerOpen((value) => !value)}>+ Inserir material</button></div>
          </div>

          {pickerOpen ? <div className="material-picker material-picker-compact">
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar código, descrição ou unidade" autoFocus />
            <div className="material-picker-results">
              {filteredInputs.map((input) => {
                const planned = supplyMap.get(input.id);
                return <button key={input.id} type="button" onClick={() => add(input.id)} title={`${input.code} · ${input.description}`}>
                  <code>{input.code}</code><span><strong>{input.description}</strong><small>{categoryLabels[input.category] ?? input.category} · {input.unit}{planned ? ` · plano: ${quantity(planned.purchase_quantity)} ${planned.unit_snapshot}` : ""}</small></span><b>Inserir</b>
                </button>;
              })}
              {!filteredInputs.length ? <p>Nenhum material disponível para essa pesquisa.</p> : null}
            </div>
          </div> : null}

          {!availableCenters.length ? <div className="material-request-center-warning">Nenhum serviço foi encontrado no orçamento aprovado. Cadastre os serviços no levantamento do orçamento antes de criar a solicitação.</div> : null}

          <div className="material-request-items-table-wrap">
            <table className="material-request-items-table">
              <thead><tr><th>Material</th><th>Planejamento</th><th>Quantidade</th><th>Serviço / centro de custo</th><th>Observação</th><th></th></tr></thead>
              <tbody>
                {rows.map((row) => {
                  const input = inputMap.get(row.input_id);
                  const planned = supplyMap.get(row.input_id);
                  const selectedCenter = row.cost_center_service_id ? centerMap.get(row.cost_center_service_id) : undefined;
                  const centerCode = selectedCenter?.code ?? row.cost_center_code ?? "";
                  return <tr key={row.row_id}>
                    <td><strong>{input?.code ?? "—"}</strong><span>{input?.description ?? "Material não encontrado"}</span><small>{input?.unit ?? "un"}</small></td>
                    <td>{planned ? <><strong>{quantity(planned.purchase_quantity)} {planned.unit_snapshot}</strong><span>Pedido até {dateBR(planned.order_deadline)}</span><small>1º uso {dateBR(planned.first_use_date)}</small></> : <span>Fora do plano atual</span>}</td>
                    <td><input type="number" min="0.000001" step="0.000001" value={row.quantity} onChange={(event) => update(row.row_id, { quantity: Number(event.target.value) })} /></td>
                    <td className="material-center-cell">
                      <div className="material-center-picker">
                        <button className={`material-center-trigger ${selectedCenter ? "selected" : ""}`} type="button" onClick={() => { setOpenCenterRow((current) => current === row.row_id ? null : row.row_id); setCenterSearch(""); }}>
                          <strong>{centerCode || "Selecionar serviço"}</strong>
                          <span>{selectedCenter?.name ?? (row.cost_center_code ? "Centro anterior — selecione um serviço" : "Usar serviço como centro de custo")}</span>
                          <i>⌄</i>
                        </button>
                        {openCenterRow === row.row_id ? <div className="material-center-inline-panel">
                          <input value={centerSearch} onChange={(event) => setCenterSearch(event.target.value)} placeholder="Buscar código ou nome do serviço" autoFocus />
                          <div>
                            {filteredCenters.map((center) => <button key={`${center.budget_id}-${center.id}`} type="button" onClick={() => selectCenter(row.row_id, center)}>
                              <code>{center.code}</code><span><strong>{center.name}</strong><small>{[center.group_code, center.unit].filter(Boolean).join(" · ") || "Serviço do orçamento"}</small></span>
                            </button>)}
                            {!filteredCenters.length ? <p>Nenhum serviço encontrado.</p> : null}
                          </div>
                        </div> : null}
                      </div>
                    </td>
                    <td><input value={row.notes ?? ""} onChange={(event) => update(row.row_id, { notes: event.target.value })} placeholder="Opcional" /></td>
                    <td><button type="button" className="danger" aria-label="Remover item" onClick={() => setRows((current) => current.filter((item) => item.row_id !== row.row_id))}>×</button></td>
                  </tr>;
                })}
                {!rows.length ? <tr><td colSpan={6}><div className="material-request-empty"><strong>Nenhum material inserido.</strong><span>Use “Inserir material” para selecionar itens do catálogo corporativo.</span></div></td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>

        <div className="material-request-status-note"><strong>Status automático:</strong> a solicitação nasce como <b>Solicitada</b> e somente depois da aprovação fica disponível para o fluxo de compras.</div>
        <footer><button className="secondary" type="button" onClick={() => dialogRef.current?.close()}>Cancelar</button><button type="submit" disabled={!valid}>{request ? "Salvar alterações" : "Criar solicitação"}</button></footer>
      </form>
    </dialog>
  </>;
}

export function MaterialRequestCreateDialog(props: Omit<Props, "request">) {
  return <MaterialRequestDialog {...props} />;
}

export function MaterialRequestEditDialog(props: Props & { request: MaterialRequestDialogData }) {
  return <MaterialRequestDialog {...props} />;
}
