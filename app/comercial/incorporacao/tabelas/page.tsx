import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { requireCompanyPermission } from "@/lib/workspace";
import { activatePriceTable, savePriceItem, savePriceTable } from "../actions";

function money(value: number | null | undefined) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value ?? 0));
}

type TableRow = { id:string; project_id:string; name:string; version_no:number; valid_from:string; valid_until:string|null; status:string; notes:string|null; correction_indices:{code:string;name:string}|{code:string;name:string}[]|null };
type Unit = { id:string; project_id:string; code:string; type:string|null; status:string; list_price:number|null };
type Item = { id:string; price_table_id:string; unit_id:string; list_price:number; cash_price:number|null; minimum_price:number|null; units:{code:string}|{code:string}[]|null };

function one<T>(value:T|T[]|null):T|null { return Array.isArray(value) ? value[0] ?? null : value; }

export default async function PriceTablesPage({ searchParams }: { searchParams: Promise<{ table?:string; project?:string; error?:string; success?:string }> }) {
  const params = await searchParams;
  const { supabase, company, companyId, projectId, roleKey } = await requireCompanyPermission("commercial.incorporation.view");
  const [projectsResult, indicesResult, manageResult] = await Promise.all([
    supabase.from("projects").select("id,name,code").eq("company_id", companyId).neq("status","archived").order("name"),
    supabase.from("correction_indices").select("id,code,name").eq("company_id", companyId).eq("status","active").order("code"),
    supabase.rpc("has_company_permission", { target_company_id: companyId, target_permission: "commercial.incorporation.manage" }),
  ]);
  const selectedProject = params.project || projectId || projectsResult.data?.[0]?.id || "";
  const [tablesResult, unitsResult] = await Promise.all([
    selectedProject ? supabase.from("commercial_price_tables").select("id,project_id,name,version_no,valid_from,valid_until,status,notes,correction_indices(code,name)").eq("company_id",companyId).eq("project_id",selectedProject).order("created_at",{ascending:false}) : Promise.resolve({data:[],error:null}),
    selectedProject ? supabase.from("units").select("id,project_id,code,type,status,list_price").eq("company_id",companyId).eq("project_id",selectedProject).neq("status","inactive").order("code") : Promise.resolve({data:[],error:null}),
  ]);
  const tables = (tablesResult.data ?? []) as unknown as TableRow[];
  const selectedTable = tables.find(t => t.id === params.table) ?? tables[0] ?? null;
  const itemsResult = selectedTable ? await supabase.from("commercial_price_table_items").select("id,price_table_id,unit_id,list_price,cash_price,minimum_price,units(code)").eq("company_id",companyId).eq("price_table_id",selectedTable.id).order("created_at") : {data:[],error:null};
  const items = (itemsResult.data ?? []) as unknown as Item[];
  const units = (unitsResult.data ?? []) as Unit[];
  const privileged = roleKey === "owner" || roleKey === "admin";
  const canManage = manageResult.data === true || privileged;

  return <AppShell activeGroup="commercial" activeItem="price-tables" eyebrow="Comercial · Incorporação" title="Tabelas de venda"
    description={`${company.name} · histórico de preço por empreendimento e unidade.`}
    actions={<Link className="elos-button" prefetch={false} href="/comercial/incorporacao">Voltar à carteira</Link>}>
    {params.error ? <div className="auth-message error workspace-message">{params.error}</div> : null}
    {params.success ? <div className="auth-message success workspace-message">{params.success}</div> : null}
    {tablesResult.error || unitsResult.error || itemsResult.error ? <div className="auth-message error workspace-message">A migration do ERP de incorporação precisa estar aplicada.</div> : null}

    <section className="registry-toolbar">
      <form method="get" className="bank-filter">
        <label>Empreendimento<select name="project" defaultValue={selectedProject}>{projectsResult.data?.map(p => <option key={p.id} value={p.id}>{p.code ? `${p.code} · ` : ""}{p.name}</option>)}</select></label>
        <button type="submit">Abrir</button>
      </form>
    </section>

    {canManage ? <details className="registry-create" open={!tables.length}>
      <summary>+ Nova tabela de venda</summary>
      <form action={savePriceTable} className="registry-form-grid">
        <input type="hidden" name="project_id" value={selectedProject}/>
        <label>Nome<input name="name" placeholder="Tabela Novembro 2026" required/></label>
        <label>Versão<input name="version_no" type="number" min="1" defaultValue="1" required/></label>
        <label>Vigência inicial<input name="valid_from" type="date" required/></label>
        <label>Vigência final<input name="valid_until" type="date"/></label>
        <label>Índice padrão<select name="correction_index_id"><option value="">Sem índice padrão</option>{indicesResult.data?.map(i => <option key={i.id} value={i.id}>{i.code} · {i.name}</option>)}</select></label>
        <label className="registry-wide">Observações<textarea name="notes" rows={2}/></label>
        <button type="submit">Criar tabela</button>
      </form>
    </details> : null}

    <section className="registry-table-panel">
      <div className="section-heading"><div><span>Histórico</span><h2>Tabelas do empreendimento</h2></div></div>
      <div className="registry-table-wrap"><table><thead><tr><th>Tabela</th><th>Vigência</th><th>Índice</th><th>Status</th><th></th></tr></thead><tbody>
        {tables.map(t => { const idx=one(t.correction_indices); return <tr key={t.id}><td><strong>{t.name}</strong><br/><small>v{t.version_no}</small></td><td>{t.valid_from}{t.valid_until ? ` → ${t.valid_until}` : ""}</td><td>{idx?.code ?? "—"}</td><td>{t.status}</td><td><Link prefetch={false} href={`?project=${selectedProject}&table=${t.id}`}>Abrir</Link></td></tr>; })}
      </tbody></table></div>
    </section>

    {selectedTable ? <>
      <section className="sale-detail-hero"><div><span>Tabela selecionada</span><h2>{selectedTable.name} · v{selectedTable.version_no}</h2><p>{selectedTable.status === "active" ? "Esta tabela alimenta o preço de lista atual das unidades." : "Rascunho/histórico. Ative somente após revisar os valores."}</p></div><div className="sale-detail-values"><div><span>Unidades precificadas</span><strong>{items.length}</strong></div></div></section>
      {canManage && selectedTable.status !== "active" ? <form action={activatePriceTable}><input type="hidden" name="price_table_id" value={selectedTable.id}/><button className="auth-primary" type="submit">Ativar tabela e atualizar preços das unidades</button></form> : null}
      {canManage ? <details className="registry-create"><summary>+ Incluir / atualizar preço de unidade</summary><form action={savePriceItem} className="registry-form-grid">
        <input type="hidden" name="price_table_id" value={selectedTable.id}/>
        <label>Unidade<select name="unit_id" required defaultValue=""><option value="" disabled>Selecione</option>{units.map(u => <option key={u.id} value={u.id}>{u.code}{u.type ? ` · ${u.type}` : ""}{u.list_price ? ` · atual ${money(u.list_price)}` : ""}</option>)}</select></label>
        <label>Preço de tabela<input name="list_price" inputMode="decimal" required/></label>
        <label>Preço à vista<input name="cash_price" inputMode="decimal"/></label>
        <label>Preço mínimo autorizado<input name="minimum_price" inputMode="decimal"/></label>
        <label className="registry-wide">Observações<input name="notes"/></label>
        <button type="submit">Salvar preço</button>
      </form></details> : null}
      <section className="registry-table-panel"><div className="section-heading"><div><span>Unidades</span><h2>Preços cadastrados</h2></div></div><div className="registry-table-wrap"><table><thead><tr><th>Unidade</th><th>Tabela</th><th>À vista</th><th>Mínimo</th></tr></thead><tbody>{items.map(i => <tr key={i.id}><td>{one(i.units)?.code ?? "—"}</td><td>{money(i.list_price)}</td><td>{i.cash_price ? money(i.cash_price) : "—"}</td><td>{i.minimum_price ? money(i.minimum_price) : "—"}</td></tr>)}</tbody></table></div></section>
    </> : <p>Crie uma tabela para começar o histórico de preços.</p>}
  </AppShell>;
}
