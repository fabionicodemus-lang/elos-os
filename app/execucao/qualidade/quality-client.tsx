"use client";

import { useMemo, useRef, useState } from "react";
import {
  cancelInspection,
  completeInspection,
  createManualInspection,
  exceptionRelease,
  saveChecklistTemplate,
  saveInspection,
  saveInspectionRule,
} from "./actions";

export type ServiceOption = { id: string; code: string; description: string };
export type LocationOption = { id: string; code: string; name: string };
export type SupplierOption = { id: string; legal_name: string; trade_name: string | null };
export type ActivityOption = { id: string; service_id: string | null; location_id: string | null; code: string; name: string; planned_start: string; planned_finish: string };
export type TemplateRecord = { id: string; service_id: string | null; code: string; name: string; description: string | null; criticality: string; service_weight: number; inspection_unit: string; periodicity: string; sampling_rule: string | null; evidence_rule: string | null; has_blocking_gate: boolean; current_version_id: string | null; version_no?: number };
export type CriterionRecord = { id?: string; group_name: string; code: string; description: string; verification_method: string | null; acceptance_criterion: string | null; verification_moment?: string | null; weight: number; failure_severity: string; is_blocking: boolean; requires_photo: boolean; requires_measurement: boolean; measurement_unit: string | null; allow_reservation: boolean; is_required: boolean; guidance: string | null; sort_order?: number };
export type InspectionRecord = { id: string; inspection_number: string; stage_name: string; status: string; completion_percent: number; current_score: number | null; first_inspection_score: number | null; release_status: string; due_date: string; supplier_id: string | null; executor_team: string | null; general_notes: string | null; executor_confirmed: boolean; service_id: string; location_id: string | null; template_id: string; checklist_version_id: string; responsible_engineer_user_id: string; origin: string; tower: string | null; unit_name: string | null; environment_name: string | null; schedule_activity_id: string | null };
export type InspectionItemRecord = { id: string; group_name_snapshot: string; code_snapshot: string; description_snapshot: string; verification_method_snapshot: string | null; acceptance_criterion_snapshot: string | null; weight_snapshot: number; failure_severity_snapshot: string; is_blocking_snapshot: boolean; requires_photo_snapshot: boolean; requires_measurement_snapshot: boolean; measurement_unit_snapshot: string | null; allow_reservation_snapshot: boolean; is_required_snapshot: boolean; guidance_snapshot: string | null; response: string | null; measurement_value: number | null; observation: string | null; sort_order: number };
export type AttachmentRecord = { id: string; inspection_id: string | null; inspection_item_id: string | null; nonconformity_id: string | null; attachment_type: string; file_name: string; caption: string | null; signed_url: string | null };

const responseLabels: Record<string,string> = { conforming: "Conforme", reservation: "Conforme com ressalva", nonconforming: "Não conforme", not_applicable: "Não se aplica" };
const statusLabels: Record<string,string> = { pending:"Pendente",in_progress:"Em preenchimento",approved:"Aprovada",approved_with_reservations:"Aprovada com ressalvas",nonconforming:"Com não conformidade",blocked:"Reprovada · serviço bloqueado",awaiting_reinspection:"Aguardando reinspeção",closed:"Encerrada",cancelled:"Cancelada" };
function today() { return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }

