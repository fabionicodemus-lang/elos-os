import Link from "next/link";
import { createClient, setClientStatus } from "@/app/cadastros/actions";
import { requireCompanyPermission } from "@/lib/workspace";

type Client = {
  id: string;
  person_type: string;
  name: string;
  tax_id: string | null;
  identity_document: string | null;
  profession: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  status: "active" | "inactive";
  source_system: string | null;
};

const PAGE_SIZE = 50;

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string; error?: string; success?: string }>;
}) {
  const params = await searchParams;
  const { supabase, company, companyId } = await requireCompanyPermission("clients.view");
  const queryText = (params.q ?? "").trim();
  const status = params.status === "inactive" ? "inactive" : params.status === "active" ? "active" : "";
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let listQuery = supabase
    .from("clients")
    .select("id, person_type, name, tax_id, identity_document, profession, email, phone, city, state, status, source_system", { count: "exact" })
    .eq("company_id", companyId)
    .order("name")
    .range(from, to);

  if (status) listQuery = listQuery.eq("status", status);
  if (queryText) {
    const safe = queryText.replace(/[,%()]/g, " ").trim();
    listQuery = listQuery.or(`name.ilike.%${safe}%,tax_id.ilike.%${safe}%,email.ilike.%${safe}%`);
  }

  const [{ data, count, error }, { count: activeCount }, { count: inactiveCount }, { data: canManage }] = await Promise.all([
    listQuery,
    supabase.from("clients").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("status", "active"),
    supabase.from("clients").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("status", "inactive"),
    supabase.rpc("has_company_permission", { target_company_id: companyId, target_permission: "clients.manage" }),
  ]);

  const clients = (data ?? []) as Client[];
  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <main className="registry-page">
      <header className="settings-header registry-header">
        <div>
          <span>Comercial · Cadastros</span>
          <h1>Clientes</h1>
          <p>{company.name} · base central usada por propostas, vendas, contratos e contas a receber</p>
        </div>
        <div className="registry-header-actions">
          <Link className="back-link" href="/cadastros/fornecedores">Fornecedores</Link>
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
          <input name="q" defaultValue={queryText} placeholder="Buscar nome, CPF/CNPJ ou e-mail" />
          <select name="status" defaultValue={status}>
            <option value="">Todos os status</option>
            <option value="active">Ativos</option>
            <option value="inactive">Inativos</option>
          </select>
          <button type="submit">Filtrar</button>
          {(queryText || status) ? <Link href="/cadastros/clientes">Limpar</Link> : null}
        </form>

        {canManage === true ? (
          <details className="registry-create">
            <summary>+ Novo cliente</summary>
            <form action={createClient}>
              <div className="registry-form-grid">
                <label>Tipo<select name="person_type" defaultValue="PF"><option value="PF">Pessoa física</option><option value="PJ">Pessoa jurídica</option><option value="OTHER">Outro</option></select></label>
                <label>Nome / razão social<input name="name" required /></label>
                <label>CPF/CNPJ<input name="tax_id" /></label>
                <label>RG / documento<input name="identity_document" /></label>
                <label>Data de nascimento<input name="birth_date" type="date" /></label>
                <label>Estado civil<input name="marital_status" /></label>
                <label>Profissão<input name="profession" /></label>
                <label>E-mail<input name="email" type="email" /></label>
                <label>Telefone<input name="phone" /></label>
                <label>Segundo telefone<input name="secondary_phone" /></label>
                <label>Cidade<input name="city" /></label>
                <label>UF<input name="state" maxLength={2} /></label>
                <label>Nacionalidade<input name="nationality" /></label>
                <label className="registry-wide">Observações<textarea name="notes" rows={3} /></label>
              </div>
              <button className="auth-primary" type="submit">Salvar cliente</button>
            </form>
          </details>
        ) : null}
      </section>

      <section className="registry-table-panel">
        <div className="section-heading">
          <div><span>Base comercial</span><h2>Clientes encontrados</h2></div>
          <p>{total} registro(s) no filtro atual. Clientes vinculados a vendas e contratos são inativados, não excluídos.</p>
        </div>
        <div className="registry-table-wrap">
          <table className="registry-table">
            <thead><tr><th>Cliente</th><th>Documento</th><th>Tipo</th><th>Contato</th><th>Local</th><th>Status</th><th>Ação</th></tr></thead>
            <tbody>
              {clients.map((client) => (
                <tr key={client.id}>
                  <td><strong>{client.name}</strong><span>{client.profession || ""}</span><small>{client.source_system === "bossa_legacy" ? "Importado da Bossa" : "Cadastrado no Elos OS"}</small></td>
                  <td>{client.tax_id || client.identity_document || "—"}</td>
                  <td>{client.person_type === "PF" ? "Pessoa física" : client.person_type === "PJ" ? "Pessoa jurídica" : "Outro"}</td>
                  <td><span>{client.phone || "—"}</span><small>{client.email}</small></td>
                  <td>{[client.city, client.state].filter(Boolean).join(" / ") || "—"}</td>
                  <td><span className={`status-badge ${client.status}`}>{client.status === "active" ? "Ativo" : "Inativo"}</span></td>
                  <td>
                    {canManage === true ? (
                      <form action={setClientStatus}>
                        <input type="hidden" name="client_id" value={client.id} />
                        <input type="hidden" name="status" value={client.status === "active" ? "inactive" : "active"} />
                        <button className="table-action" type="submit">{client.status === "active" ? "Inativar" : "Reativar"}</button>
                      </form>
                    ) : <span>Somente leitura</span>}
                  </td>
                </tr>
              ))}
              {clients.length === 0 ? <tr><td colSpan={7} className="empty-table">Nenhum cliente encontrado.</td></tr> : null}
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
