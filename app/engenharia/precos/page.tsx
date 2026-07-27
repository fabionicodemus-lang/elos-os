import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { DateRangeFilter } from "@/components/date-range-filter";
import { resolveDateRange } from "@/lib/date-range";
import { fetchAllRows } from "@/lib/supabase-pagination";
import { requireCompanyPermission } from "@/lib/workspace";
import { adoptEngineeringInputPrice, toggleEngineeringInputPriceStatus } from "./actions";
import { PriceImportDialog } from "./import-dialog";
import {
  PriceCreateDialog,
  PriceEditDialog,
  type EngineeringInputPriceDialogData,
  type PriceInputOption,
  type PriceSupplierOption,
} from "./price-dialogs";

type Project = { id: string; name: string; code: string | null };
type PriceInput = PriceInputOption & { category: string; family_code: string | null };
type PriceSupplier = PriceSupplierOption;
type PriceProject = Project;
type PriceStat = {
  input_id: string;
  supplier_id: string | null;
  project_id: string | null;
  price_date: string;
  is_adopted: boolean;
};

type EngineeringInputPrice = EngineeringInputPriceDialogData & {
  final_unit_price: number;
  currency: string;
  created_at: string;
  updated_at: string;
  engineering_inputs: PriceInput | PriceInput[] | null;
  suppliers: PriceSupplier | PriceSupplier[] | null;
  projects: PriceProject | PriceProject[] | null;
};

const PAGE_SIZE = 50;
const PRICE_SELECT = "id, input_id, supplier_id, project_id, price_date, unit_price, freight_unit_cost, other_unit_cost, discount_percentage, final_unit_price, currency, is_adopted, source, notes, status, created_at, updated_at, engineering_inputs(id, code, description, unit, category, family_code), suppliers(id, legal_name, trade_name), projects(id, name, code)";

function relatedOne<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function money(value: number | null | undefined) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(Number(value ?? 0));
}

function decimal(value: number | null | undefined, digits = 2) {
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number(value ?? 0));
}

function dateBR(value: string | null | undefined) {
  if (!value) return "—";
  const [year, month, day] = value.slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}

function daysSince(value: string) {
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / 86_400_000));
}

function buildQuery(params: Record<string, string>, page: number) {
  const query = new URLSearchParams(params);
  query.set("page", String(page));
  return `?${query.toString()}`;
}

function staleDate() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - 90);
  return date.toISOString().slice(0, 10);
}