export function ManualInspectionDialog({ templates, activities, locations, suppliers }: { templates: TemplateRecord[]; activities: ActivityOption[]; locations: LocationOption[]; suppliers: SupplierOption[] }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [templateId,setTemplateId] = useState(templates[0]?.id ?? "");
  const [activityId,setActivityId] = useState("");
  const activity = activities.find((item)=>item.id===activityId);
  const template = templates.find((item)=>item.id===templateId);
  return <>
    <button className="elos-button" type="button" onClick={()=>ref.current?.showModal()}>+ Nova vistoria</button>
    <dialog className="quality-dialog" ref={ref}><form action={createManualInspection}>
      <header><div><span>Execução · Qualidade</span><h2>Nova vistoria</h2><p>A vistoria será atribuída ao engenheiro responsável configurado para a obra.</p></div><button type="button" onClick={()=>ref.current?.close()}>×</button></header>
      <div className="quality-dialog-body quality-form-grid">
        <label className="span2">Modelo publicado<select name="template_id" value={templateId} onChange={(event)=>setTemplateId(event.target.value)} required><option value="">Selecione</option>{templates.map((item)=><option value={item.id} key={item.id}>{item.code} · {item.name} · v{item.version_no ?? 1}</option>)}</select></label>
        <label className="span2">Atividade do cronograma<select name="schedule_activity_id" value={activityId} onChange={(event)=>setActivityId(event.target.value)}><option value="">Sem atividade vinculada</option>{activities.filter((item)=>!template?.service_id || item.service_id===template.service_id).map((item)=><option value={item.id} key={item.id}>{item.code} · {item.name} · {item.planned_start.slice(8,10)}/{item.planned_start.slice(5,7)}</option>)}</select></label>
        <label>Etapa da inspeção<input name="stage_name" required defaultValue={template?.name ?? ""} placeholder="Ex.: primeira fiada" /></label>
        <label>Data prevista<input name="due_date" type="date" required defaultValue={activity?.planned_start ?? today()} /></label>
        <label>Local / pavimento<select name="location_id" defaultValue={activity?.location_id ?? ""}><option value="">Não definido</option>{locations.map((item)=><option value={item.id} key={item.id}>{item.code} · {item.name}</option>)}</select></label>
        <label>Equipe / empreiteiro<select name="supplier_id"><option value="">Equipe não cadastrada</option>{suppliers.map((item)=><option value={item.id} key={item.id}>{item.trade_name || item.legal_name}</option>)}</select></label>
        <label>Nome da equipe<input name="executor_team" placeholder="Equipe executora" /></label>
        <label>Bloco / torre<input name="tower" /></label>
        <label>Unidade<input name="unit_name" /></label>
        <label>Ambiente / trecho<input name="environment_name" /></label>
      </div>
      <footer><button type="button" onClick={()=>ref.current?.close()}>Cancelar</button><button className="primary" type="submit">Criar e abrir checklist</button></footer>
    </form></dialog>
  </>;
}

function emptyCriterion(index:number): CriterionRecord { return { group_name:"Verificação",code:`C${String(index+1).padStart(3,"0")}`,description:"",verification_method:null,acceptance_criterion:null,verification_moment:null,weight:1,failure_severity:"light",is_blocking:false,requires_photo:false,requires_measurement:false,measurement_unit:null,allow_reservation:true,is_required:true,guidance:null,sort_order:index+1 }; }

