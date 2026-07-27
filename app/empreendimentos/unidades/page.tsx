import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { requireCompanyPermission } from "@/lib/workspace";
import { setProjectUnitStatus } from "./actions";
import {
  UnitCreateDialog,
  UnitEditDialog,
  UnitImportDialog,
  type FloorLocationOption,
  type ProjectUnitData,
} from "./unit-dialogs";

const statusLabels: Record<string, string> = {
  available: "Disponível",
  reserved: "Reservada",
  sold: "Vendida",
  inactive: "Inativa",
};

function decimal(value: number | null | undefined) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(Number(value ?? 0));
}

function money(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(Number(value));
}

export default async function ProjectUnitsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; type?: string; success?: string; error?: string }>;
}) {
  const params = await searchParams;
  const { supabase, companyId, projectId, roleKey } = await requireCompanyPermission("projects.view");

  const [projectsResult, manageResult] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name, code, status")
      .eq("company_id", companyId)
      .neq("status", "archived")
      .order("name"),
    roleKey === "owner" || roleKey === "admin"
      ? Promise.resolve({ data: true, error: null })
      : supabase.rpc("has_company_permission", {
          target_company_id: companyId,
          target_permission: "projects.manage",
        }),
  ]);

  const projects = projectsResult.data ?? [];
  const project = projects.find((item) => item.id === projectId) ?? projects[0] ?? null;
  const canManage = manageResult.data === true || roleKey === "owner" || roleKey === "admin";

  const [unitsResult, locationsResult] = project
    ? await Promise.all([
        supabase
          .from("units")
          .select("id, code, tower, floor, type, position, floor_location_id, private_area, uncovered_private_area, common_area, total_area, fractional_share, bedrooms, suites, parking_spaces, parking_description, list_price, status, registry, notes")
          .eq("company_id", companyId)
          .eq("project_id", project.id)
          .order("floor")
          .order("code"),
        supabase
          .from("engineering_takeoff_locations")
          .select("id, code, name, location_type")
          .eq("company_id", companyId)
          .eq("project_id", project.id)
          .eq("status", "active")
          .order("sort_order")
          .order("name"),
      ])
    : [{ data: [], error: null }, { data: [], error: null }];

  const units = (unitsResult.data ?? []) as ProjectUnitData[];
  const locations = (locationsResult.data ?? []) as FloorLocationOption[];
  const locationMap = new Map(locations.map((location) => [location.id, location]));
  const queryText = (params.q ?? "").trim().toLocaleLowerCase("pt-BR");
  const statusFilter = allowedStatus(params.status) ? params.status! : "";
  const typeFilter = (params.type ?? "").trim();
  const unitTypes = Array.from(new Set(units.map((unit) => unit.type).filter((value): value is string => Boolean(value)))).sort((a, b) => a.localeCompare(b, "pt-BR"));

  const filtered = units.filter((unit) => {
    if (statusFilter && unit.status !== statusFilter) return false;
    if (typeFilter && unit.type !== typeFilter) return false;
    if (!queryText) return true;
    const location = unit.floor_location_id ? locationMap.get(unit.floor_location_id) : null;
    return [unit.code, unit.tower ?? "", unit.type ?? "", unit.position ?? "", location?.name ?? "", unit.parking_description ?? "", unit.registry ?? ""]
      .join(" ")
      .toLocaleLowerCase("pt-BR")
      .includes(queryText);
  });

  const activeUnits = units.filter((unit) => unit.status !== "inactive");
  const availableCount = units.filter((unit) => unit.status === "available").length;
  const reservedCount = units.filter((unit) => unit.status === "reserved").length;
  const soldCount = units.filter((unit) => unit.status === "sold").length;
  const totalPrivateArea = activeUnits.reduce((sum, unit) => sum + Number(unit.private_area ?? 0) + Number(unit.uncovered_private_area ?? 0), 0);
  const totalListPrice = activeUnits.reduce((sum, unit) => sum + Number(unit.list_price ?? 0), 0);

  return (
    <AppShell
      activeGroup="projects"
      activeItem="project-units"
      eyebrow="Empreendimentos"
      title="Unidades privativas"
      description="Cadastre apartamentos, salas, vagas vinculadas e informações comerciais do empreendimento."
    >
      {params.success ? <div className="auth-message success workspace-message">{params.success}</div> : null}
      {params.error ? <div className="auth-message error workspace-message">{params.error}</div> : null}
      {unitsResult.error ? (
        <div className="auth-message error workspace-message">
          Execute no Supabase a migration <strong>20260727_0029_project_units.sql</strong> para liberar o cadastro completo: {unitsResult.error.message}
        </div>
      ) : null}

      {!project ? (
        <section className="unit-empty-state">
          <strong>Nenhum empreendimento selecionado.</strong>
          <span>Cadastre ou selecione uma obra antes de gerenciar as unidades privativas.</span>
          <Link href="/empreendimentos">Abrir cadastro de empreendimentos</Link>
        </section>
      ) : (
        <section className="unit-page">
          <div className="unit-toolbar">
            <div>
              <span>Obra selecionada</span>
              <strong>{project.name}</strong>
              <small>{project.code || "Sem código"} · {activeUnits.length} unidade(s) ativa(s)</small>
            </div>
            {canManage ? <div className="unit-toolbar-actions"><UnitImportDialog /><UnitCreateDialog locations={locations} /></div> : null}
          </div>

          <div className="unit-kpis">
            <article><span>Unidades ativas</span><strong>{activeUnits.length}</strong><small>{availableCount} disponíveis · {reservedCount} reservadas</small></article>
            <article><span>Vendidas</span><strong>{soldCount}</strong><small>{activeUnits.length ? decimal((soldCount / activeUnits.length) * 100) : "0"}% do estoque ativo</small></article>
            <article><span>Área privativa</span><strong>{decimal(totalPrivateArea)} m²</strong><small>soma coberta e descoberta</small></article>
            <article><span>Valor de tabela</span><strong>{money(totalListPrice)}</strong><small>soma das unidades com preço cadastrado</small></article>
          </div>

          <div className="unit-filter-card">
            <form method="get">
              <label><span>Buscar</span><input name="q" defaultValue={params.q ?? ""} placeholder="Unidade, torre, tipo, posição ou vaga" /></label>
              <label><span>Situação</span><select name="status" defaultValue={statusFilter}><option value="">Todas</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label><span>Tipo</span><select name="type" defaultValue={typeFilter}><option value="">Todos</option>{unitTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
              <button type="submit">Aplicar filtros</button>
              {(params.q || statusFilter || typeFilter) ? <a href="/empreendimentos/unidades">Limpar</a> : null}
            </form>
            <p>{filtered.length} unidade(s) no filtro atual.</p>
          </div>

          <div className="unit-table-card">
            <div className="unit-table-wrap">
              <table className="unit-table">
                <thead><tr><th>Unidade</th><th>Torre / pavimento</th><th>Tipo / posição</th><th>Área privativa</th><th>Área total</th><th>Dorm. / suítes</th><th>Vagas</th><th>Preço tabela</th><th>Situação</th><th>Ações</th></tr></thead>
                <tbody>
                  {filtered.map((unit) => {
                    const location = unit.floor_location_id ? locationMap.get(unit.floor_location_id) : null;
                    return (
                      <tr key={unit.id} className={unit.status === "inactive" ? "is-inactive" : undefined}>
                        <td><div className="unit-code-cell"><span>{unit.code}</span><small>{unit.registry ? `Matrícula ${unit.registry}` : "Sem matrícula"}</small></div></td>
                        <td><div className="unit-stacked"><strong>{unit.tower || "Torre única"}</strong><small>{unit.floor !== null ? `${unit.floor}º pavimento` : "Pavimento não informado"}{location ? ` · ${location.code}` : ""}</small></div></td>
                        <td><div className="unit-stacked"><strong>{unit.type || "—"}</strong><small>{unit.position || "Posição não informada"}</small></div></td>
                        <td><strong>{unit.private_area !== null ? `${decimal(Number(unit.private_area) + Number(unit.uncovered_private_area ?? 0))} m²` : "—"}</strong></td>
                        <td>{unit.total_area !== null ? `${decimal(unit.total_area)} m²` : "—"}</td>
                        <td>{unit.bedrooms ?? "—"} / {unit.suites ?? "—"}</td>
                        <td><div className="unit-stacked"><strong>{unit.parking_spaces ?? 0}</strong><small>{unit.parking_description || "—"}</small></div></td>
                        <td><strong>{money(unit.list_price)}</strong></td>
                        <td><span className={`unit-status ${unit.status}`}>{statusLabels[unit.status] ?? unit.status}</span></td>
                        <td>
                          {canManage ? (
                            <div className="unit-actions">
                              <UnitEditDialog unit={unit} locations={locations} />
                              {unit.status === "available" ? <UnitStatusButton unitId={unit.id} status="reserved" label="Reservar" /> : null}
                              {unit.status === "reserved" ? <UnitStatusButton unitId={unit.id} status="available" label="Liberar" /> : null}
                              {unit.status !== "sold" && unit.status !== "inactive" ? <UnitStatusButton unitId={unit.id} status="inactive" label="Inativar" danger /> : null}
                              {unit.status === "inactive" ? <UnitStatusButton unitId={unit.id} status="available" label="Reativar" /> : null}
                            </div>
                          ) : <span className="unit-readonly">Somente leitura</span>}
                        </td>
                      </tr>
                    );
                  })}
                  {!unitsResult.error && filtered.length === 0 ? <tr><td colSpan={10} className="unit-table-empty">Nenhuma unidade encontrada.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </div>

          <div className="unit-callout"><b>Cadastro único:</b> estas mesmas unidades são utilizadas nas vendas, contratos e contas a receber. Uma venda ativa mantém automaticamente a unidade como <strong>Vendida</strong>.</div>
        </section>
      )}
    </AppShell>
  );
}

function allowedStatus(status?: string) {
  return Boolean(status && Object.prototype.hasOwnProperty.call(statusLabels, status));
}

function UnitStatusButton({ unitId, status, label, danger = false }: { unitId: string; status: string; label: string; danger?: boolean }) {
  return (
    <form action={setProjectUnitStatus}>
      <input type="hidden" name="unit_id" value={unitId} />
      <input type="hidden" name="status" value={status} />
      <button className={danger ? "unit-status-button danger" : "unit-status-button"} type="submit">{label}</button>
    </form>
  );
}