export default async function EngineeringPricesPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    input?: string;
    supplier?: string;
    scope?: string;
    situation?: string;
    period?: string;
    from?: string;
    to?: string;
    page?: string;
    success?: string;
    error?: string;
  }>;
}) {
  const params = await searchParams;
  const { supabase, company, companyId, projectId, roleKey } = await requireCompanyPermission("prices.view");
  const queryText = (params.q ?? "").trim().toLocaleLowerCase("pt-BR");
  const inputId = params.input ?? "";
  const supplierId = params.supplier ?? "";
  const scope = ["corporate", "project"].includes(params.scope ?? "") ? params.scope! : "";
  const situation = ["adopted", "quoted", "inactive", "stale"].includes(params.situation ?? "") ? params.situation! : "";
  const requestedPage = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const dateRange = resolveDateRange(params.period, params.from, params.to);

  const projectQuery = projectId
    ? supabase.from("projects").select("id, name, code").eq("id", projectId).maybeSingle()
    : Promise.resolve({ data: null, error: null });

  const managePromise = roleKey === "owner" || roleKey === "admin"
    ? Promise.resolve({ data: true, error: null })
    : supabase.rpc("has_company_permission", {
        target_company_id: companyId,
        target_permission: "prices.manage",
      });

  // O histórico detalhado é paginado abaixo. Aqui trazemos apenas dados leves
  // necessários para filtros, formulários e indicadores da visão geral.
  const [inputsResult, suppliersResult, statsResult, projectResult, manageResult] = await Promise.all([
    fetchAllRows<PriceInput>(async (from, to) => {
      const { data, error } = await supabase
        .from("engineering_inputs")
        .select("id, code, description, unit, category, family_code")
        .eq("company_id", companyId)
        .eq("status", "active")
        .order("code")
        .range(from, to);
      return { data: (data ?? []) as PriceInput[], error };
    }),
    fetchAllRows<PriceSupplier>(async (from, to) => {
      const { data, error } = await supabase
        .from("suppliers")
        .select("id, legal_name, trade_name")
        .eq("company_id", companyId)
        .eq("status", "active")
        .order("legal_name")
        .range(from, to);
      return { data: (data ?? []) as PriceSupplier[], error };
    }),
    fetchAllRows<PriceStat>(async (from, to) => {
      const { data, error } = await supabase
        .from("engineering_input_prices")
        .select("input_id, supplier_id, project_id, price_date, is_adopted")
        .eq("company_id", companyId)
        .eq("status", "active")
        .range(from, to);
      return { data: (data ?? []) as PriceStat[], error };
    }),
    projectQuery,
    managePromise,
  ]);

  const inputs = inputsResult.data;
  const suppliers = suppliersResult.data;
  const activePrices = statsResult.data;
  const project = projectResult.data as Project | null;
  const canManage = manageResult.data === true || roleKey === "owner" || roleKey === "admin";
  const validInputId = inputs.some((input) => input.id === inputId) ? inputId : "";
  const validSupplierId = suppliers.some((supplier) => supplier.id === supplierId) ? supplierId : "";

  let pricesQuery = supabase
    .from("engineering_input_prices")
    .select(PRICE_SELECT, { count: "exact" })
    .eq("company_id", companyId);

  if (validInputId) pricesQuery = pricesQuery.eq("input_id", validInputId);
  if (validSupplierId) pricesQuery = pricesQuery.eq("supplier_id", validSupplierId);
  if (scope === "corporate") pricesQuery = pricesQuery.is("project_id", null);
  if (scope === "project") {
    pricesQuery = projectId ? pricesQuery.eq("project_id", projectId) : pricesQuery.not("project_id", "is", null);
  }
  if (dateRange.from) pricesQuery = pricesQuery.gte("price_date", dateRange.from);
  if (dateRange.to) pricesQuery = pricesQuery.lte("price_date", dateRange.to);
  if (situation === "adopted") pricesQuery = pricesQuery.eq("status", "active").eq("is_adopted", true);
  if (situation === "quoted") pricesQuery = pricesQuery.eq("status", "active").eq("is_adopted", false);
  if (situation === "inactive") pricesQuery = pricesQuery.eq("status", "inactive");
  if (situation === "stale") pricesQuery = pricesQuery.eq("status", "active").eq("is_adopted", true).lt("price_date", staleDate());

  if (queryText) {
    const normalized = queryText.replace(/[,%()]/g, " ").replace(/\s+/g, " ").trim();
    const matchingInputs = inputs
      .filter((input) => [input.code, input.description, input.family_code ?? ""].join(" ").toLocaleLowerCase("pt-BR").includes(queryText))
      .slice(0, 80)
      .map((input) => input.id);
    const matchingSuppliers = suppliers
      .filter((supplier) => [supplier.trade_name ?? "", supplier.legal_name].join(" ").toLocaleLowerCase("pt-BR").includes(queryText))
      .slice(0, 80)
      .map((supplier) => supplier.id);
    const clauses = [
      `source.ilike.*${normalized}*`,
      `notes.ilike.*${normalized}*`,
      ...(matchingInputs.length ? [`input_id.in.(${matchingInputs.join(",")})`] : []),
      ...(matchingSuppliers.length ? [`supplier_id.in.(${matchingSuppliers.join(",")})`] : []),
      ...(projectId && [project?.code ?? "", project?.name ?? ""].join(" ").toLocaleLowerCase("pt-BR").includes(queryText) ? [`project_id.eq.${projectId}`] : []),
    ];
    pricesQuery = pricesQuery.or(clauses.join(","));
  }

  const pageFrom = (requestedPage - 1) * PAGE_SIZE;
  const pricesResult = await pricesQuery
    .order("price_date", { ascending: false })
    .order("created_at", { ascending: false })
    .range(pageFrom, pageFrom + PAGE_SIZE - 1);

  const prices = (pricesResult.data ?? []) as unknown as EngineeringInputPrice[];
  const filteredCount = pricesResult.count ?? prices.length;
  const totalPages = Math.max(1, Math.ceil(filteredCount / PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);
  const adoptedPrices = activePrices.filter((price) => price.is_adopted);
  const pricedInputs = new Set(activePrices.map((price) => price.input_id)).size;
  const quotedSuppliers = new Set(activePrices.map((price) => price.supplier_id).filter(Boolean)).size;
  const staleAdopted = adoptedPrices.filter((price) => daysSince(price.price_date) > 90).length;
  const corporateAdopted = adoptedPrices.filter((price) => !price.project_id).length;
  const projectAdopted = adoptedPrices.filter((price) => Boolean(price.project_id)).length;
  const filterParams = {
    q: params.q ?? "",
    input: validInputId,
    supplier: validSupplierId,
    scope,
    situation,
    period: dateRange.preset,
    from: dateRange.from,
    to: dateRange.to,
  };
  const projectName = project ? `${project.code ? `${project.code} · ` : ""}${project.name}` : null;
  const schemaMissing = pricesResult.error?.code === "42P01" || pricesResult.error?.message.includes("engineering_input_prices");

  return (
    <AppShell
      activeGroup="engineering"
      activeItem="prices"
      eyebrow="Engenharia · Orçamento de Obras"
      title="Preços e Cotações"
      description={`${company.name} · histórico comercial dos insumos, com referência corporativa e preços específicos por obra.`}
      actions={canManage ? (
        <>
          <PriceImportDialog projectName={projectName} />
          <PriceCreateDialog inputs={inputs} suppliers={suppliers} projectName={projectName} />
        </>
      ) : undefined}
    >
      {params.success ? <div className="auth-message success workspace-message">{params.success}</div> : null}
      {params.error ? <div className="auth-message error workspace-message">{params.error}</div> : null}
      {schemaMissing ? (
        <div className="auth-message error workspace-message">
          A estrutura de preços e cotações ainda não está instalada. Execute a migration <strong>20260724_0017_engineering_input_prices.sql</strong>.
        </div>
      ) : null}

      <nav className="budget-module-nav" aria-label="Etapas do orçamento de obras">
        <Link href="/engenharia/orcamentos">▦ Visão geral</Link>
        <Link href="/engenharia/servicos">≡ Serviços</Link>
        <Link href="/engenharia/insumos">◈ Insumos</Link>
        <span className="active">$ Preços e cotações</span>
        <Link href="/engenharia/levantamento">∑ Levantamento</Link>
        <Link href="/engenharia/orcamento-analitico">R$ Orçamento analítico</Link>
      </nav>

      <section className="price-kpi-grid">
        <article><span>Cotações ativas</span><strong>{activePrices.length}</strong><small>históricos e referências disponíveis</small></article>
        <article><span>Insumos com preço</span><strong>{pricedInputs}</strong><small>de {inputs.length} insumo(s) ativos</small></article>
        <article><span>Preços adotados</span><strong>{adoptedPrices.length}</strong><small>{corporateAdopted} corporativo(s) · {projectAdopted} por obra</small></article>
        <article><span>Fornecedores cotados</span><strong>{quotedSuppliers}</strong><small>fornecedores com histórico registrado</small></article>
        <article><span>Preços vencidos</span><strong className={staleAdopted > 0 ? "budgets-alert" : ""}>{staleAdopted}</strong><small>referências adotadas há mais de 90 dias</small></article>
        <article><span>Sem cotação</span><strong>{Math.max(0, inputs.length - pricedInputs)}</strong><small>insumos ativos ainda sem preço</small></article>
      </section>

      <section className="price-guidance-card">
        <div>
          <span>Histórico preservado</span>
          <h2>Uma cotação não substitui a anterior; ela cria uma nova referência comercial</h2>
          <p>O preço final considera desconto, frete e outros custos unitários. A cotação adotada será usada nas composições e revisões do orçamento, sem apagar o histórico.</p>
        </div>
        <div className="price-guidance-flow">
          <article><b>1</b><span><strong>Preço base</strong><small>valor informado pelo fornecedor</small></span></article>
          <article><b>2</b><span><strong>Condições</strong><small>desconto, frete e outros custos</small></span></article>
          <article><b>3</b><span><strong>Preço final</strong><small>custo unitário comparável</small></span></article>
          <article><b>4</b><span><strong>Preço adotado</strong><small>referência para o orçamento</small></span></article>
        </div>
      </section>

      <section className="price-toolbar-card">
        <form method="get" className="price-filter">
          <input name="q" defaultValue={params.q ?? ""} placeholder="Insumo, fornecedor, obra, origem ou observação" />
          <select name="input" defaultValue={validInputId}>
            <option value="">Todos os insumos</option>
            {inputs.map((input) => <option key={input.id} value={input.id}>{input.code} · {input.description}</option>)}
          </select>
          <select name="supplier" defaultValue={validSupplierId}>
            <option value="">Todos os fornecedores</option>
            {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.trade_name || supplier.legal_name}</option>)}
          </select>
          <select name="scope" defaultValue={scope}>
            <option value="">Corporativo e obras</option>
            <option value="corporate">Somente corporativo</option>
            <option value="project">Somente obra atual</option>
          </select>
          <select name="situation" defaultValue={situation}>
            <option value="">Todas as situações</option>
            <option value="adopted">Preços adotados</option>
            <option value="quoted">Cotações não adotadas</option>
            <option value="stale">Adotados há mais de 90 dias</option>
            <option value="inactive">Cotações inativas</option>
          </select>
          <DateRangeFilter defaultPreset={dateRange.preset} defaultFrom={dateRange.from} defaultTo={dateRange.to} />
          <button type="submit">Filtrar</button>
          <Link href="/engenharia/precos">Limpar</Link>
        </form>
      </section>

      <section className="price-table-card">
        <div className="budget-section-head">
          <div><span>Histórico comercial</span><h2>Cotações e preços adotados</h2></div>
          <p>{filteredCount} registro(s) no filtro atual.</p>
        </div>
        <div className="registry-table-wrap">
          <table className="registry-table price-catalog-table">
            <thead>
              <tr><th>Insumo</th><th>Escopo</th><th>Fornecedor</th><th>Data</th><th>Preço base</th><th>Desconto</th><th>Frete + outros</th><th>Preço final</th><th>Situação</th><th>Origem</th><th>Ações</th></tr>
            </thead>
            <tbody>
              {prices.map((price) => {
                const input = relatedOne(price.engineering_inputs);
                const supplier = relatedOne(price.suppliers);
                const priceProject = relatedOne(price.projects);
                const age = daysSince(price.price_date);
                const stale = price.status === "active" && price.is_adopted && age > 90;
                return (
                  <tr key={price.id} className={stale ? "price-row-stale" : price.status === "inactive" ? "price-row-inactive" : ""}>
                    <td><strong>{input?.code ?? "—"}</strong><span>{input?.description ?? "Insumo removido"} · {input?.unit ?? "—"}</span></td>
                    <td>{priceProject ? <><strong>{priceProject.code || "Obra"}</strong><span>{priceProject.name}</span></> : <span className="price-scope corporate">Corporativo</span>}</td>
                    <td>{supplier ? <><strong>{supplier.trade_name || supplier.legal_name}</strong><span>{supplier.trade_name ? supplier.legal_name : "Fornecedor cadastrado"}</span></> : <span className="price-pending-text">Não informado</span>}</td>
                    <td><strong>{dateBR(price.price_date)}</strong><span>{age} dia(s)</span></td>
                    <td><strong>{money(price.unit_price)}</strong></td>
                    <td>{Number(price.discount_percentage) > 0 ? `${decimal(price.discount_percentage)}%` : "—"}</td>
                    <td>{money(Number(price.freight_unit_cost) + Number(price.other_unit_cost))}</td>
                    <td><strong className="price-final-value">{money(price.final_unit_price)}</strong></td>
                    <td>
                      {price.status === "inactive" ? <span className="price-status inactive">Inativa</span> : price.is_adopted ? <span className={`price-status adopted ${stale ? "stale" : ""}`}>{stale ? "Adotado · revisar" : "Adotado"}</span> : <span className="price-status quoted">Cotação</span>}
                    </td>
                    <td>{price.source || <span className="price-pending-text">Sem referência</span>}{price.notes ? <span>{price.notes}</span> : null}</td>
                    <td>
                      {canManage ? (
                        <div className="price-row-actions">
                          <PriceEditDialog price={price} inputs={inputs} suppliers={suppliers} projectName={projectName} />
                          {price.status === "active" && !price.is_adopted ? (
                            <form action={adoptEngineeringInputPrice}><input type="hidden" name="price_id" value={price.id} /><button className="table-action price-adopt-action" type="submit">Adotar</button></form>
                          ) : null}
                          <form action={toggleEngineeringInputPriceStatus}>
                            <input type="hidden" name="price_id" value={price.id} />
                            <input type="hidden" name="next_status" value={price.status === "active" ? "inactive" : "active"} />
                            <button className={`table-action ${price.status === "active" ? "danger" : ""}`} type="submit">{price.status === "active" ? "Inativar" : "Reativar"}</button>
                          </form>
                        </div>
                      ) : "—"}
                    </td>
                  </tr>
                );
              })}
              {prices.length === 0 ? <tr><td className="budget-empty-state" colSpan={11}><strong>Nenhuma cotação encontrada.</strong><span>Cadastre o primeiro preço ou altere os filtros.</span></td></tr> : null}
            </tbody>
          </table>
        </div>
        <div className="registry-pagination">
          <span>Página {page} de {totalPages}</span>
          <div>
            {page > 1 ? <Link href={buildQuery(filterParams, page - 1)}>Anterior</Link> : null}
            {page < totalPages ? <Link href={buildQuery(filterParams, page + 1)}>Próxima</Link> : null}
          </div>
        </div>
      </section>
    </AppShell>
  );
}