export function TemplateDialog({ services, initial, criteria = [], label }: { services: ServiceOption[]; initial?: TemplateRecord | null; criteria?: CriterionRecord[]; label?: string }) {
  const ref=useRef<HTMLDialogElement>(null);
  const [rows,setRows]=useState<CriterionRecord[]>(criteria.length?criteria.map((item)=>({...item})):[emptyCriterion(0)]);
  const title=initial?`Publicar nova versão de ${initial.code}`:"Novo modelo de checklist";
  function update(index:number,patch:Partial<CriterionRecord>){setRows((current)=>current.map((row,i)=>i===index?{...row,...patch}:row));}
  return <>
    <button type="button" className={initial?"quality-link-button":"elos-button"} onClick={()=>ref.current?.showModal()}>{label ?? (initial?"Nova versão":"+ Novo modelo")}</button>
    <dialog className="quality-dialog quality-template-dialog" ref={ref}><form action={saveChecklistTemplate}>
      <input type="hidden" name="template_id" value={initial?.id ?? ""}/><input type="hidden" name="criteria_json" value={JSON.stringify(rows)}/>
      <header><div><span>Modelos versionados</span><h2>{title}</h2><p>A versão anterior permanece imutável nas vistorias já criadas.</p></div><button type="button" onClick={()=>ref.current?.close()}>×</button></header>
      <div className="quality-dialog-body">
        <div className="quality-form-grid">
          <label>Serviço<select name="service_id" defaultValue={initial?.service_id ?? ""}><option value="">Modelo sem serviço fixo</option>{services.map((item)=><option value={item.id} key={item.id}>{item.code} · {item.description}</option>)}</select></label>
          <label>Código<input name="code" required defaultValue={initial?.code ?? ""}/></label>
          <label className="span2">Nome<input name="name" required defaultValue={initial?.name ?? ""}/></label>
          <label className="span2">Descrição<textarea name="description" rows={2} defaultValue={initial?.description ?? ""}/></label>
          <label>Criticidade<select name="criticality" defaultValue={initial?.criticality ?? "medium"}><option value="low">Baixa</option><option value="medium">Média</option><option value="high">Alta</option><option value="critical">Crítica</option></select></label>
          <label>Peso do serviço<input name="service_weight" type="number" min="0.0001" step="0.0001" defaultValue={initial?.service_weight ?? 1}/></label>
          <label>Unidade de inspeção<input name="inspection_unit" defaultValue={initial?.inspection_unit ?? "local"}/></label>
          <label>Periodicidade<input name="periodicity" defaultValue={initial?.periodicity ?? "per_activity"}/></label>
          <label className="span2">Regra de amostragem<input name="sampling_rule" defaultValue={initial?.sampling_rule ?? ""}/></label>
          <label className="span2">Evidências obrigatórias<input name="evidence_rule" defaultValue={initial?.evidence_rule ?? ""}/></label>
          <label className="quality-check span2"><input name="has_blocking_gate" type="checkbox" defaultChecked={initial?.has_blocking_gate}/> Possui gate de bloqueio</label>
          <label className="span2">Notas da nova versão<input name="change_notes" required placeholder="O que mudou nesta versão?"/></label>
        </div>
        <div className="quality-criteria-builder"><div className="quality-builder-head"><div><span>Critérios</span><h3>{rows.length} item(ns)</h3></div><button type="button" onClick={()=>setRows((current)=>[...current,emptyCriterion(current.length)])}>+ Critério</button></div>
          {rows.map((row,index)=><article key={index}>
            <div className="quality-criterion-top"><strong>{index+1}</strong><label>Grupo<input value={row.group_name} onChange={(event)=>update(index,{group_name:event.target.value})}/></label><label>Código<input value={row.code} onChange={(event)=>update(index,{code:event.target.value})}/></label><button type="button" onClick={()=>setRows((current)=>current.filter((_,i)=>i!==index))} disabled={rows.length===1}>Remover</button></div>
            <label>Descrição do critério<textarea rows={2} value={row.description} onChange={(event)=>update(index,{description:event.target.value})} required/></label>
            <div className="quality-form-grid compact"><label>Método de verificação<input value={row.verification_method ?? ""} onChange={(event)=>update(index,{verification_method:event.target.value})}/></label><label>Critério de aceitação<input value={row.acceptance_criterion ?? ""} onChange={(event)=>update(index,{acceptance_criterion:event.target.value})}/></label><label>Peso<select value={row.weight} onChange={(event)=>update(index,{weight:Number(event.target.value)})}>{[1,2,3,4,5].map((value)=><option value={value} key={value}>{value}</option>)}</select></label><label>Gravidade<select value={row.failure_severity} onChange={(event)=>update(index,{failure_severity:event.target.value,allow_reservation:event.target.value==="critical"?false:row.allow_reservation})}><option value="light">Leve</option><option value="serious">Grave</option><option value="critical">Crítica</option></select></label><label>Unidade da medição<input value={row.measurement_unit ?? ""} onChange={(event)=>update(index,{measurement_unit:event.target.value})}/></label><label>Orientação<input value={row.guidance ?? ""} onChange={(event)=>update(index,{guidance:event.target.value})}/></label></div>
            <div className="quality-options"><label><input type="checkbox" checked={row.is_required} onChange={(event)=>update(index,{is_required:event.target.checked})}/> Obrigatório</label><label><input type="checkbox" checked={row.is_blocking} onChange={(event)=>update(index,{is_blocking:event.target.checked})}/> Bloqueante</label><label><input type="checkbox" checked={row.requires_photo} onChange={(event)=>update(index,{requires_photo:event.target.checked})}/> Exige foto</label><label><input type="checkbox" checked={row.requires_measurement} onChange={(event)=>update(index,{requires_measurement:event.target.checked})}/> Exige medição</label><label><input type="checkbox" checked={row.allow_reservation} disabled={row.failure_severity==="critical"} onChange={(event)=>update(index,{allow_reservation:event.target.checked})}/> Permite ressalva</label></div>
          </article>)}
        </div>
      </div>
      <footer><button type="button" onClick={()=>ref.current?.close()}>Cancelar</button><button className="primary" type="submit">Publicar versão</button></footer>
    </form></dialog>
  </>;
}

