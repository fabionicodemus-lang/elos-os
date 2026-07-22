import Link from "next/link";
import { createSupplier, setSupplierStatus } from "@/app/cadastros/actions";
import { requireCompanyPermission } from "@/lib/workspace";

type Supplier = {
  id: string;
  person_type: string;
  legal_name: string;
  trade_name: string | null;
  tax_id: string | null;
  category: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  state: string | null;
  status: "active" | "inactive";
  source_system: string | null;
};

const PAGE_SIZE = 50;

export default async function SuppliersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string; error?: string; success?: string }>;
}) {
  const params = await searchParams;
  const { supabase, company, companyId } = await requireCompanyPermission("suppliers.view");
  const queryText = (params.q ?? "").trim();
  const status = params.status === "inactive" ? "inactive" : params.status === "active" ? "active" : "";
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let listQuery = supabase
    .from("suppliers")
    .select("id, person_type, legal_name, trade_name, tax_id, category, phone, email, city, state, status, source_system", { count: "exact" })
    .eq("company_id", companyId)
    .order("legal_name")
    .range(from, to);

  if (status) listQuery = listQuery.eq("status", status);
  if (queryText) {
    const safe = queryText.replace(/[,%()]/g, " ").trim();
    listQuery = listQuery.or(`legal_name.ilike.%${safe}%,trade_name.ilike.%${safe}%,tax_id.ilike.%${safe}%`);
  }

  const [{ data, count, error }, { count: activeCount }, { count: inactiveCount }, { data: canManage }] = await Promise.all([
    listQuery,
    supabase.from("suppliers").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("status", "active"),
    supabase.from("suppliers").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("status", "inactive"),
    supabase.rpc("has_company_permission", { target_company_id: companyId, target_permission: "suppliers.manage" }),
  ]);

  const suppliers = (data ?? []) as Supplier[];
  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <main className="registry-page">
      <header className="settings-header registry-header">
        <div>
          <span>Cadastros gerais</span>
          <h1>Fornecedores</h1>
          <p>{company.name} · base central compartilhada entre Execução, Suprimentos e Financeiro</p>
        </div>
        <div className="registry-header-actions">
          <Link className="back-link" href="/cadastros/clientes">Clientes</Link>
          <Link className="back-link" href="/dashboard">Voltar ao dashboard</Link>
        </div>
      </header>

      {params.error ? <div className="auth-message error workspace-message">{params.error}</div> : null}
      {params.success ? <div className="auth-message success workspace-message">{params.success}</div> : null}
      {error ? <div className="auth-message error workspace-message">{error.message}</div> : null}

      <section className="access-summary registry-summary">
        <article><span>Total cadastrado</span><strong>{(activeCount ?? 0) + (inactiveCount ?? 0)}</strong></article>
        <article><span>Ativos</span><strong>{activeCount ?? 0}</strong></article>
        <article><span>Inativos</span><strong>{inactiveCount ?? 0}</strong></article>
      </section>

      <section className="registry-toolbar">
        <form className="registry-filter" method="get">
          <input name="q" defaultValue={queryText} placeholder="Buscar nome, fantasia ou CPF/CNPJ" />
          <select name="status" defaultValue={status}>
            <option value="">Todos os status</option>
            <option value="active">Ativos</option>
            <option value="inactive">Inativos</option>
          </select>
          <button type="submit">Filtrar</button>
          {(queryText || status) ? <Link href="/cadastros/fornecedores">Limpar</Link> : null}
        </form>

        {canManage === true ? (
          <details className="registry-create">
            <summary>+ Novo fornecedor</summary>
            <form action={createSupplier}>
              <div className="registry-form-grid">
                <label>Tipo<select name="person_type" defaultValue="company"><option value="company">Pessoa jurídica</option><option value="individual">Pessoa física</option><option value="other">Outro</option></select></label>
                <label>Razão social / nome<input name="legal_name" required /></label>
                <label>Nome fantasia<input name="trade_name" /></label>
                <label>CPF/CNPJ<input name="tax_id" /></label>
                <label>Inscrição estadual<input name="state_registration" /></label>
                <label>Categoria<input name="category" placeholder="Materiais, serviços, transporte..." /></label>
                <label>Contato<input name="contact_name" /></label>
                <label>Telefone<input name="phone" /></label>
                <label>E-mail<input name="email" type="email" /></label>
                <label>Cidade<input name="city" /></label>
                <label>UF<input name="state" maxLength={2} /></label>
                <label className="registry-wide">Observações<textarea name="notes" rows={3} /></label>
              </div>
              <button className="auth-primary" type="submit">Salvar fornecedor</button>
            </form>
          </details>
        ) : null}
      </section>

      <section className="registry-table-panel">
        <div className="section-heading">
          <div><span>Base central</span><h2>Fornecedores encontrados</h2></div>
          <p>{total} registro(s) no filtro atual. Fornecedores não são excluídos; quando necessário, são inativados.</p>
        </div>
        <div className="registry-table-wrap">
          <table className="registry-table">
            <thead><tr><th>Fornecedor</th><th>Documento</th><th>Categoria</th><th>Contato</th><th>Local</th><th>Status</th><th>Ação</th></tr></thead>
            <tbody>
              {suppliers.map((supplier) => (
                <tr key={supplier.id}>
                  <td><strong>{supplier.trade_name || supplier.legal_name}</strong>{supplier.trade_name ? <span>{supplier.legal_name}</span> : null}<small>{supplier.source_system === "bossa_legacy" ? "Importado da Bossa" : "Cadastrado no Elos OS"}</small></td>
                  <td>{supplier.tax_id || "—"}</td>
                  <td>{supplier.category || "—"}</td>
                  <td><span>{supplier.phone || "—"}</span><small>{supplier.email}</small></td>
                  <td>{[supplier.city, supplier.state].filter(Boolean).join(" / ") || "—"}</td>
                  <td><span className={`status-badge ${supplier.status}`}>{supplier.status === "active" ? "Ativo" : "Inativo"}</span></td>
                  <td>
                    {canManage === true ? (
                      <form action={setSupplierStatus}>
                        <input type="hidden" name="supplier_id" value={supplier.id} />
                        <input type="hidden" name="status" value={supplier.status === "active" ? "inactive" : "active"} />
                        <button className="table-action" type="submit">{supplier.status === "active" ? "Inativar" : "Reativar"}</button>
                      </form>
                    ) : <span>Somente leitura</span>}
                  </td>
                </tr>
              ))}
              {suppliers.length === 0 ? <tr><td colSpan={7} className="empty-table">Nenhum fornecedor encontrado.</td></tr> : null}
            </tbody>
          </table>
        </div>

        <div className="registry-pagination">
          <span>Página {page} de {totalPages}</span>
          <div>
            {page > 1 ? <Link href={`?q=${encodeURIComponent(queryText)}&status=${status}&page=${page - 1}`}>Anterior</Link> : null}
            {page < totalPages ? <Link href={`?q=${encodeURIComponent(queryText)}&status=${status}&page=${page + 1}`}>Próxima</Link> : null}
          </div>
        </div>
      </section>
    </main>
  );
}
