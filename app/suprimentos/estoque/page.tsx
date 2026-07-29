import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { fetchAllRows } from "@/lib/supabase-pagination";
import { requireCompanyPermission } from "@/lib/workspace";
import {
  approveInventoryCount,
  cancelInventoryCount,
  setInventoryThreshold,
  submitInventoryCount,
} from "./actions";
import {
  InventoryCountDialog,
  InventoryLocationDialog,
  InventoryMovementDialog,
  type InventoryBalance,
  type InventoryInput,
  type InventoryLocation,
  type InventoryService,
} from "./inventory-client";
import "../../procurement-inventory.css";

type Project = { id: string; code: string | null; name: string };
type Movement = {
  id: string;
  movement_number: string;
  movement_type: string;
  movement_date: string;
  input_code: string;
  input_name: string;
  unit_snapshot: string;
  from_location_id: string | null;
  to_location_id: string | null;
  quantity: number;
  unit_cost: number;
  total_value: number;
  batch_number: string;
  expiration_date: string;
  cost_center_code: string | null;
  cost_center_name: string | null;
  recipient_name: string | null;
  source_type: string | null;
  source_reference: string | null;
  notes: string | null;
  created_at: string;
};
type Count = {
  id: string;
  location_id: string;
  count_number: string;
  count_date: string;
  status: string;
  notes: string | null;
  counter_name: string | null;
  submitted_at: string | null;
  approved_at: string | null;
  approval_notes: string | null;
  cancellation_reason: string | null;
  created_at: string;
};
type CountItem = {
  id: string;
  count_id: string;
  input_code: string;
  input_name: string;
  unit_snapshot: string;
  batch_number: string;
  expiration_date: string;
  book_quantity: number;
  counted_quantity: number;
  difference_quantity: number;
  unit_cost: number;
  difference_value: number;
};

const movementLabels: Record<string, string> = {
  receipt: "Entrada por recebimento",
  issue: "Saída para consumo",
  transfer: "Transferência",
  adjustment_in: "Ajuste de entrada",
  adjustment_out: "Ajuste de saída",
  return_to_supplier: "Devolução ao fornecedor",
  return_to_stock: "Devolução ao estoque",
};
const countLabels: Record<string, string> = {
  draft: "Em elaboração",
  submitted: "Aguardando aprovação",
  approved: "Aprovado",
  cancelled: "Cancelado",
};
const locationLabels: Record<string, string> = {
  warehouse: "Almoxarifado",
  site: "Canteiro",
  floor: "Pavimento",
  container: "Container",
  external: "Área externa",
  other: "Outro",
};

function money(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value || 0));
}
function quantity(value: number, digits = 4) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: digits }).format(Number(value || 0));
}
function dateBR(value?: string | null) {
  return value
    ? new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(new Date(`${value.slice(0, 10)}T12:00:00Z`))
    : "—";
}
function expiry(value: string) {
  return value?.slice(0, 10) === "9999-12-31" ? "—" : dateBR(value);
}