export function RuleDialog({ templates, services }: { templates: TemplateRecord[]; services: ServiceOption[] }) {
  const ref=useRef<HTMLDialogElement>(null); const [templateId,setTemplateId]=useState(""); const template=templates.find((item)=>item.id===templateId);
  return <><button className="quality-link-button" type="button" onClick={()=>ref.current?.showModal()}>+ Regra automática</button><dialog className="quality-dialog" ref={ref}><form action={saveInspectionRule}>
    <header><div><span>Sincronização com cronograma</span><h2>Nova regra automática</h2></div><button type="button" onClick={()=>ref.current?.close()}>×</button></header>
    <div className="quality-dialog-body quality-form-grid"><label className="span2">Modelo<select name="template_id" required value={templateId} onChange={(event)=>setTemplateId(event.target.value)}><option value="">Selecione</option>{templates.map((item)=><option value={item.id} key={item.id}>{item.code} · {item.name}</option>)}</select></label><label className="span2">Serviço<select name="service_id" required defaultValue={template?.service_id ?? ""}><option value="">Selecione</option>{services.map((item)=><option value={item.id} key={item.id}>{item.code} · {item.description}</option>)}</select></label><label>Evento<select name="event_type" defaultValue="scheduled_start"><option value="scheduled_start">Início previsto</option><option value="actual_start">Início real</option><option value="activity_completion">Conclusão da atividade</option><option value="location_advance">Avanço de local</option><option value="prototype">Protótipo / primeiro trecho</option><option value="pre_hide">Antes de ocultar</option><option value="test">Ensaio / teste</option><option value="successor_release">Liberação do sucessor</option></select></label><label>Etapa da inspeção<input name="stage_name" required placeholder="Ex.: pré-concretagem"/></label><label>Dias em relação ao evento<input name="due_offset_days" type="number" defaultValue={0}/></label><label>Escopo do local<select name="location_scope"><option value="activity_location">Local da atividade</option><option value="project">Obra inteira</option><option value="manual">Definição manual</option></select></label><label className="quality-check"><input name="only_first_location" type="checkbox"/> Somente primeiro local</label><label className="quality-check"><input name="active" type="checkbox" defaultChecked/> Regra ativa</label></div>
    <footer><button type="button" onClick={()=>ref.current?.close()}>Cancelar</button><button className="primary" type="submit">Salvar regra</button></footer>
  </form></dialog></>;
}

