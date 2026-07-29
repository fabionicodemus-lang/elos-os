"use client";

import { useMemo, useRef, useState } from "react";
import { postInventoryMovement, saveInventoryCount, saveInventoryLocation } from "./actions";

export type InventoryLocation = {
  id: string; code: string; name: string; location_type: string; address: string | null;
  responsible_name: string | null; allow_negative: boolean; status: string;
};
export type InventoryBalance = {
  id: string; input_id: string; location_id: string; input_code: string; input_name: string; unit_snapshot: string;
  category_snapshot: string | null; batch_number: string; expiration_date: string; quantity_on_hand: number;
  reserved_quantity: number; available_quantity: number; average_unit_cost: number; total_value: number;
  minimum_quantity: number; maximum_quantity: number | null;
};
export type InventoryInput = { id: string; code: string; description: string; unit: string; category: string };
export type InventoryService = { id: string; code: string; description: string };

function today() { return new Date().toISOString().slice(0, 10); }
function quantity(value: number) { return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 4 }).format(Number(value || 0)); }
function money(value: number) { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value || 0)); }
function actualExpiry(value: string) { return value?.slice(0, 10) === "9999-12-31" ? "" : value?.slice(0, 10) || ""; }

export function InventoryLocationDialog({ nextCode }: { nextCode: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  return <>
    <button className="inventory-secondary-button" type="button" onClick={() => dialog.current?.showModal()}>+ Local de estoque</button>
    <dialog className="inventory-dialog compact" ref={dialog}>
      <form action={saveInventoryLocation}>
        <div className="inventory-dialog-head"><div><span>Configuração</span><h2>Novo local de estoque</h2><p>Almoxarifado, pavimento, container ou área externa.</p></div><button type="button" onClick={() => dialog.current?.close()}>×</button></div>
        <div className="inventory-dialog-body inventory-form-grid">
          <label>Código<input name="code" defaultValue={nextCode} required /></label>
          <label className="span2">Nome<input name="name" placeholder="Ex.: Almoxarifado principal" required /></label>
          <label>Tipo<select name="location_type"><option value="warehouse">Almoxarifado</option><option value="site">Canteiro</option><option value="floor">Pavimento</option><option value="container">Container</option><option value="external">Área externa</option><option value="other">Outro</option></select></label>
          <label className="span2">Endereço / referência<input name="address" placeholder="Bloco, garagem, pavimento ou acesso" /></label>
          <label className="span2">Responsável<input name="responsible_name" /></label>
          <label className="span4">Observações<textarea name="notes" rows={3} /></label>
        </div>
        <div className="inventory-dialog-foot"><button type="button" onClick={() => dialog.current?.close()}>Cancelar</button><button className="primary" type="submit">Criar local</button></div>
      </form>
    </dialog>
  </>;
}

export function InventoryMovementDialog({ balances, locations, inputs, services, canIssue, canTransfer, canAdjust }: {
  balances: InventoryBalance[]; locations: InventoryLocation[]; inputs: InventoryInput[]; services: InventoryService[];
  canIssue: boolean; canTransfer: boolean; canAdjust: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const options = [
    ...(canIssue ? [{ value: "issue", label: "Saída para consumo" }, { value: "return_to_supplier", label: "Devolução ao fornecedor" }] : []),
    ...(canTransfer ? [{ value: "transfer", label: "Transferência entre locais" }] : []),
    ...(canAdjust ? [{ value: "adjustment_in", label: "Ajuste de entrada" }, { value: "adjustment_out", label: "Ajuste de saída" }, { value: "return_to_stock", label: "Devolução ao estoque" }] : []),
  ];
  const [type, setType] = useState(options[0]?.value ?? "issue");
  const [balanceId, setBalanceId] = useState(balances.find((balance) => balance.available_quantity > 0)?.id ?? "");
  const selectedBalance = balances.find((balance) => balance.id === balanceId) ?? null;
  const outbound = ["issue", "transfer", "adjustment_out", "return_to_supplier"].includes(type);
  const inbound = ["adjustment_in", "return_to_stock"].includes(type);
  const activeLocations = locations.filter((location) => location.status === "active");

  return <>
    <button className="inventory-primary-button" type="button" disabled={!options.length} onClick={() => dialog.current?.showModal()}>+ Nova movimentação</button>
    <dialog className="inventory-dialog" ref={dialog}>
      <form action={postInventoryMovement}>
        <div className="inventory-dialog-head"><div><span>Estoque</span><h2>Registrar movimentação</h2><p>Todo lançamento atualiza o saldo e cria histórico permanente.</p></div><button type="button" onClick={() => dialog.current?.close()}>×</button></div>
        <div className="inventory-dialog-body inventory-form-grid">
          <label className="span2">Tipo de movimentação<select name="movement_type" value={type} onChange={(event) => setType(event.target.value)}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <label>Data<input name="movement_date" type="date" defaultValue={today()} required /></label>
          <label>Referência<input name="source_reference" placeholder="OS, requisição ou documento" /></label>

          {outbound ? <>
            <label className="span4">Material e saldo de origem<select value={balanceId} onChange={(event) => setBalanceId(event.target.value)} required><option value="">Selecione</option>{balances.filter((balance) => balance.available_quantity > 0).map((balance) => <option key={balance.id} value={balance.id}>{balance.input_code} · {balance.input_name} · {quantity(balance.available_quantity)} {balance.unit_snapshot} · {locations.find((location) => location.id === balance.location_id)?.name ?? "Local"}{balance.batch_number ? ` · lote ${balance.batch_number}` : ""}</option>)}</select></label>
            <input type="hidden" name="input_id" value={selectedBalance?.input_id ?? ""} />
            <input type="hidden" name="from_location_id" value={selectedBalance?.location_id ?? ""} />
            <input type="hidden" name="batch_number" value={selectedBalance?.batch_number ?? ""} />
            <input type="hidden" name="expiration_date" value={selectedBalance ? actualExpiry(selectedBalance.expiration_date) : ""} />
            <input type="hidden" name="unit_cost" value={selectedBalance?.average_unit_cost ?? 0} />
            <label>Quantidade<input name="quantity" type="number" min="0.000001" max={selectedBalance?.available_quantity ?? undefined} step="0.000001" required /></label>
            <label>Custo médio<input value={selectedBalance ? money(selectedBalance.average_unit_cost) : "—"} readOnly /></label>
            {type === "transfer" ? <label className="span2">Local de destino<select name="to_location_id" required><option value="">Selecione</option>{activeLocations.filter((location) => location.id !== selectedBalance?.location_id).map((location) => <option key={location.id} value={location.id}>{location.code} · {location.name}</option>)}</select></label> : null}
          </> : null}

          {inbound ? <>
            <label className="span3">Material<select name="input_id" required><option value="">Selecione</option>{inputs.map((input) => <option key={input.id} value={input.id}>{input.code} · {input.description} · {input.unit}</option>)}</select></label>
            <label>Quantidade<input name="quantity" type="number" min="0.000001" step="0.000001" required /></label>
            <label className="span2">Local de entrada<select name="to_location_id" required><option value="">Selecione</option>{activeLocations.map((location) => <option key={location.id} value={location.id}>{location.code} · {location.name}</option>)}</select></label>
            <label>Custo unitário<input name="unit_cost" type="number" min="0" step="0.000001" defaultValue="0" /></label>
            <label>Lote<input name="batch_number" /></label>
            <label>Validade<input name="expiration_date" type="date" /></label>
          </> : null}

          {type === "issue" ? <label className="span2">Serviço / centro de custo<select name="cost_center_service_id" required><option value="">Selecione</option>{services.map((service) => <option key={service.id} value={service.id}>{service.code} · {service.description}</option>)}</select></label> : <input type="hidden" name="cost_center_service_id" value="" />}
          <label className="span2">Responsável / destinatário<input name="recipient_name" placeholder="Quem recebeu ou autorizou" /></label>
          <label className="span4">Motivo e observações<textarea name="notes" rows={3} required={type.startsWith("adjustment") || type === "return_to_supplier"} placeholder="Descreva o uso, transferência, devolução ou motivo do ajuste." /></label>
        </div>
        <div className="inventory-dialog-foot"><button type="button" onClick={() => dialog.current?.close()}>Cancelar</button><button className="primary" type="submit">Registrar movimentação</button></div>
      </form>
    </dialog>
  </>;
}

export function InventoryCountDialog({ balances, locations }: { balances: InventoryBalance[]; locations: InventoryLocation[] }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const firstLocation = locations.find((location) => location.status === "active" && balances.some((balance) => balance.location_id === location.id))?.id ?? "";
  const [locationId, setLocationId] = useState(firstLocation);
  const locationBalances = useMemo(() => balances.filter((balance) => balance.location_id === locationId), [balances, locationId]);
  const [values, setValues] = useState<Record<string, string>>({});
  const items = locationBalances.map((balance) => ({
    balance_id: balance.id,
    counted_quantity: Number(values[balance.id] ?? balance.quantity_on_hand),
    notes: "",
  }));
  function changeLocation(value: string) { setLocationId(value); setValues({}); }

  return <>
    <button className="inventory-secondary-button" type="button" disabled={!firstLocation} onClick={() => dialog.current?.showModal()}>Inventário físico</button>
    <dialog className="inventory-dialog count" ref={dialog}>
      <form action={saveInventoryCount}>
        <input type="hidden" name="items_json" value={JSON.stringify(items)} />
        <div className="inventory-dialog-head"><div><span>Conferência</span><h2>Novo inventário físico</h2><p>Compare o saldo do sistema com a contagem real do local.</p></div><button type="button" onClick={() => dialog.current?.close()}>×</button></div>
        <div className="inventory-dialog-body">
          <div className="inventory-form-grid count-head">
            <label className="span2">Local<select name="location_id" value={locationId} onChange={(event) => changeLocation(event.target.value)} required><option value="">Selecione</option>{locations.filter((location) => location.status === "active" && balances.some((balance) => balance.location_id === location.id)).map((location) => <option key={location.id} value={location.id}>{location.code} · {location.name}</option>)}</select></label>
            <label>Data<input name="count_date" type="date" defaultValue={today()} required /></label>
            <label className="span4">Observações<input name="notes" placeholder="Equipe, área isolada, critério ou observações da contagem" /></label>
          </div>
          <div className="inventory-count-table"><table><thead><tr><th>Material</th><th>Lote</th><th>Saldo do sistema</th><th>Contagem física</th><th>Diferença</th></tr></thead><tbody>{locationBalances.map((balance) => { const counted = Number(values[balance.id] ?? balance.quantity_on_hand); const difference = counted - Number(balance.quantity_on_hand); return <tr key={balance.id}><td><strong>{balance.input_code}</strong><span>{balance.input_name}</span></td><td>{balance.batch_number || "—"}</td><td>{quantity(balance.quantity_on_hand)} {balance.unit_snapshot}</td><td><input type="number" min="0" step="0.000001" value={values[balance.id] ?? String(balance.quantity_on_hand)} onChange={(event) => setValues((current) => ({ ...current, [balance.id]: event.target.value }))} /></td><td className={difference < 0 ? "negative" : difference > 0 ? "positive" : ""}>{difference > 0 ? "+" : ""}{quantity(difference)}</td></tr>; })}</tbody></table></div>
        </div>
        <div className="inventory-dialog-foot"><span>{locationBalances.length} item(ns) para conferir</span><div><button type="button" onClick={() => dialog.current?.close()}>Cancelar</button><button className="primary" type="submit">Salvar inventário</button></div></div>
      </form>
    </dialog>
  </>;
}
