import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { requireCompanyPermission } from "@/lib/workspace";
import { toggleEngineeringInputStatus } from "./actions";
import { InputCreateDialog, InputEditDialog, type EngineeringInputDialogData } from "./input-dialogs";
import { InputImportDialog } from "./import-dialog";

type EngineeringInput = EngineeringInputDialogData & { updated_at: string };
type UnitRecord = { unit: string };

const PAGE_SIZE = 50;

const categoryLabels: Record<string, string> = {
  material: "Material",
  labor: "Mão de obra",
  equipment: "Equipamento",
  service: "Serviço terceirizado",
  freight: "Frete",
  other: "Outro custo",
};

function dateBR(value: string | null | undefined) {
  if (!value) return "—";
  const [year, month, day] = value.slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}

function buildQuery(params: Record<string, string>, page: number) {
  const query = new URLSearchParams(params);
  query.set("page", String(page));
  return `?${query.toString()}`;
}

export default async function EngineeringInputsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; family?: string; category?: string; status?: string; page?: string; success?: string; error?: string }>;
}) {
  const params = await searchParams;
  const { supabase, company, companyId, roleKey } = await requireCompanyPermission("inputs.view");
  const queryText = (params.q ?? "").trim().toLowerCase();
  const category = Object.keys(categoryLabels).includes(params.category ?? "") ? params.category! : "";
  const status = ["active", "inactive"].includes(params.status ?? "") ? params.status! : "";
  const requestedPage = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

  const managePromise = roleKey === "owner" || roleKey === "admin"
    ? Promise.resolve({ data: true, error: null })
    : supabase.rpc("has_company_permission", { target_company_id: companyId, target_permission: "inputs.manage" });

  const [inputsResult, serviceUnitsResult, manageResult] = await Promise.all([
    supabase
      .from("engineering_inputs")
      .select("id, code, description, unit, category, family_code, family_label, brand_reference, technical_specification, source_system, source_code, notes, status, updated_at")
      .eq("company_id", companyId)
      .order("family_code", { ascending: true, nullsFirst: false })
      .order("code", { ascending: true })
      .limit(10000),
    supabase
      .from("engineering_services")
      .select("unit")
      .eq("company_id", companyId)
      .limit(10000),
    managePromise,
  ]);

  const inputs = (inputsResult.data ?? []) as EngineeringInput[];
  const serviceUnits = (serviceUnitsResult.data ?? []) as UnitRecord[];
  const canManage = manageResult.data === true || roleKey === "owner" || roleKey === "admin";
  const familyCodes = [...new Set(inputs.map((input) => input.family_code).filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const familyNames = [...new Set(inputs.map((input) => input.family_label?.trim()).filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const units = [...new Set([
    ...inputs.map((input) => input.unit),
    ...serviceUnits.map((service) => service.unit),
  ].map((value) => value?.trim()).filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const family = familyCodes.includes(params.family ?? "") ? params.family! : "";

  const filteredInputs = inputs.filter((input) => {
    if (family && input.family_code !== family) return false;
    if (category && input.category !== category) return false;
    if (status && input.status !== status) return false;
    if (!queryText) return true;
    return [input.code, input.description, input.unit, input.family_code ?? "", input.family_label ?? "", input.brand_reference ?? "", input.technical_specification ?? "", input.source_code ?? "", input.notes ?? ""]
      .join(" ")
      .toLowerCase()
      .includes(queryText);
  });

  const totalPages = Math.max(1, Math.ceil(filteredInputs.length / PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);
  const pageInputs = filteredInputs.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const activeCount = inputs.filter((input) => input.status === "active").length;
  const technicalCount = inputs.filter((input) => Boolean(input.technical_specification?.trim())).length;
  const referenceCount = inputs.filter((input) => Boolean(input.brand_reference?.trim())).length;
  const externalCount = inputs.filter((input) => input.source_system !== "elos_os" || Boolean(input.source_code)).length;
  const incompleteCount = inputs.filter((input) => !input.family_code || !input.technical_specification).length;
  const filterParams = { q: params.q ?? "", family, category, status };

  return (
    <AppShell
      activeGroup="engineering"
      activeItem="inputs"
      eyebrow="Engenharia · Orçamento de Obras"
      title="Catálogo de Insumos"
      description={`${company.name} · base corporativa de materiais, mão de obra, equipamentos e outros custos, separada do histórico de preços.`}
      actions={canManage ? <><InputImportDialog /><InputCreateDialog familyCodes={familyCodes} familyNames={familyNames} units={units} /></> : undefined}
    >
      {params.success ? <div className="auth-message success workspace-message">{params.success}</div> : null}
      {params.error ? <div className="auth-message error workspace-message">{params.error}</div> : null}
      {inputsResult.error ? <div className="auth-message error workspace-message">A estrutura do catálogo de insumos ainda não está instalada no Supabase. Execute a migration <strong>20260724_0016_engineering_inputs.sql</strong>.</div> : null}

      <nav className="budget-module-nav" aria-label="Etapas do orçamento de obras">
        <Link href="/engenharia/orcamentos">▦ Visão geral</Link>
        <Link href="/engenharia/servicos">≡ Serviços</Link>
        <span className="active">◈ Insumos</span>
        <Link href="/engenharia/precos">$ Preços e cotações</Link>
        <Link href="/engenharia/composicoes">⌘ Composições</Link>
        <span>∑ Levantamento</span>
        <span>R$ Orçamento analítico</span>
      </nav>

      <section className="input-kpi-grid">
        <article><span>Insumos ativos</span><strong>{activeCount}</strong><small>disponíveis para composições</small></article>
        <article><span>Famílias técnicas</span><strong>{familyCodes.length}</strong><small>agrupamentos padronizados</small></article>
        <article><span>Com especificação</span><strong>{technicalCount}</strong><small>critérios técnicos registrados</small></article>
        <article><span>Marca ou referência</span><strong>{referenceCount}</strong><small>referências de desempenho ou produto</small></article>
        <article><span>Origem externa</span><strong>{externalCount}</strong><small>Koper, SINAPI e outras bases</small></article>
        <article><span>A revisar</span><strong className={incompleteCount > 0 ? "budgets-alert" : ""}>{incompleteCount}</strong><small>sem família ou especificação</small></article>
      </section>

      <section className="input-guidance-card">
        <div><span>Separação correta da informação</span><h2>O cadastro define o que é o insumo; o preço registra quanto ele custa em cada data</h2><p>Assim, um mesmo cabo, bloco ou serviço terceirizado pode ter vários fornecedores, cotações e preços históricos sem duplicar o cadastro técnico.</p></div>
        <div className="input-guidance-flow">
          <article><b>1</b><span><strong>Insumo</strong><small>descrição e especificação</small></span></article>
          <article><b>2</b><span><strong>Preços</strong><small>fornecedor, data e condição</small></span></article>
          <article><b>3</b><span><strong>Composição</strong><small>coeficiente no serviço</small></span></article>
          <article><b>4</b><span><strong>Orçamento</strong><small>custo adotado na revisão</small></span></article>
        </div>
      </section>

      <section className="input-toolbar-card">
        <form method="get" className="input-filter">
          <input name="q" defaultValue={params.q ?? ""} placeholder="Digite código, descrição, marca, referência ou código externo" />
          <select name="family" defaultValue={family}><option value="">Todas as famílias</option>{familyCodes.map((item) => <option key={item} value={item}>{item}</option>)}</select>
          <select name="category" defaultValue={category}><option value="">Todas as naturezas</option>{Object.entries(categoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          <select name="status" defaultValue={status}><option value="">Ativos e inativos</option><option value="active">Somente ativos</option><option value="inactive">Somente inativos</option></select>
          <button type="submit">Filtrar</button>
          <Link href="/engenharia/insumos">Limpar</Link>
        </form>
      </section>

      <section className="input-table-card">
        <div className="budget-section-head"><div><span>Base técnica corporativa</span><h2>Insumos padronizados</h2></div><p>{filteredInputs.length} insumo(s) no filtro atual.</p></div>
        <div className="registry-table-wrap">
          <table className="registry-table input-catalog-table">
            <thead><tr><th>Código</th><th>Insumo</th><th>Natureza</th><th>Família</th><th>Un.</th><th>Marca / referência</th><th>Especificação</th><th>Origem</th><th>Status</th><th>Atualização</th><th>Ações</th></tr></thead>
            <tbody>
              {pageInputs.map((input) => {
                const complete = Boolean(input.family_code && input.technical_specification);
                return <tr key={input.id} className={complete ? "" : "input-row-incomplete"}>
                  <td><strong className="budget-code">{input.code}</strong>{input.source_code ? <span>Origem: {input.source_code}</span> : null}</td>
                  <td><strong>{input.description}</strong>{input.notes ? <span>{input.notes}</span> : null}</td>
                  <td><span className={`input-category ${input.category}`}>{categoryLabels[input.category] ?? input.category}</span></td>
                  <td><strong>{input.family_code ?? "Sem família"}</strong>{input.family_label ? <span>{input.family_label}</span> : null}</td>
                  <td><strong>{input.unit}</strong></td>
                  <td>{input.brand_reference || <span className="input-pending-text">Não definida</span>}</td>
                  <td>{input.technical_specification ? <span className="input-spec-text">{input.technical_specification}</span> : <span className="input-pending-text">Não definida</span>}</td>
                  <td>{input.source_system}</td>
                  <td><span className={`service-status ${input.status}`}>{input.status === "active" ? "Ativo" : "Inativo"}</span></td>
                  <td>{dateBR(input.updated_at)}</td>
                  <td>{canManage ? <div className="input-row-actions"><InputEditDialog input={input} familyCodes={familyCodes} familyNames={familyNames} units={units} /><form action={toggleEngineeringInputStatus}><input type="hidden" name="input_id" value={input.id} /><input type="hidden" name="next_status" value={input.status === "active" ? "inactive" : "active"} /><button className={`table-action ${input.status === "active" ? "danger" : ""}`} type="submit">{input.status === "active" ? "Inativar" : "Reativar"}</button></form></div> : "—"}</td>
                </tr>;
              })}
              {pageInputs.length === 0 ? <tr><td className="budget-empty-state" colSpan={11}><strong>Nenhum insumo encontrado.</strong><span>Cadastre o primeiro insumo técnico, importe uma planilha ou altere os filtros.</span></td></tr> : null}
            </tbody>
          </table>
        </div>
        <div className="registry-pagination"><span>Página {page} de {totalPages}</span><div>{page > 1 ? <Link href={buildQuery(filterParams, page - 1)}>Anterior</Link> : null}{page < totalPages ? <Link href={buildQuery(filterParams, page + 1)}>Próxima</Link> : null}</div></div>
      </section>
    </AppShell>
  );
}