export function InspectionEditor({ inspection, items, attachments, suppliers, serviceName, locationName, responsibleName, canFill, canComplete, canCancel, canException }: {
  inspection: InspectionRecord; items: InspectionItemRecord[]; attachments: AttachmentRecord[]; suppliers: SupplierOption[]; serviceName: string; locationName: string; responsibleName: string; canFill:boolean; canComplete:boolean; canCancel:boolean; canException:boolean;
}) {
  const initial = useMemo(()=>items.map((item)=>({ item_id:item.id,response:item.response ?? "",measurement_value:item.measurement_value ?? "",observation:item.observation ?? "" })),[items]);
  const [answers,setAnswers]=useState(initial);
  const locked=!canFill||!["pending","in_progress"].includes(inspection.status);
  const groups=[...new Set(items.map((item)=>item.group_name_snapshot))];
  const answered=answers.filter((item)=>item.response).length;
  function update(id:string,patch:Record<string,unknown>){setAnswers((current)=>current.map((item)=>item.item_id===id?{...item,...patch}:item));}
  return <section className="quality-inspection-editor">
    <header className={`quality-inspection-hero ${inspection.release_status}`}><div><span>{inspection.inspection_number} · {inspection.origin}</span><h2>{serviceName} · {inspection.stage_name}</h2><p>{locationName} · Engenheiro: {responsibleName} · Prevista para {new Intl.DateTimeFormat("pt-BR",{timeZone:"UTC"}).format(new Date(`${inspection.due_date}T12:00:00Z`))}</p></div><div><span className={`quality-status ${inspection.status}`}>{statusLabels[inspection.status] ?? inspection.status}</span><strong>{Number(inspection.completion_percent).toFixed(0)}%</strong><small>Nota {inspection.current_score===null?"—":Number(inspection.current_score).toFixed(1)}</small></div></header>
    <div className="quality-progress"><i style={{width:`${inspection.completion_percent}%`}}/></div>
    <section className="quality-inspection-summary"><article><span>Respondidos</span><strong>{answered}/{items.length}</strong></article><article><span>Nota da 1ª inspeção</span><strong>{inspection.first_inspection_score===null?"—":Number(inspection.first_inspection_score).toFixed(1)}</strong></article><article><span>Liberação</span><strong>{inspection.release_status}</strong></article><article><span>Versão</span><strong>preservada</strong></article></section>
    {locked?<div className="quality-block-message">Esta vistoria está bloqueada para edição. Resultados concluídos e a nota inicial não podem ser sobrescritos.</div>:null}
    <form action={saveInspection} encType="multipart/form-data"><input type="hidden" name="inspection_id" value={inspection.id}/><input type="hidden" name="answers_json" value={JSON.stringify(answers)}/>
      <fieldset disabled={locked}><section className="quality-executor-card"><div><label>Empreiteiro / empresa<select name="supplier_id" defaultValue={inspection.supplier_id ?? ""}><option value="">Não cadastrado</option>{suppliers.map((item)=><option value={item.id} key={item.id}>{item.trade_name || item.legal_name}</option>)}</select></label><label>Equipe executora<input name="executor_team" defaultValue={inspection.executor_team ?? ""} required/></label></div><label>Observações gerais<textarea name="general_notes" rows={3} defaultValue={inspection.general_notes ?? ""}/></label><label className="quality-check"><input name="executor_confirmed" type="checkbox" defaultChecked={inspection.executor_confirmed}/> Confirmo a identificação da equipe e o preenchimento desta vistoria.</label></section>
      {groups.map((group)=><section className="quality-criterion-group" key={group}><header><span>Grupo</span><h3>{group}</h3></header>{items.filter((item)=>item.group_name_snapshot===group).map((item)=>{const answer=answers.find((row)=>row.item_id===item.id)!;const itemAttachments=attachments.filter((a)=>a.inspection_item_id===item.id);return <article className={`quality-answer-card ${answer.response || "pending"}`} key={item.id}><div className="quality-answer-title"><span>{item.code_snapshot}</span><div><strong>{item.description_snapshot}</strong><small>Peso {item.weight_snapshot} · Falha {item.failure_severity_snapshot}{item.is_blocking_snapshot?" · bloqueante":""}</small></div></div>{item.guidance_snapshot?<p className="quality-guidance">Orientação: {item.guidance_snapshot}</p>:null}<details><summary>Como verificar e aceitar</summary><p><b>Método:</b> {item.verification_method_snapshot || "Não informado"}</p><p><b>Aceitação:</b> {item.acceptance_criterion_snapshot || "Não informada"}</p></details><div className="quality-response-buttons">{Object.entries(responseLabels).filter(([key])=>key!=="reservation"||item.allow_reservation_snapshot).map(([key,label])=><button className={answer.response===key?"active":""} type="button" key={key} onClick={()=>update(item.id,{response:key})}>{label}</button>)}</div>{item.requires_measurement_snapshot?<label>Medição obrigatória ({item.measurement_unit_snapshot || "un"})<input type="number" step="0.0001" value={answer.measurement_value} onChange={(event)=>update(item.id,{measurement_value:event.target.value})}/></label>:null}<label>Comentário{["reservation","nonconforming"].includes(String(answer.response))?" obrigatório":""}<textarea rows={2} value={answer.observation} onChange={(event)=>update(item.id,{observation:event.target.value})}/></label>{item.requires_photo_snapshot?<label>Evidência fotográfica obrigatória<input name={`photo_${item.id}`} type="file" accept="image/*,application/pdf" multiple/><small>{itemAttachments.length} evidência(s) já anexada(s)</small></label>:null}{itemAttachments.length?<div className="quality-mini-gallery">{itemAttachments.map((file)=><a href={file.signed_url ?? "#"} target="_blank" rel="noreferrer" key={file.id}>{file.file_name}</a>)}</div>:null}{answer.response==="nonconforming"?<div className="quality-nc-warning">Ao salvar, o sistema abrirá automaticamente uma não conformidade com prazo conforme a gravidade.</div>:null}</article>})}</section>)}
      </fieldset>{!locked?<div className="quality-save-bar"><span>O progresso permanece nas pendências até todos os critérios obrigatórios serem concluídos.</span><button className="elos-button" type="submit">Salvar progresso</button></div>:null}
    </form>
    <section className="quality-workflow-actions">{canComplete&&["pending","in_progress"].includes(inspection.status)?<form action={completeInspection}><input type="hidden" name="inspection_id" value={inspection.id}/><button className="elos-button" type="submit" disabled={Number(inspection.completion_percent)<100}>Concluir vistoria</button><small>Disponível quando o preenchimento atingir 100%.</small></form>:null}{canException&&inspection.release_status==="blocked"?<form action={exceptionRelease}><input type="hidden" name="inspection_id" value={inspection.id}/><input name="reason" required placeholder="Justificativa obrigatória"/><button type="submit">Liberar por exceção</button></form>:null}{canCancel&&["pending","in_progress"].includes(inspection.status)?<form action={cancelInspection}><input type="hidden" name="inspection_id" value={inspection.id}/><input name="reason" required placeholder="Motivo do cancelamento"/><button className="danger" type="submit">Cancelar vistoria</button></form>:null}</section>
  </section>;
}
