import { requireCompanyPermission } from "@/lib/workspace";
import { importSefazDocument, saveSefazConnection, syncSefazDocuments } from "./sefaz-actions";

type Connection = {
  id: string;
  environment: "production" | "homologation";
  certificate_file_name: string;
  last_nsu: string;
  max_nsu: string;
  last_sync_at: string | null;
  last_status_code: string | null;
  last_status_message: string | null;
  status: string;
};
type SefazDocument = {
  id: string;
  nsu: string;
  schema_name: string;
  access_key: string | null;
  issuer_tax_id: string | null;
  issuer_name: string | null;
  issue_datetime: string | null;
  total_amount: number | null;
  document_kind: string;
  processing_status: string;
  xml_storage_path: string | null;
  imported_invoice_id: string | null;
  first_seen_at: string;
};

function dateTime(value: string | null) {
  if (!value) return "Nunca";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(value));
}
function money(value: number | null) {
  return value == null ? "—" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}
function taxId(value: string | null) {
  const raw = String(value ?? "").replace(/\D/g, "");
  return raw.length === 14 ? raw.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5") : value || "—";
}

export async function SefazImporter({ legalEntityId, legalEntityName, legalEntityCnpj, legalEntityState, canManage }: {
  legalEntityId: string | null;
  legalEntityName: string | null;
  legalEntityCnpj: string | null;
  legalEntityState: string | null;
  canManage: boolean;
}) {
  const { supabase, companyId } = await requireCompanyPermission("finance.invoices.view");
  if (!legalEntityId) return <section className="sefaz-importer sefaz-missing"><strong>Importação pela SEFAZ indisponível</strong><p>Vincule uma SPE ao empreendimento para consultar os documentos destinados ao CNPJ correto.</p></section>;

  const [connectionsResult, documentsResult, logsResult] = await Promise.all([
    supabase.from("finance_sefaz_connections").select("id,environment,certificate_file_name,last_nsu,max_nsu,last_sync_at,last_status_code,last_status_message,status").eq("company_id", companyId).eq("legal_entity_id", legalEntityId).order("environment"),
    supabase.from("finance_sefaz_documents").select("id,nsu,schema_name,access_key,issuer_tax_id,issuer_name,issue_datetime,total_amount,document_kind,processing_status,xml_storage_path,imported_invoice_id,first_seen_at").eq("company_id", companyId).eq("legal_entity_id", legalEntityId).order("first_seen_at", { ascending: false }).limit(80),
    supabase.from("finance_sefaz_sync_logs").select("id,started_at,status,documents_received,full_xml_received,error_message").eq("company_id", companyId).eq("legal_entity_id", legalEntityId).order("started_at", { ascending: false }).limit(5),
  ]);
  const schemaMissing = connectionsResult.error?.code === "42P01" || connectionsResult.error?.message.includes("finance_sefaz_connections");
  if (schemaMissing) return <section className="sefaz-importer sefaz-missing"><strong>Estrutura SEFAZ pendente</strong><p>Execute a migration <code>0058</code> para habilitar certificado, NSU e documentos distribuídos.</p></section>;
  const connections = (connectionsResult.data ?? []) as Connection[];
  const documents = (documentsResult.data ?? []) as SefazDocument[];
  const production = connections.find((item) => item.environment === "production") ?? null;
  const homologation = connections.find((item) => item.environment === "homologation") ?? null;
  const fullXml = documents.filter((item) => item.document_kind === "full_xml");
  const available = fullXml.filter((item) => item.processing_status !== "imported");
  const summaries = documents.filter((item) => item.document_kind === "summary");
  const nearDeadline = documents.filter((item) => item.issue_datetime && Date.now() - new Date(item.issue_datetime).getTime() >= 75 * 86400000 && Date.now() - new Date(item.issue_datetime).getTime() <= 90 * 86400000).length;

  return <section className="sefaz-importer">
    <header className="sefaz-head">
      <div><span>Importador oficial</span><h2>NF-e destinadas à SPE · SEFAZ</h2><p>{legalEntityName} · {taxId(legalEntityCnpj)} · {legalEntityState || "UF não informada"}</p></div>
      {canManage ? <div className="sefaz-head-actions">
        {production ? <form action={syncSefazDocuments}><input type="hidden" name="environment" value="production" /><button type="submit" className="elos-button primary">Sincronizar produção</button></form> : null}
        <details className="sefaz-config"><summary>{production ? "Trocar certificado" : "Configurar certificado A1"}</summary><form action={saveSefazConnection}><label>Ambiente<select name="environment" defaultValue="production"><option value="production">Produção</option><option value="homologation">Homologação</option></select></label><label>UF da SPE<input name="state" defaultValue={legalEntityState ?? ""} maxLength={2} required /></label><label>Certificado A1<input type="file" name="certificate" accept=".pfx,.p12,application/x-pkcs12" required /></label><label>Senha do certificado<input type="password" name="password" autoComplete="new-password" required /></label><button type="submit" className="elos-button primary">Salvar conexão</button><small>A senha é criptografada. Configure <code>SEFAZ_CERTIFICATE_SECRET</code> na Vercel antes do primeiro cadastro.</small></form></details>
      </div> : null}
    </header>

    <div className="sefaz-kpis">
      <article><span>XMLs completos</span><strong>{fullXml.length}</strong><small>{available.length} aguardando importação</small></article>
      <article><span>Resumos recebidos</span><strong>{summaries.length}</strong><small>podem depender de liberação posterior do XML</small></article>
      <article><span>Prazo de manifestação</span><strong>{nearDeadline}</strong><small>documentos entre 75 e 90 dias</small></article>
      <article><span>Último NSU</span><strong>{production?.last_nsu || "—"}</strong><small>máximo {production?.max_nsu || "—"}</small></article>
      <article className={production?.status === "error" ? "warning" : ""}><span>Última sincronização</span><strong>{dateTime(production?.last_sync_at ?? null)}</strong><small>{production?.last_status_message || "Conexão ainda não executada"}</small></article>
    </div>

    {!production && !homologation ? <div className="sefaz-empty"><strong>Conecte o certificado A1 da SPE</strong><p>Depois da configuração, o Elos OS consultará o ambiente nacional da NF-e a partir do último NSU conhecido.</p></div> : null}

    {documents.length ? <div className="sefaz-table-wrap"><table className="sefaz-table"><thead><tr><th>Documento</th><th>Emitente</th><th>Emissão</th><th>Valor</th><th>Origem</th><th>Status</th><th>Ação</th></tr></thead><tbody>{documents.map((document) => <tr key={document.id}><td><strong>{document.access_key ? `NF-e ${document.access_key.slice(25, 34)}` : `NSU ${document.nsu}`}</strong><small>{document.access_key || document.schema_name}</small></td><td><strong>{document.issuer_name || "Emitente não informado"}</strong><small>{taxId(document.issuer_tax_id)}</small></td><td>{dateTime(document.issue_datetime)}</td><td>{money(document.total_amount)}</td><td><span className={`sefaz-kind ${document.document_kind}`}>{document.document_kind === "full_xml" ? "XML completo" : document.document_kind === "event" ? "Evento" : "Resumo"}</span></td><td>{document.processing_status === "imported" ? "Importada" : document.xml_storage_path ? "Disponível" : "Aguardando XML"}</td><td>{canManage && document.xml_storage_path && document.processing_status !== "imported" ? <form action={importSefazDocument}><input type="hidden" name="document_id" value={document.id} /><button type="submit" className="table-action">Importar no Elos</button></form> : document.imported_invoice_id ? <a className="table-action" href={`?invoice=${document.imported_invoice_id}`}>Abrir NF-e</a> : "—"}</td></tr>)}</tbody></table></div> : null}

    {(logsResult.data ?? []).length ? <details className="sefaz-logs"><summary>Histórico das últimas sincronizações</summary><div>{(logsResult.data ?? []).map((log) => <p key={log.id}><strong>{dateTime(log.started_at)}</strong><span>{log.status === "success" ? `${log.documents_received} documento(s), ${log.full_xml_received} XML(s)` : log.error_message || log.status}</span></p>)}</div></details> : null}
  </section>;
}
