import {FINANCE_TITLE_COLUMNS,openTitleAmount,type FinancialTitleFields} from "@/lib/finance-core/titles.mjs";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { requireCompanyPermission } from "@/lib/workspace";
import {
  changeAmendmentStatus, changeConsiderationStatus, executeTermination, prepareTermination,
  saveAmendment, saveCollectionCase, saveConsideration, saveContractDocument, saveSaleParty, saveTransferProcess,
} from "../actions";

function one<T>(value:T|T[]|null):T|null { return Array.isArray(value) ? value[0] ?? null : value; }
function money(value:number|null|undefined){ return new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(Number(value??0)); }
function dateBR(value:string|null|undefined){ if(!value)return "—"; const [y,m,d]=value.slice(0,10).split("-"); return `${d}/${m}/${y}`; }

type Sale = { id:string;project_id:string;client_id:string;unit_id:string;number:string;contract_number:string|null;sale_date:string;total_amount:number;status:string;broker_name:string|null;clients:{id:string;name:string;tax_id:string|null}|{id:string;name:string;tax_id:string|null}[]|null;units:{id:string;code:string;status:string}|{id:string;code:string;status:string}[]|null;projects:{id:string;name:string;code:string|null}|{id:string;name:string;code:string|null}[]|null };
type Party={id:string;client_id:string;role:string;ownership_percent:number|null;is_primary:boolean;status:string;joined_at:string|null;notes:string|null;clients:{name:string;tax_id:string|null}|{name:string;tax_id:string|null}[]|null};
type Contract={id:string;kind:string;document_number:string|null;signed_at:string|null;effective_date:string|null;status:string;document_url:string|null;notes:string|null;created_at:string};
type Consideration={id:string;kind:string;description:string;asset_identifier:string|null;appraised_value:number|null;accepted_value:number;due_date:string|null;received_at:string|null;status:string;notes:string|null};
type Amendment={id:string;kind:string;effective_date:string;reason:string;financial_impact:number;status:string;notes:string|null;created_at:string};
type Transfer={id:string;bank_name:string|null;financing_type:string;requested_amount:number|null;approved_amount:number|null;released_amount:number|null;expected_release_date:string|null;released_at:string|null;protocol:string|null;status:string;notes:string|null};
type Receivable=FinancialTitleFields & {id:string;description:string;due_date:string;amount:number;adjusted_amount:number;paid_amount:number|null;status:string};
type Collection={id:string;receivable_id:string|null;stage:string;status:string;opened_at:string;last_contact_at:string|null;promised_date:string|null;promised_amount:number|null;notes:string|null};
type Termination={id:string;reason:string;paid_amount_snapshot:number;retention_percent:number;retention_amount:number;refund_amount:number;refund_due_date:string|null;refund_payable_id:string|null;commission_review_required:boolean;status:string;created_at:string};
type Commission={id:string;role:string;commission_amount:number;due_date:string;status:string;paid_amount:number|null};
type Summary={base_amount:number;updated_amount:number;correction_amount:number;total_count:number;open_count:number;paid_count:number;overdue_count:number;open_amount:number;paid_amount:number};

const roleLabel:Record<string,string>={buyer:"Comprador",co_buyer:"Cocomprador",spouse:"Cônjuge",guarantor:"Fiador",assignee:"Cessionário",representative:"Representante",other:"Outro"};
const kindLabel:Record<string,string>={purchase_agreement:"Contrato",addendum:"Aditivo",assignment:"Cessão",renegotiation:"Renegociação",confession:"Confissão de dívida",termination:"Distrato",other:"Outro"};
const transferLabel:Record<string,string>={not_started:"Não iniciado",documents_pending:"Documentos pendentes",submitted:"Enviado ao banco",approved:"Aprovado",contracting:"Em contratação",released:"Liberado",failed:"Com pendência",cancelled:"Cancelado"};