export default async function InventoryPage({ searchParams }: {
  searchParams: Promise<{
    view?: string;
    q?: string;
    location?: string;
    alert?: string;
    count?: string;
    success?: string;
    error?: string;
  }>;
}) {
  const params = await searchParams;
  const view = ["balances", "movements", "counts", "locations"].includes(params.view ?? "")
    ? params.view!
    : "balances";
  const { supabase, company, companyId, projectId, roleKey } = await requireCompanyPermission("procurement.inventory.view");
  const privileged = roleKey === "owner" || roleKey === "admin";
  const permission = (key: string) => privileged
    ? Promise.resolve({ data: true, error: null })
    : supabase.rpc("has_company_permission", { target_company_id: companyId, target_permission: key });

  const [
    projectResult,
    locationsResult,
    balancesResult,
    movementsResult,
    countsResult,
    countItemsResult,
    inputsResult,
    servicesResult,
    manageResult,
    issueResult,
    transferResult,
    adjustResult,
    countResult,
  ] = await Promise.all([
    projectId
      ? supabase.from("projects").select("id,code,name").eq("id", projectId).eq("company_id", companyId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    projectId
      ? fetchAllRows<InventoryLocation>(async (from, to) => {
          const { data, error } = await supabase
            .from("procurement_inventory_locations")
            .select("id,code,name,location_type,address,responsible_name,allow_negative,status")
            .eq("company_id", companyId)
            .eq("project_id", projectId)
            .order("name")
            .range(from, to);
          return { data: (data ?? []) as InventoryLocation[], error };
        })
      : Promise.resolve({ data: [] as InventoryLocation[], error: null }),
    projectId
      ? fetchAllRows<InventoryBalance>(async (from, to) => {
          const { data, error } = await supabase
            .from("procurement_inventory_balances")
            .select("id,input_id,location_id,input_code,input_name,unit_snapshot,category_snapshot,batch_number,expiration_date,quantity_on_hand,reserved_quantity,available_quantity,average_unit_cost,total_value,minimum_quantity,maximum_quantity")
            .eq("company_id", companyId)
            .eq("project_id", projectId)
            .order("input_name")
            .range(from, to);
          return { data: (data ?? []) as InventoryBalance[], error };
        })
      : Promise.resolve({ data: [] as InventoryBalance[], error: null }),
    projectId
      ? fetchAllRows<Movement>(async (from, to) => {
          const { data, error } = await supabase
            .from("procurement_inventory_movements")
            .select("id,movement_number,movement_type,movement_date,input_code,input_name,unit_snapshot,from_location_id,to_location_id,quantity,unit_cost,total_value,batch_number,expiration_date,cost_center_code,cost_center_name,recipient_name,source_type,source_reference,notes,created_at")
            .eq("company_id", companyId)
            .eq("project_id", projectId)
            .order("created_at", { ascending: false })
            .range(from, to);
          return { data: (data ?? []) as Movement[], error };
        })
      : Promise.resolve({ data: [] as Movement[], error: null }),
    projectId
      ? fetchAllRows<Count>(async (from, to) => {
          const { data, error } = await supabase
            .from("procurement_inventory_counts")
            .select("id,location_id,count_number,count_date,status,notes,counter_name,submitted_at,approved_at,approval_notes,cancellation_reason,created_at")
            .eq("company_id", companyId)
            .eq("project_id", projectId)
            .order("created_at", { ascending: false })
            .range(from, to);
          return { data: (data ?? []) as Count[], error };
        })
      : Promise.resolve({ data: [] as Count[], error: null }),
    projectId
      ? fetchAllRows<CountItem>(async (from, to) => {
          const { data, error } = await supabase
            .from("procurement_inventory_count_items")
            .select("id,count_id,input_code,input_name,unit_snapshot,batch_number,expiration_date,book_quantity,counted_quantity,difference_quantity,unit_cost,difference_value")
            .eq("company_id", companyId)
            .eq("project_id", projectId)
            .order("sort_order")
            .range(from, to);
          return { data: (data ?? []) as CountItem[], error };
        })
      : Promise.resolve({ data: [] as CountItem[], error: null }),
    fetchAllRows<InventoryInput>(async (from, to) => {
      const { data, error } = await supabase
        .from("engineering_inputs")
        .select("id,code,description,unit,category")
        .eq("company_id", companyId)
        .eq("status", "active")
        .eq("category", "material")
        .order("code")
        .range(from, to);
      return { data: (data ?? []) as InventoryInput[], error };
    }),
    fetchAllRows<InventoryService>(async (from, to) => {
      const { data, error } = await supabase
        .from("engineering_services")
        .select("id,code,description")
        .eq("company_id", companyId)
        .eq("status", "active")
        .order("code")
        .range(from, to);
      return { data: (data ?? []) as InventoryService[], error };
    }),
    permission("procurement.inventory.manage"),
    permission("procurement.inventory.issue"),
    permission("procurement.inventory.transfer"),
    permission("procurement.inventory.adjust"),
    permission("procurement.inventory.count"),
  ]);

  const project = projectResult.data as Project | null;
  const locations = locationsResult.data;
  const balances = balancesResult.data;
  const locationMap = new Map(locations.map((location) => [location.id, location]));
  const countItemMap = new Map<string, CountItem[]>();
  countItemsResult.data.forEach((item) => {
    countItemMap.set(item.count_id, [...(countItemMap.get(item.count_id) ?? []), item]);
  });

  const canManage = manageResult.data === true || privileged;
  const canIssue = issueResult.data === true || privileged;
  const canTransfer = transferResult.data === true || privileged;
  const canAdjust = adjustResult.data === true || privileged;
  const canCount = countResult.data === true || privileged;
  const structureError = locationsResult.error || balancesResult.error || movementsResult.error || countsResult.error;
  const query = (params.q ?? "").trim().toLocaleLowerCase("pt-BR");

  const filteredBalances = balances
    .filter((balance) => !params.location || balance.location_id === params.location)
    .filter((balance) => params.alert !== "low" || (
      Number(balance.minimum_quantity) > 0 && Number(balance.available_quantity) <= Number(balance.minimum_quantity)
    ))
    .filter((balance) => !query || [
      balance.input_code,
      balance.input_name,
      balance.batch_number,
      locationMap.get(balance.location_id)?.name ?? "",
    ].join(" ").toLocaleLowerCase("pt-BR").includes(query));

  const filteredMovements = movementsResult.data
    .filter((movement) => !params.location || movement.from_location_id === params.location || movement.to_location_id === params.location)
    .filter((movement) => !query || [
      movement.movement_number,
      movement.input_code,
      movement.input_name,
      movement.source_reference ?? "",
      movement.cost_center_name ?? "",
    ].join(" ").toLocaleLowerCase("pt-BR").includes(query));

  const stockValue = balances.reduce((sum, balance) => sum + Number(balance.total_value), 0);
  const activeBalances = balances.filter((balance) => Number(balance.quantity_on_hand) > 0);
  const lowBalances = activeBalances.filter((balance) => (
    Number(balance.minimum_quantity) > 0 && Number(balance.available_quantity) <= Number(balance.minimum_quantity)
  ));
  const expiryLimit = new Date();
  expiryLimit.setDate(expiryLimit.getDate() + 60);
  const expiring = activeBalances.filter((balance) => (
    balance.expiration_date.slice(0, 10) !== "9999-12-31"
    && new Date(`${balance.expiration_date.slice(0, 10)}T12:00:00`) <= expiryLimit
  ));
  const selectedCount = params.count
    ? countsResult.data.find((count) => count.id === params.count) ?? null
    : null;
  const selectedCountItems = selectedCount ? countItemMap.get(selectedCount.id) ?? [] : [];
  const nextCode = `ALM-${String(locations.length + 1).padStart(3, "0")}`;
  const context = project ? `${project.code ? `${project.code} · ` : ""}${project.name}` : "Selecione uma obra";

  return (
    <AppShell
      activeGroup="procurement"
      activeItem="inventory"
      eyebrow="Suprimentos · Controle físico"
      title="Estoque"
      description={`${company.name} · ${context} · saldos, consumo, transferências, inventários e rastreabilidade dos materiais recebidos.`}
      actions={projectId ? <>
        {canManage ? <InventoryLocationDialog nextCode={nextCode} /> : null}
        {canCount ? <InventoryCountDialog balances={balances} locations={locations} /> : null}
        <InventoryMovementDialog
          balances={balances}
          locations={locations}
          inputs={inputsResult.data}
          services={servicesResult.data}
          canIssue={canIssue}
          canTransfer={canTransfer}
          canAdjust={canAdjust}
        />
      </> : undefined}
    >
      {params.success ? <div className="auth-message success workspace-message">{params.success}</div> : null}
      {params.error ? <div className="auth-message error workspace-message">{params.error}</div> : null}
      {structureError ? <div className="auth-message error workspace-message">
        A estrutura de estoque ainda não está instalada. Execute a migration <strong>20260729_0044_procurement_inventory.sql</strong>.
      </div> : null}

      {!projectId ? <div className="inventory-empty">Selecione uma obra no topo.</div> : <>
        <section className="inventory-kpis">
          <article><span>Valor em estoque</span><strong>{money(stockValue)}</strong><small>custo médio dos saldos atuais</small></article>
          <article><span>Materiais com saldo</span><strong>{activeBalances.length}</strong><small>{quantity(activeBalances.reduce((sum, balance) => sum + Number(balance.quantity_on_hand), 0))} unidades consolidadas</small></article>
          <article className={lowBalances.length ? "warning" : ""}><span>Abaixo do mínimo</span><strong>{lowBalances.length}</strong><small>necessitam reposição ou revisão</small></article>
          <article className={expiring.length ? "warning" : ""}><span>Validade em 60 dias</span><strong>{expiring.length}</strong><small>lotes para consumo prioritário</small></article>
          <article><span>Locais ativos</span><strong>{locations.filter((location) => location.status === "active").length}</strong><small>almoxarifados e frentes</small></article>
        </section>

        <nav className="inventory-tabs">
          <Link className={view === "balances" ? "active" : ""} href="?view=balances">Saldos</Link>
          <Link className={view === "movements" ? "active" : ""} href="?view=movements">Movimentações</Link>
          <Link className={view === "counts" ? "active" : ""} href="?view=counts">Inventários</Link>
          <Link className={view === "locations" ? "active" : ""} href="?view=locations">Locais</Link>
        </nav>

        {view === "balances" ? <>
          <section className="inventory-toolbar">
            <form method="get">
              <input type="hidden" name="view" value="balances" />
              <input name="q" defaultValue={params.q ?? ""} placeholder="Buscar material, código, lote ou local" />
              <select name="location" defaultValue={params.location ?? ""}>
                <option value="">Todos os locais</option>
                {locations.map((location) => <option key={location.id} value={location.id}>{location.code} · {location.name}</option>)}
              </select>
              <select name="alert" defaultValue={params.alert ?? ""}>
                <option value="">Todos os saldos</option>
                <option value="low">Abaixo do mínimo</option>
              </select>
              <button type="submit">Filtrar</button>
              <Link href="?view=balances">Limpar</Link>
            </form>
          </section>
          <section className="inventory-card">
            <div className="inventory-card-head"><div><span>Posição atual</span><h2>Saldo por material, local e lote</h2></div><strong>{filteredBalances.length} registro(s)</strong></div>
            <div className="registry-table-wrap">
              <table className="registry-table inventory-table">
                <thead><tr><th>Material</th><th>Local</th><th>Lote / validade</th><th>Em estoque</th><th>Reservado</th><th>Disponível</th><th>Custo médio</th><th>Valor</th><th>Níveis</th></tr></thead>
                <tbody>
                  {filteredBalances.map((balance) => {
                    const low = Number(balance.minimum_quantity) > 0 && Number(balance.available_quantity) <= Number(balance.minimum_quantity);
                    return <tr key={balance.id} className={low ? "low-stock" : ""}>
                      <td><strong>{balance.input_code}</strong><span>{balance.input_name}</span><small>{balance.category_snapshot ?? "Material"}</small></td>
                      <td><strong>{locationMap.get(balance.location_id)?.name ?? "Local não encontrado"}</strong><span>{locationMap.get(balance.location_id)?.code ?? ""}</span></td>
                      <td>{balance.batch_number || "Sem lote"}<span>Validade: {expiry(balance.expiration_date)}</span></td>
                      <td>{quantity(balance.quantity_on_hand)} {balance.unit_snapshot}</td>
                      <td>{quantity(balance.reserved_quantity)}</td>
                      <td><strong>{quantity(balance.available_quantity)} {balance.unit_snapshot}</strong>{low ? <span className="inventory-alert">Abaixo do mínimo</span> : null}</td>
                      <td>{money(balance.average_unit_cost)}</td>
                      <td><strong>{money(balance.total_value)}</strong></td>
                      <td>{canManage ? <form action={setInventoryThreshold} className="inventory-threshold">
                        <input type="hidden" name="balance_id" value={balance.id} />
                        <label>Mín.<input name="minimum_quantity" type="number" min="0" step="0.000001" defaultValue={balance.minimum_quantity} /></label>
                        <label>Máx.<input name="maximum_quantity" type="number" min="0" step="0.000001" defaultValue={balance.maximum_quantity ?? ""} /></label>
                        <button type="submit">Salvar</button>
                      </form> : <>{quantity(balance.minimum_quantity)} / {balance.maximum_quantity === null ? "—" : quantity(balance.maximum_quantity)}</>}</td>
                    </tr>;
                  })}
                  {!filteredBalances.length ? <tr><td colSpan={9} className="budget-empty-state">Nenhum saldo encontrado. Entradas surgem automaticamente quando um recebimento é aprovado.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </section>
        </> : null}

        {view === "movements" ? <>
          <section className="inventory-toolbar">
            <form method="get">
              <input type="hidden" name="view" value="movements" />
              <input name="q" defaultValue={params.q ?? ""} placeholder="Buscar movimentação, material, referência ou serviço" />
              <select name="location" defaultValue={params.location ?? ""}>
                <option value="">Todos os locais</option>
                {locations.map((location) => <option key={location.id} value={location.id}>{location.code} · {location.name}</option>)}
              </select>
              <button type="submit">Filtrar</button>
              <Link href="?view=movements">Limpar</Link>
            </form>
          </section>
          <section className="inventory-card">
            <div className="inventory-card-head"><div><span>Kardex</span><h2>Histórico de movimentações</h2></div><strong>{filteredMovements.length} lançamento(s)</strong></div>
            <div className="registry-table-wrap">
              <table className="registry-table inventory-movement-table">
                <thead><tr><th>Movimento</th><th>Data</th><th>Tipo</th><th>Material</th><th>Origem → destino</th><th>Quantidade</th><th>Custo</th><th>Centro de custo / referência</th></tr></thead>
                <tbody>
                  {filteredMovements.map((movement) => <tr key={movement.id}>
                    <td><strong>{movement.movement_number}</strong><span>{movement.source_reference ?? "Lançamento manual"}</span></td>
                    <td>{dateBR(movement.movement_date)}</td>
                    <td><span className={`inventory-movement-type ${movement.movement_type}`}>{movementLabels[movement.movement_type]}</span></td>
                    <td><strong>{movement.input_code}</strong><span>{movement.input_name}</span>{movement.batch_number ? <small>Lote {movement.batch_number}</small> : null}</td>
                    <td>{movement.from_location_id ? locationMap.get(movement.from_location_id)?.name : "Entrada"}<span>→ {movement.to_location_id ? locationMap.get(movement.to_location_id)?.name : "Saída"}</span></td>
                    <td><strong>{quantity(movement.quantity)} {movement.unit_snapshot}</strong><span>{movement.recipient_name ?? ""}</span></td>
                    <td>{money(movement.unit_cost)}<span>{money(movement.total_value)}</span></td>
                    <td>{movement.cost_center_code ? `${movement.cost_center_code} · ${movement.cost_center_name}` : "—"}<span>{movement.notes ?? ""}</span></td>
                  </tr>)}
                  {!filteredMovements.length ? <tr><td colSpan={8} className="budget-empty-state">Nenhuma movimentação registrada.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </section>
        </> : null}

        {view === "counts" && selectedCount ? <>
          <div className="inventory-back"><Link href="?view=counts">← Voltar aos inventários</Link><span>{selectedCount.count_number}</span></div>
          <section className="inventory-count-hero">
            <div><span>Inventário físico</span><h2>{selectedCount.count_number} · {locationMap.get(selectedCount.location_id)?.name}</h2><p>Contagem de {dateBR(selectedCount.count_date)} · {selectedCount.counter_name ?? "Responsável não informado"}</p></div>
            <span className={`inventory-count-status ${selectedCount.status}`}>{countLabels[selectedCount.status]}</span>
          </section>
          <section className="inventory-card">
            <div className="inventory-card-head"><div><span>Comparativo</span><h2>Saldo do sistema × contagem física</h2></div><strong>{money(selectedCountItems.reduce((sum, item) => sum + Number(item.difference_value), 0))}</strong></div>
            <div className="registry-table-wrap">
              <table className="registry-table">
                <thead><tr><th>Material</th><th>Lote</th><th>Saldo sistema</th><th>Contado</th><th>Diferença</th><th>Valor da diferença</th></tr></thead>
                <tbody>{selectedCountItems.map((item) => <tr key={item.id}>
                  <td><strong>{item.input_code}</strong><span>{item.input_name}</span></td>
                  <td>{item.batch_number || "—"}<span>{expiry(item.expiration_date)}</span></td>
                  <td>{quantity(item.book_quantity)} {item.unit_snapshot}</td>
                  <td><strong>{quantity(item.counted_quantity)} {item.unit_snapshot}</strong></td>
                  <td className={item.difference_quantity < 0 ? "negative" : item.difference_quantity > 0 ? "positive" : ""}>{item.difference_quantity > 0 ? "+" : ""}{quantity(item.difference_quantity)}</td>
                  <td className={item.difference_value < 0 ? "negative" : item.difference_value > 0 ? "positive" : ""}>{money(item.difference_value)}</td>
                </tr>)}</tbody>
              </table>
            </div>
          </section>
          <section className="inventory-count-actions">
            <div><strong>Fluxo do inventário</strong><p>A aprovação gera ajustes automáticos de entrada ou saída para cada diferença.</p></div>
            <div>
              {selectedCount.status === "draft" && canCount ? <form action={submitInventoryCount}><input type="hidden" name="count_id" value={selectedCount.id} /><button className="primary" type="submit">Enviar para aprovação</button></form> : null}
              {selectedCount.status === "submitted" && canCount ? <form action={approveInventoryCount}><input type="hidden" name="count_id" value={selectedCount.id} /><input name="notes" placeholder="Observação da aprovação" /><button className="primary" type="submit">Aprovar e ajustar saldo</button></form> : null}
              {["draft", "submitted"].includes(selectedCount.status) && canCount ? <form action={cancelInventoryCount}><input type="hidden" name="count_id" value={selectedCount.id} /><input name="notes" required placeholder="Motivo do cancelamento" /><button className="danger" type="submit">Cancelar</button></form> : null}
            </div>
          </section>
        </> : null}

        {view === "counts" && !selectedCount ? <section className="inventory-card">
          <div className="inventory-card-head"><div><span>Conferência periódica</span><h2>Inventários físicos</h2></div><strong>{countsResult.data.length} inventário(s)</strong></div>
          <div className="registry-table-wrap">
            <table className="registry-table">
              <thead><tr><th>Inventário</th><th>Local</th><th>Data</th><th>Responsável</th><th>Itens</th><th>Diferença</th><th>Status</th></tr></thead>
              <tbody>
                {countsResult.data.map((count) => {
                  const items = countItemMap.get(count.id) ?? [];
                  const differenceValue = items.reduce((sum, item) => sum + Number(item.difference_value), 0);
                  return <tr key={count.id}>
                    <td><Link href={`?view=counts&count=${count.id}`}><strong>{count.count_number}</strong></Link></td>
                    <td>{locationMap.get(count.location_id)?.name ?? "—"}</td>
                    <td>{dateBR(count.count_date)}</td>
                    <td>{count.counter_name ?? "—"}</td>
                    <td>{items.length}</td>
                    <td className={differenceValue < 0 ? "negative" : differenceValue > 0 ? "positive" : ""}>{money(differenceValue)}</td>
                    <td><span className={`inventory-count-status ${count.status}`}>{countLabels[count.status]}</span></td>
                  </tr>;
                })}
                {!countsResult.data.length ? <tr><td colSpan={7} className="budget-empty-state">Nenhum inventário criado.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </section> : null}

        {view === "locations" ? <section className="inventory-location-grid">
          {locations.map((location) => {
            const locationBalances = balances.filter((balance) => balance.location_id === location.id);
            return <article key={location.id}>
              <div><span>{locationLabels[location.location_type] ?? "Local"}</span><h3>{location.code} · {location.name}</h3><p>{location.address || "Sem referência de endereço"}</p></div>
              <dl>
                <div><dt>Materiais</dt><dd>{locationBalances.filter((balance) => balance.quantity_on_hand > 0).length}</dd></div>
                <div><dt>Valor</dt><dd>{money(locationBalances.reduce((sum, balance) => sum + Number(balance.total_value), 0))}</dd></div>
                <div><dt>Responsável</dt><dd>{location.responsible_name || "—"}</dd></div>
              </dl>
            </article>;
          })}
          {!locations.length ? <div className="inventory-empty">Nenhum local cadastrado.</div> : null}
        </section> : null}
      </>}
    </AppShell>
  );
}
