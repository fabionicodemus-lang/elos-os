import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { requireCompanyPermission } from '@/lib/workspace';
import { normalizeFeasibilityImport, studyFields } from '@/lib/elos-ia/feasibility-import.mjs';
import { FeasibilityReviewForm } from './review-form';
export default async function FeasibilityImportReview({params}:{params:Promise<{proposalId:string}>}){
 const {proposalId}=await params;const {supabase,companyId,company}=await requireCompanyPermission('commercial.incorporation.view');
 const result=await supabase.from('ai_action_proposals').select('id,project_id,title,payload,preview,status,result,expires_at').eq('company_id',companyId).eq('id',proposalId).eq('action_type','commercial_feasibility_import').maybeSingle();
 if(!result.data)notFound();const proposal=result.data;
 const [project,permissions,attachments,imported]=await Promise.all([
  supabase.from('projects').select('name').eq('company_id',companyId).eq('id',proposal.project_id).maybeSingle(),
  supabase.rpc('has_company_permission',{target_company_id:companyId,target_permission:'commercial.incorporation.manage'}),
  supabase.from('ai_action_attachments').select('file_name,storage_path').eq('company_id',companyId).eq('proposal_id',proposalId),
  supabase.from('commercial_feasibility_imports').select('reviewed_payload').eq('company_id',companyId).eq('proposal_id',proposalId).maybeSingle(),
 ]);
 const files=await Promise.all((attachments.data??[]).map(async file=>{const signed=await supabase.storage.from('ai-action-attachments').createSignedUrl(file.storage_path,300);return {name:file.file_name,url:signed.data?.signedUrl};}));
 const initial=normalizeFeasibilityImport(imported.data?.reviewed_payload??proposal.payload);
 const extracted=normalizeFeasibilityImport(proposal.payload);
 const canConfirm=permissions.data===true&&proposal.status==='pending_review'&&new Date(proposal.expires_at)>new Date();
 return <AppShell activeGroup="ai" eyebrow="Elos IA · Revisão de documento" title="Revisar estudo de viabilidade" description={`${company.name} · ${project.data?.name??'Empreendimento indisponível'}`} actions={<Link className="elos-button" href="/elos-ia/acoes">Ações pendentes</Link>}>
  <section className="registry-table-panel"><h2>{proposal.title}</h2><p>Origem: {String(proposal.preview?.sourceFile??'Texto da conversa')} · Situação: {proposal.status==='executed'?'Cadastrado em rascunho':canConfirm?'Aguardando sua confirmação':'Consulta; confirmação indisponível ou expirada'}</p>{files.map((file,i)=>file.url?<p key={i}><a className="elos-button" href={file.url} target="_blank" rel="noreferrer">Abrir documento · {file.name}</a></p>:<p key={i}>Documento {file.name} indisponível para abertura.</p>)}
  {proposal.status==='executed'&&proposal.result?.study_id?<Link className="elos-button" href={`/comercial/incorporacao/viabilidade/${proposal.result.study_id}`}>Abrir estudo cadastrado</Link>:null}
  <details><summary>Conferir premissas extraídas antes da edição</summary><dl>{studyFields.filter(([k])=>extracted.study[k]!=null).map(([k,label])=><div key={k}><dt>{label}</dt><dd>{String(extracted.study[k])}</dd></div>)}</dl></details></section>
  <FeasibilityReviewForm proposalId={proposal.id} initial={initial} canConfirm={canConfirm}/>
 </AppShell>;
}
