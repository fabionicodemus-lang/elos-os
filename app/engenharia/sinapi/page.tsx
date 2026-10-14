import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { requireCompanyPermission } from "@/lib/workspace";
import { adoptSinapiComposition, adoptSinapiInput, importSinapiWorkbook } from "./actions";
import "../../preconstruction-95.css";

type Catalog = { id: string; source: string; competence: string; state_code: string; burden_type: string; prices_status: string; source_file: string | null; imported_at: string; notes: string | null };
type InputRow = { id: string; source_code: string; description: string; unit: string; category: string | null; unit_price: number; has_price: boolean };
type CompositionRow = { id: string; source_code: string; description: string; unit: string; total_cost: number; has_cost: boolean };

function money(value: number | null | undefined) { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(Number(value ?? 0)); }
function dateTimeBR(value: string | null | undefined) { if (!value) return "—"; const date = new Date(value); return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("pt-BR"); }
const statusLabel: Record<string, string> = { available: "Preços disponíveis", partial: "Preços parciais", zeroed: "Estrutura sem preços", unknown: "Preços não verificados" };
const burdenLabel: Record<string, string> = { DESONERADO: "Desonerado", NAO_DESONERADO: "Não desonerado", NAO_INFORMADO: "Não informado" };

export default async function SinapiPage({ searchParams }: { searchParams: Promise<{ catalog?: string; tab?: string; q?: string; success?: string; error?: string }> }) {
  const params = await searchParams;
  const { supabase, company, companyId, roleKey } = await requireCompanyPermission("inputs.view");
  const [catalogsResult, inputsManage, servicesManage] = await Promise.all([
    supabase.from("engineering_reference_catalogs").select("id, source, competence, state_code, burden_type, prices_status, source_file, imported_at, notes").eq("company_id", companyId).eq("source", "SINAPI").order("competence", { ascending: false }).order("state_code").limit(200),
    roleKey === "owner" || roleKey === "admin" ? Promise.resolve({ data: true, error: null }) : supabase.rpc("has_company_permission", { target_company_id: companyId, target_permission: "inputs.manage" }),
    roleKey === "owner" || roleKey === "admin" ? Promise.resolve({ data: true, error: null }) : supabase.rpc("has_company_permission", { target_company_id: companyId, target_permission: "services.manage" }),
  ]);
  const catalogs = (catalogsResult.data ?? []) as Catalog[];
  const catalog = catalogs.find((item) => item.id === params.catalog) ?? catalogs[0] ?? null;
  const tab = params.tab === "compositions" ? "compositions" : "inputs";
  const query = (params.q ?? "").trim().toLocaleLowerCase("pt-BR");
  const [inputsResult, compositionsResult] = catalog ? await Promise.all([
    supabase.from("engineering_reference_inputs").select("id, source_code, description, unit, category, unit_price, has_price").eq("company_id", companyId).eq("catalog_id", catalog.id).order("source_code").limit(5000),
    supabase.from("engineering_reference_compositions").select("id, source_code, description, unit, total_cost, has_cost").eq("company_id", companyId).eq("catalog_id", catalog.id).order("source_code").limit(5000),
  ]) : [{ data: [], error: null }, { data: [], error: null }];
  const inputs = ((inputsResult.data ?? []) as InputRow[]).filter((item) => !query || `${item.source_code} ${item.description} ${item.category ?? ""}`.toLocaleLowerCase("pt-BR").includes(query));
  const compositions = ((compositionsResult.data ?? []) as CompositionRow[]).filter((item) => !query || `${item.source_code} ${item.description}`.toLocaleLowerCase("pt-BR").includes(query));
  const canImport = inputsManage.data === true || roleKey === "owner" || roleKey === "admin";
  const canCopyComposition = servicesManage.data === true || roleKey === "owner" || roleKey === "admin";
  const pricedInputs = inputs.filter((item) => item.has_price).length;
  const pricedCompositions = compositions.filter((item) => item.has_cost).length;

  return (
    <AppShell activeGroup="engineering" activeItem="sinapi" eyebrow="Engenharia · Orçamento" title="Referências SINAPI"
      description={`${company.name} · biblioteca versionada por competência e UF, separada dos preços próprios da construtora.`}
      actions={<><Link prefetch={false} className="elos-button" href="/engenharia/preobra">Painel Pré-Obra</Link><Link prefetch={false} className="elos-button" href="/engenharia/insumos">Base própria</Link></>}>
      {params.success ? <div className="auth-message success workspace-message">{params.success}</div> : null}
      {params.error ? <div className="auth-message error workspace-message">{params.error}</div> : null}
      {(catalogsResult.error || inputsResult.error || compositionsResult.error) ? <div className="auth-message error workspace-message">A biblioteca SINAPI exige a migration do pacote Pré-Obra 9.5.</div> : null}

      {canImport ? <section className="pre95-card">
        <div className="pre95-heading"><div><span>Importação oficial</span><h2>Adicionar uma competência SINAPI</h2></div><p>O Elos preserva cada competência separadamente. Se a planilha vier com valores zerados, a estrutura é importada mas não vira preço adotado.</p></div>
        <form action={importSinapiWorkbook} className="pre95-form-grid" encType="multipart/form-data">
          <label><span>Competência</span><input name="competence" type="month" required /></label>
          <label><span>UF</span><input name="state_code" maxLength={2} placeholder="SC" defaultValue="SC" required /></label>
          <label><span>Regime</span><select name="burden_type" defaultValue="NAO_INFORMADO"><option value="NAO_INFORMADO">Não informado</option><option value="NAO_DESONERADO">Não desonerado</option><option value="DESONERADO">Desonerado</option></select></label>
          <label className="pre95-wide"><span>Planilha XLSX</span><input name="file" type="file" accept=".xlsx" required /></label>
          <button type="submit">Importar referência</button>
        </form>
      </section> : null}

      {catalog ? <>
        <section className="pre95-selector"><div><span>Competência ativa</span><strong>{catalog.state_code} · {catalog.competence} · {burdenLabel[catalog.burden_type] ?? catalog.burden_type}</strong><small>{statusLabel[catalog.prices_status] ?? catalog.prices_status} · importado em {dateTimeBR(catalog.imported_at)}{catalog.source_file ? ` · ${catalog.source_file}` : ""}</small></div>{catalogs.length > 1 ? <form method="get"><select name="catalog" defaultValue={catalog.id}>{catalogs.map((item) => <option key={item.id} value={item.id}>{item.state_code} · {item.competence} · {burdenLabel[item.burden_type] ?? item.burden_type}</option>)}</select><input type="hidden" name="tab" value={tab} /><button type="submit">Abrir</button></form> : null}</section>
        {catalog.prices_status === "zeroed" ? <div className="auth-message warning workspace-message">Esta competência foi importada com valores zerados. A estrutura técnica continua disponível, mas copiar um item não cria preço adotado até existir valor válido.</div> : null}

        <section className="pre95-summary">
          <article><span>Insumos</span><strong>{(inputsResult.data ?? []).length}</strong><small>{pricedInputs} com preço na listagem filtrada</small></article>
          <article><span>Composições</span><strong>{(compositionsResult.data ?? []).length}</strong><small>{pricedCompositions} com custo na listagem filtrada</small></article>
          <article><span>Competências salvas</span><strong>{catalogs.length}</strong><small>histórico preservado</small></article>
          <article><span>Status dos preços</span><strong>{statusLabel[catalog.prices_status] ?? catalog.prices_status}</strong><small>não substitui cotações próprias</small></article>
        </section>

        <nav className="pre95-tabs"><Link prefetch={false} className={tab === "inputs" ? "active" : ""} href={`?catalog=${catalog.id}&tab=inputs`}>Insumos</Link><Link prefetch={false} className={tab === "compositions" ? "active" : ""} href={`?catalog=${catalog.id}&tab=compositions`}>Composições</Link></nav>
        <section className="pre95-toolbar"><form method="get"><input type="hidden" name="catalog" value={catalog.id} /><input type="hidden" name="tab" value={tab} /><input name="q" defaultValue={params.q ?? ""} placeholder="Código ou descrição" /><button type="submit">Buscar</button><Link prefetch={false} href={`?catalog=${catalog.id}&tab=${tab}`}>Limpar</Link></form></section>

        <section className="pre95-card">
          <div className="pre95-heading"><div><span>SINAPI {catalog.competence}</span><h2>{tab === "inputs" ? "Insumos de referência" : "Composições de referência"}</h2></div><p>Copiar cria um registro na base própria da empresa; a referência original permanece intacta.</p></div>
          <div className="registry-table-wrap"><table className="registry-table"><thead><tr><th>Código</th><th>Descrição</th><th>Un.</th>{tab === "inputs" ? <><th>Categoria</th><th>Preço</th></> : <th>Custo</th>}<th>Situação</th><th>Ação</th></tr></thead><tbody>
            {tab === "inputs" ? inputs.slice(0, 1000).map((row) => <tr key={row.id}><td><strong>{row.source_code}</strong></td><td>{row.description}</td><td>{row.unit}</td><td>{row.category ?? "—"}</td><td><strong>{row.has_price ? money(row.unit_price) : "—"}</strong></td><td><span className={`sinapi-price ${row.has_price ? "ok" : "missing"}`}>{row.has_price ? "COM PREÇO" : "SEM PREÇO"}</span></td><td>{canImport ? <form action={adoptSinapiInput}><input type="hidden" name="catalog_id" value={catalog.id} /><input type="hidden" name="reference_id" value={row.id} /><button type="submit">Copiar para minha base</button></form> : "—"}</td></tr>) : compositions.slice(0, 1000).map((row) => <tr key={row.id}><td><strong>{row.source_code}</strong></td><td>{row.description}</td><td>{row.unit}</td><td><strong>{row.has_cost ? money(row.total_cost) : "—"}</strong></td><td><span className={`sinapi-price ${row.has_cost ? "ok" : "missing"}`}>{row.has_cost ? "COM CUSTO" : "SEM CUSTO"}</span></td><td>{canCopyComposition ? <form action={adoptSinapiComposition}><input type="hidden" name="catalog_id" value={catalog.id} /><input type="hidden" name="reference_id" value={row.id} /><button type="submit">Copiar composição</button></form> : "—"}</td></tr>)}
            {tab === "inputs" && !inputs.length ? <tr><td colSpan={7}>Nenhum insumo encontrado.</td></tr> : null}
            {tab === "compositions" && !compositions.length ? <tr><td colSpan={6}>Nenhuma composição encontrada.</td></tr> : null}
          </tbody></table></div>
          {(tab === "inputs" ? inputs.length : compositions.length) > 1000 ? <p className="pre95-footnote">Exibindo os primeiros 1.000 resultados. Use a busca para refinar.</p> : null}
        </section>
      </> : <div className="pre95-empty">Nenhuma competência SINAPI importada ainda.</div>}
    </AppShell>
  );
}