export default async function IncorporationSalePage({params,searchParams}:{params:Promise<{saleId:string}>;searchParams:Promise<{error?:string;success?:string}>}){
  const {saleId}=await params; const messages=await searchParams;
  const {supabase,company,companyId,roleKey}=await requireCompanyPermission("commercial.incorporation.view");
  const saleResult=await supabase.from("sales").select("id,project_id,client_id,unit_id,number,contract_number,sale_date,total_amount,status,broker_name,clients(id,name,tax_id),units(id,code,status),projects(id,name,code)").eq("id",saleId).eq("company_id",companyId).maybeSingle();
  if(!saleResult.data) notFound();
  const sale=saleResult.data as unknown as Sale; const client=one(sale.clients); const unit=one(sale.units); const project=one(sale.projects);
  const [clientsR,partiesR,contractsR,considerationsR,amendmentsR,transferR,receivablesR,collectionsR,terminationR,commissionsR,summaryR,permissionsR]=await Promise.all([
    supabase.from("clients").select("id,name,tax_id,status").eq("company_id",companyId).order("name").limit(1500),
    supabase.from("commercial_sale_parties").select("id,client_id,role,ownership_percent,is_primary,status,joined_at,notes,clients(name,tax_id)").eq("company_id",companyId).eq("sale_id",saleId).order("is_primary",{ascending:false}).order("created_at"),
    supabase.from("commercial_sale_contracts").select("id,kind,document_number,signed_at,effective_date,status,document_url,notes,created_at").eq("company_id",companyId).eq("sale_id",saleId).order("effective_date",{ascending:false}).order("created_at",{ascending:false}),
    supabase.from("commercial_sale_considerations").select("id,kind,description,asset_identifier,appraised_value,accepted_value,due_date,received_at,status,notes").eq("company_id",companyId).eq("sale_id",saleId).order("created_at"),
    supabase.from("commercial_sale_amendments").select("id,kind,effective_date,reason,financial_impact,status,notes,created_at").eq("company_id",companyId).eq("sale_id",saleId).order("effective_date",{ascending:false}),
    supabase.from("commercial_transfer_processes").select("id,bank_name,financing_type,requested_amount,approved_amount,released_amount,expected_release_date,released_at,protocol,status,notes").eq("company_id",companyId).eq("sale_id",saleId).maybeSingle(),
    supabase.from("receivables").select(`id,description,due_date,amount,adjusted_amount,paid_amount,status,${FINANCE_TITLE_COLUMNS}`).eq("company_id",companyId).eq("sale_id",saleId).order("due_date"),
    supabase.from("commercial_collection_cases").select("id,receivable_id,stage,status,opened_at,last_contact_at,promised_date,promised_amount,notes").eq("company_id",companyId).eq("sale_id",saleId).order("opened_at",{ascending:false}),
    supabase.from("commercial_sale_terminations").select("id,reason,paid_amount_snapshot,retention_percent,retention_amount,refund_amount,refund_due_date,refund_payable_id,commission_review_required,status,created_at").eq("company_id",companyId).eq("sale_id",saleId).maybeSingle(),
    supabase.from("commercial_sale_commissions").select("id,role,commission_amount,due_date,status,paid_amount").eq("company_id",companyId).eq("sale_id",saleId).order("due_date"),
    supabase.rpc("receivables_summary",{p_company_id:companyId,p_project_id:sale.project_id,p_sale_id:saleId}),
    Promise.all(["commercial.incorporation.manage","commercial.incorporation.approve","commercial.incorporation.finance"].map(target_permission=>supabase.rpc("has_company_permission",{target_company_id:companyId,target_permission}))),
  ]);
  const privileged=roleKey==="owner"||roleKey==="admin";
  const canManage=permissionsR[0].data===true||privileged, canApprove=permissionsR[1].data===true||privileged, canFinance=permissionsR[2].data===true||privileged;
  const parties=(partiesR.data??[]) as unknown as Party[], contracts=(contractsR.data??[]) as Contract[], considerations=(considerationsR.data??[]) as Consideration[], amendments=(amendmentsR.data??[]) as Amendment[];
  const transfer=transferR.data as Transfer|null, receivables=(receivablesR.data??[]) as unknown as Receivable[], collections=(collectionsR.data??[]) as Collection[], termination=terminationR.data as Termination|null, commissions=(commissionsR.data??[]) as Commission[];
  const summary=(summaryR.data??{base_amount:sale.total_amount,updated_amount:sale.total_amount,correction_amount:0,total_count:0,open_count:0,paid_count:0,overdue_count:0,open_amount:0,paid_amount:0}) as Summary;
  const barter=considerations.filter(i=>i.status!=="cancelled").reduce((s,i)=>s+Number(i.accepted_value),0);
  const overdue=receivables.filter(r=>r.status==="open"&&r.due_date<new Date().toISOString().slice(0,10));
  const migrationError=[partiesR,contractsR,considerationsR,amendmentsR,transferR,collectionsR,terminationR].some(r=>r.error);

  return <AppShell activeGroup="commercial" activeItem="incorporation" eyebrow="Comercial · Dossiê da unidade" title={`${unit?.code??"Unidade"} · ${client?.name??sale.number}`}
    description={`${company.name}${project?` · ${project.code?`${project.code} · `:""}${project.name}`:""} · venda ${sale.number}`}
    actions={<><Link className="elos-button" prefetch={false} href="/comercial/incorporacao">Voltar à carteira</Link><Link className="elos-button" prefetch={false} href={`/comercial/vendas/${saleId}`}>Venda / plano</Link></>}>
    {messages.error?<div className="auth-message error workspace-message">{messages.error}</div>:null}{messages.success?<div className="auth-message success workspace-message">{messages.success}</div>:null}
    {migrationError?<div className="auth-message error workspace-message">A migration do ERP de incorporação precisa estar aplicada para carregar o dossiê.</div>:null}

    <section className="sale-detail-hero"><div><span>Contrato e unidade</span><h2>{sale.contract_number||"Contrato sem número"}</h2><p>Venda em {dateBR(sale.sale_date)} · {sale.status==="active"?"ativa":"cancelada"} · corretor {sale.broker_name||"não informado"}</p></div><div className="sale-detail-values"><div><span>Valor da venda</span><strong>{money(sale.total_amount)}</strong></div><div><span>Recebido</span><strong>{money(summary.paid_amount)}</strong></div><div><span>Em aberto</span><strong>{money(summary.open_amount)}</strong></div><div><span>Permutas</span><strong>{money(barter)}</strong></div></div></section>

    <section className="finance-summary-grid">
      <article><span>Parcelas abertas</span><strong>{summary.open_count}</strong><small>{summary.overdue_count} vencida(s)</small></article>
      <article><span>Correção contratual</span><strong>{money(summary.correction_amount)}</strong><small>valor atualizado {money(summary.updated_amount)}</small></article>
      <article><span>Repasse</span><strong>{transferLabel[transfer?.status??"not_started"]}</strong><small>{transfer?.bank_name||"sem banco definido"}</small></article>
      <article><span>Comissões</span><strong>{money(commissions.reduce((s,c)=>s+Number(c.commission_amount),0))}</strong><small>{commissions.filter(c=>c.status==="paid").length} paga(s)</small></article>
    </section>

    <section className="sale-detail-columns">
      <details className="registry-create" open><summary>Compradores e participantes ({parties.length})</summary>
        {parties.map(p=>{const c=one(p.clients);return <p key={p.id}><strong>{c?.name??"Cliente"}</strong> · {roleLabel[p.role]??p.role}{p.is_primary?" · principal":""}{p.ownership_percent!=null?` · ${p.ownership_percent}%`:""}{p.status!=="active"?" · inativo":""}</p>})}
        {canManage?<form action={saveSaleParty} className="registry-form-grid"><input type="hidden" name="sale_id" value={saleId}/><label>Cliente<select name="client_id" required defaultValue=""><option value="" disabled>Selecione</option>{clientsR.data?.map(c=><option key={c.id} value={c.id}>{c.name}{c.status==="inactive"?" · inativo":""}</option>)}</select></label><label>Papel<select name="role" defaultValue="co_buyer"><option value="buyer">Comprador</option><option value="co_buyer">Cocomprador</option><option value="spouse">Cônjuge</option><option value="guarantor">Fiador</option><option value="assignee">Cessionário</option><option value="representative">Representante</option><option value="other">Outro</option></select></label><label>Participação (%)<input name="ownership_percent" inputMode="decimal"/></label><label>Data de entrada<input name="joined_at" type="date"/></label><label>Principal<select name="is_primary" defaultValue="0"><option value="0">Não</option><option value="1">Sim</option></select></label><label className="registry-wide">Observações<input name="notes"/></label><button type="submit">Salvar participante</button></form>:null}
      </details>

      <details className="registry-create" open><summary>Documentos contratuais ({contracts.length})</summary>
        {contracts.map(c=><p key={c.id}><strong>{kindLabel[c.kind]??c.kind}</strong> · {c.document_number||"sem número"} · {c.status} · {dateBR(c.effective_date||c.signed_at)} {c.document_url?<a href={c.document_url} target="_blank" rel="noreferrer">Abrir documento</a>:null}</p>)}
        {canManage?<form action={saveContractDocument} className="registry-form-grid"><input type="hidden" name="sale_id" value={saleId}/><label>Tipo<select name="kind"><option value="purchase_agreement">Contrato</option><option value="addendum">Aditivo</option><option value="assignment">Cessão</option><option value="renegotiation">Renegociação</option><option value="confession">Confissão de dívida</option><option value="termination">Distrato</option><option value="other">Outro</option></select></label><label>Número<input name="document_number"/></label><label>Assinatura<input name="signed_at" type="date"/></label><label>Vigência<input name="effective_date" type="date"/></label><label>Status<select name="status"><option value="draft">Rascunho</option><option value="signed">Assinado</option><option value="cancelled">Cancelado</option></select></label><label>Link do documento<input name="document_url" type="url"/></label><label className="registry-wide">Observações<textarea name="notes" rows={2}/></label><button type="submit">Registrar documento</button></form>:null}
      </details>
    </section>

    <section className="sale-detail-columns">
      <details className="registry-create" open={considerations.length>0}><summary>Permutas e dações ({money(barter)})</summary>
        {considerations.map(i=><div key={i.id}><p><strong>{i.description}</strong> · {money(i.accepted_value)} · {i.status}{i.asset_identifier?` · ${i.asset_identifier}`:""}</p>{canManage&&i.status!=="cancelled"?<form action={changeConsiderationStatus}><input type="hidden" name="sale_id" value={saleId}/><input type="hidden" name="consideration_id" value={i.id}/><select name="status" defaultValue={i.status}><option value="planned">Prevista</option><option value="received">Recebida</option><option value="transferred">Transferida</option><option value="cancelled">Cancelada</option></select><button type="submit">Atualizar</button></form>:null}</div>)}
        {canManage?<form action={saveConsideration} className="registry-form-grid"><input type="hidden" name="sale_id" value={saleId}/><label>Tipo<select name="kind"><option value="real_estate">Imóvel</option><option value="land">Terreno</option><option value="vehicle">Veículo</option><option value="service">Serviço</option><option value="credit">Crédito</option><option value="other">Outro</option></select></label><label>Descrição<input name="description" required/></label><label>Matrícula / identificação<input name="asset_identifier"/></label><label>Valor de avaliação<input name="appraised_value" inputMode="decimal"/></label><label>Valor aceito na venda<input name="accepted_value" inputMode="decimal" required/></label><label>Data prevista<input name="due_date" type="date"/></label><label className="registry-wide">Observações<input name="notes"/></label><button type="submit">Adicionar permuta</button></form>:null}
      </details>

      <details className="registry-create" open><summary>Aditivos e renegociações ({amendments.length})</summary>
        {amendments.map(a=><div key={a.id}><p><strong>{a.kind}</strong> · {dateBR(a.effective_date)} · {a.status} · impacto {money(a.financial_impact)}<br/><small>{a.reason}</small></p>{canApprove&&a.status==="draft"?<form action={changeAmendmentStatus}><input type="hidden" name="sale_id" value={saleId}/><input type="hidden" name="amendment_id" value={a.id}/><select name="status"><option value="approved">Aprovar</option><option value="executed">Aprovar e marcar executado</option><option value="cancelled">Cancelar</option></select><button type="submit">Confirmar</button></form>:null}</div>)}
        {canManage?<form action={saveAmendment} className="registry-form-grid"><input type="hidden" name="sale_id" value={saleId}/><label>Tipo<select name="kind"><option value="payment_plan">Plano de pagamento</option><option value="price">Preço</option><option value="index">Índice</option><option value="party">Compradores</option><option value="assignment">Cessão</option><option value="deadline">Prazo</option><option value="other">Outro</option></select></label><label>Vigência<input name="effective_date" type="date" required/></label><label>Impacto financeiro<input name="financial_impact" inputMode="decimal" defaultValue="0"/></label><label className="registry-wide">Motivo<input name="reason" minLength={5} required/></label><label className="registry-wide">Observações<input name="notes"/></label><button type="submit">Preparar aditivo</button></form>:null}
      </details>
    </section>

    <section className="sale-detail-columns">
      <details className="registry-create" open><summary>Repasse / financiamento</summary>
        <p><strong>{transferLabel[transfer?.status??"not_started"]}</strong> · {transfer?.bank_name||"Banco ainda não definido"}{transfer?.approved_amount?` · aprovado ${money(transfer.approved_amount)}`:""}{transfer?.released_amount?` · liberado ${money(transfer.released_amount)}`:""}</p>
        {canFinance?<form action={saveTransferProcess} className="registry-form-grid"><input type="hidden" name="sale_id" value={saleId}/><label>Banco<input name="bank_name" defaultValue={transfer?.bank_name??""}/></label><label>Modalidade<select name="financing_type" defaultValue={transfer?.financing_type??"bank_financing"}><option value="bank_financing">Financiamento bancário</option><option value="consortium">Consórcio</option><option value="own_funds">Recursos próprios</option><option value="other">Outro</option></select></label><label>Valor solicitado<input name="requested_amount" inputMode="decimal" defaultValue={transfer?.requested_amount??""}/></label><label>Valor aprovado<input name="approved_amount" inputMode="decimal" defaultValue={transfer?.approved_amount??""}/></label><label>Valor liberado<input name="released_amount" inputMode="decimal" defaultValue={transfer?.released_amount??""}/></label><label>Previsão liberação<input name="expected_release_date" type="date" defaultValue={transfer?.expected_release_date??""}/></label><label>Data liberada<input name="released_at" type="date" defaultValue={transfer?.released_at??""}/></label><label>Protocolo<input name="protocol" defaultValue={transfer?.protocol??""}/></label><label>Status<select name="status" defaultValue={transfer?.status??"not_started"}>{Object.entries(transferLabel).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label><label className="registry-wide">Observações<textarea name="notes" rows={2} defaultValue={transfer?.notes??""}/></label><button type="submit">Salvar repasse</button></form>:null}
      </details>

      <details className="registry-create" open={overdue.length>0}><summary>Cobrança e inadimplência ({overdue.length} vencida(s))</summary>
        {overdue.map(r=><p key={r.id}><strong>{r.description}</strong> · venceu {dateBR(r.due_date)} · saldo {money(openTitleAmount(r))}</p>)}
        {collections.map(c=><p key={c.id}>Caso {c.stage} · {c.status} · aberto em {dateBR(c.opened_at)}{c.promised_date?` · promessa ${dateBR(c.promised_date)} ${money(c.promised_amount)}`:""}<br/><small>{c.notes}</small></p>)}
        {canFinance?<form action={saveCollectionCase} className="registry-form-grid"><input type="hidden" name="sale_id" value={saleId}/><label>Parcela<select name="receivable_id"><option value="">Carteira geral</option>{receivables.filter(r=>r.status==="open").map(r=><option key={r.id} value={r.id}>{r.due_date} · {r.description}</option>)}</select></label><label>Etapa<select name="stage"><option value="contact">Contato</option><option value="notice">Notificação</option><option value="agreement">Acordo</option><option value="legal">Jurídico</option></select></label><label>Status<select name="status"><option value="open">Aberto</option><option value="negotiating">Negociando</option><option value="promise">Promessa</option><option value="agreement">Acordo</option><option value="legal">Jurídico</option><option value="closed">Encerrado</option></select></label><label>Último contato<input name="last_contact_at" type="date"/></label><label>Promessa para<input name="promised_date" type="date"/></label><label>Valor prometido<input name="promised_amount" inputMode="decimal"/></label><label className="registry-wide">Registro do contato<textarea name="notes" rows={2}/></label><button type="submit">Registrar cobrança</button></form>:null}
      </details>
    </section>

    <details className="registry-create" open={Boolean(termination)}><summary>Distrato</summary>
      {termination?<div className="finance-summary-grid"><article><span>Pago pelo cliente</span><strong>{money(termination.paid_amount_snapshot)}</strong></article><article><span>Retenção</span><strong>{money(termination.retention_amount)}</strong><small>{termination.retention_percent}%</small></article><article><span>Devolução</span><strong>{money(termination.refund_amount)}</strong><small>vencimento {dateBR(termination.refund_due_date)}</small></article><article><span>Status</span><strong>{termination.status}</strong><small>{termination.commission_review_required?"há comissão paga/gerada para revisar":"sem comissão consolidada para revisar"}</small></article></div>:null}
      {canManage&&sale.status==="active"&&termination?.status!=="executed"?<form action={prepareTermination} className="registry-form-grid"><input type="hidden" name="sale_id" value={saleId}/><label>Retenção sobre o pago (%)<input name="retention_percent" inputMode="decimal" defaultValue={termination?.retention_percent??"0"} required/></label><label>Vencimento da devolução<input name="refund_due_date" type="date" defaultValue={termination?.refund_due_date??""}/></label><label className="registry-wide">Motivo<input name="reason" minLength={5} defaultValue={termination?.reason??""} required/></label><button type="submit">Recalcular simulação do distrato</button></form>:null}
      {canApprove&&termination&&termination.status!=="executed"&&sale.status==="active"?<form action={executeTermination}><input type="hidden" name="sale_id" value={saleId}/><input type="hidden" name="termination_id" value={termination.id}/><p><strong>Atenção:</strong> executar cancela parcelas abertas, libera a unidade e gera a devolução em Contas a Pagar quando houver valor a devolver.</p><button className="auth-primary" type="submit">Executar distrato</button></form>:null}
      {termination?.refund_payable_id?<p>Conta a pagar de devolução gerada: <Link href={`/financeiro/contas-a-pagar?q=${termination.refund_payable_id}`}>abrir financeiro</Link></p>:null}
    </details>
  </AppShell>;
}
