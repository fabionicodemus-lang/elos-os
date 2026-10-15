"use client";

import { useEffect,useRef,useState,type ChangeEvent,type KeyboardEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { ElosIaMarkdown } from "./elos-ia-markdown";
import { ElosIaActionCard,type ElosIaClientAction } from "./elos-ia-action-card";

export type ElosIaChatPersona={key:string;label:string;tagline:string;pilotNote:string|null;suggestions:string[];sources:Array<{label:string;available:boolean}>};
export type ElosIaPageContext={pathname?:string|null;module?:string|null;screen?:string|null;eyebrow?:string|null;activeProjectLabel?:string|null};
type Quota={tracking:boolean;costTracking:boolean;userTokensToday:number;dailyUserTokens:number;companyTokensMonth:number;monthlyCompanyTokens:number;companyUsdMonth:number;monthlyCompanyUsd:number};
type ChatMessage={id:string;role:"user"|"assistant";content:string;error?:boolean;consultas?:Array<{nome:string;ok:boolean}>;tokens?:number;attachments?:string[];actions?:ElosIaClientAction[]};
type ChatResponse={ok?:boolean;text?:string;error?:string;consultas?:Array<{nome:string;ok:boolean}>;tokens?:number;quota?:Quota|null;actions?:ElosIaClientAction[]};
type UploadedAttachment={path:string;fileName:string;mimeType:string;size:number};
type StoredChat={personaKey?:string;threads?:Record<string,ChatMessage[]>};

const MAX_FILES=3,MAX_FILE_BYTES=15*1024*1024,MAX_TOTAL_BYTES=25*1024*1024;
const ACCEPT=".pdf,.jpg,.jpeg,.png,.webp,.xlsx,.xls,.csv,.txt,.doc,.docx";
function tokenLabel(value:number){if(value>=1_000_000)return `${(value/1_000_000).toLocaleString("pt-BR",{maximumFractionDigits:1})} mi`;if(value>=1_000)return `${(value/1_000).toLocaleString("pt-BR",{maximumFractionDigits:1})} mil`;return value.toLocaleString("pt-BR");}
function usdLabel(value:number){return `US$ ${Number(value||0).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2})}`;}
function uniqueSources(consultas:Array<{nome:string;ok:boolean}>){const map=new Map<string,boolean>();for(const c of consultas)map.set(c.nome,(map.get(c.nome)??true)&&c.ok);return [...map.entries()].map(([nome,ok])=>({nome,ok}));}
function safeName(value:string){return value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-zA-Z0-9._-]+/g,"-").replace(/-+/g,"-").slice(-150)||"arquivo";}
function inferMime(file:File){if(file.type)return file.type;const ext=file.name.toLowerCase().split(".").pop();return ({pdf:"application/pdf",jpg:"image/jpeg",jpeg:"image/jpeg",png:"image/png",webp:"image/webp",xlsx:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",xls:"application/vnd.ms-excel",csv:"text/csv",txt:"text/plain",docx:"application/vnd.openxmlformats-officedocument.wordprocessingml.document",doc:"application/msword"} as Record<string,string>)[ext??""]??"application/octet-stream";}
let counter=0;const nextId=()=>`m${Date.now()}-${++counter}`;

export function ElosIaChat({personas,defaultPersona,configured,activeProjectLabel,initialQuota,maxQuestionChars,companyId,userId,compact=false,pageContext=null,storageKey}:{personas:ElosIaChatPersona[];defaultPersona:string;configured:boolean;activeProjectLabel:string|null;initialQuota:Quota;maxQuestionChars:number;companyId:string;userId:string;compact?:boolean;pageContext?:ElosIaPageContext|null;storageKey?:string}){
  const [personaKey,setPersonaKey]=useState(personas.some((p)=>p.key===defaultPersona)?defaultPersona:personas[0]?.key??"");
  const [threads,setThreads]=useState<Record<string,ChatMessage[]>>({});
  const [storageReady,setStorageReady]=useState(!storageKey);
  const [draft,setDraft]=useState("");const [files,setFiles]=useState<File[]>([]);const [fileError,setFileError]=useState<string|null>(null);
  const [pendingPersona,setPendingPersona]=useState<string|null>(null);const [quota,setQuota]=useState(initialQuota);
  const bottomRef=useRef<HTMLDivElement|null>(null);const fileRef=useRef<HTMLInputElement|null>(null);
  const persona=personas.find((p)=>p.key===personaKey)??personas[0];const messages=threads[personaKey]??[];const waiting=pendingPersona===personaKey;const busy=pendingPersona!==null;
  const dailyUsedUp=quota.tracking&&quota.dailyUserTokens>0&&quota.userTokensToday>=quota.dailyUserTokens;const monthlyUsdUsedUp=quota.tracking&&quota.monthlyCompanyUsd>0&&quota.companyUsdMonth>=quota.monthlyCompanyUsd;const canType=configured&&!dailyUsedUp&&!monthlyUsdUsedUp;const dailyPercent=quota.dailyUserTokens>0?Math.min(100,quota.userTokensToday/quota.dailyUserTokens*100):0;

  useEffect(()=>{bottomRef.current?.scrollIntoView({block:"end",behavior:"smooth"});},[messages.length,waiting]);
  useEffect(()=>{
    if(!storageKey)return;
    try{
      const raw=sessionStorage.getItem(storageKey);
      if(raw){
        const stored=JSON.parse(raw) as StoredChat;
        if(stored.threads&&typeof stored.threads==="object")setThreads(stored.threads);
        if(stored.personaKey&&personas.some((item)=>item.key===stored.personaKey))setPersonaKey(stored.personaKey);
      }
    }catch{}
    setStorageReady(true);
  },[storageKey,personas]);
  useEffect(()=>{
    if(!storageKey||!storageReady)return;
    try{sessionStorage.setItem(storageKey,JSON.stringify({personaKey,threads} satisfies StoredChat));}catch{}
  },[storageKey,storageReady,personaKey,threads]);

  function append(key:string,message:ChatMessage){setThreads((current)=>({...current,[key]:[...(current[key]??[]),message]}));}
  function replaceAction(key:string,messageId:string,next:ElosIaClientAction){setThreads((current)=>({...current,[key]:(current[key]??[]).map((message)=>message.id===messageId?{...message,actions:(message.actions??[]).map((action)=>action.id===next.id?next:action)}:message)}));}

  function chooseFiles(event:ChangeEvent<HTMLInputElement>){
    const chosen=[...Array.from(event.target.files??[])];event.target.value="";setFileError(null);
    const next=[...files,...chosen];if(next.length>MAX_FILES){setFileError(`Envie no máximo ${MAX_FILES} arquivos por pergunta.`);return;}
    if(next.some((file)=>file.size>MAX_FILE_BYTES)){setFileError("Cada arquivo pode ter no máximo 15 MB.");return;}
    if(next.reduce((sum,file)=>sum+file.size,0)>MAX_TOTAL_BYTES){setFileError("Os arquivos desta pergunta podem somar no máximo 25 MB.");return;}
    setFiles(next);
  }

  async function uploadFiles(selected:File[]):Promise<UploadedAttachment[]>{
    if(!selected.length)return [];
    const supabase=createClient();const uploaded:UploadedAttachment[]=[];
    for(const file of selected){
      const mimeType=inferMime(file);const path=`${companyId}/${userId}/${crypto.randomUUID()}-${safeName(file.name)}`;
      const result=await supabase.storage.from("ai-action-attachments").upload(path,file,{contentType:mimeType,upsert:false});
      if(result.error)throw new Error(`Falha ao enviar ${file.name}: ${result.error.message}`);
      uploaded.push({path,fileName:file.name,mimeType,size:file.size});
    }
    return uploaded;
  }

  async function send(value:string){
    const question=value.trim();if(!question||busy||!canType||!persona)return;
    const key=persona.key;const selected=[...files];const history=(threads[key]??[]).filter((m)=>!m.error).map(({role,content})=>({role,content}));
    setPendingPersona(key);setFileError(null);
    try{
      const attachments=await uploadFiles(selected);
      append(key,{id:nextId(),role:"user",content:question,attachments:selected.map((file)=>file.name)});setDraft("");setFiles([]);
      const response=await fetch("/api/elos-ia/chat",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({persona:key,question,history,attachments,pageContext})});
      const payload=await response.json().catch(()=>null) as ChatResponse|null;if(payload?.quota)setQuota(payload.quota);
      if(!response.ok||!payload?.ok||typeof payload.text!=="string")append(key,{id:nextId(),role:"assistant",error:true,content:payload?.error??"O Elos IA não conseguiu responder agora. Tente novamente."});
      else append(key,{id:nextId(),role:"assistant",content:payload.text,consultas:payload.consultas??[],tokens:payload.tokens??0,actions:payload.actions??[]});
    }catch(error){append(key,{id:nextId(),role:"assistant",error:true,content:error instanceof Error?error.message:"Sem conexão com o Elos OS."});}
    finally{setPendingPersona(null);}
  }

  function onKeyDown(event:KeyboardEvent<HTMLTextAreaElement>){if(event.key==="Enter"&&!event.shiftKey&&!event.nativeEvent.isComposing){event.preventDefault();void send(draft);}}
  if(!persona)return null;
  const placeholder=monthlyUsdUsedUp?`Limite mensal da empresa atingido (${usdLabel(quota.monthlyCompanyUsd)}).`:dailyUsedUp?"Cota diária atingida. Ela é renovada à meia-noite.":compact?"Pergunte sobre a tela atual…":`Pergunte ou envie um documento como ${persona.label}…`;

  return <div className={`elos-ia ${compact?"compact":""}`}>
    {!configured?<div className="auth-message error workspace-message">O Elos IA ainda não está ativo: falta configurar a chave da OpenAI no servidor.</div>:null}
    {compact?<div className="elos-ia-compact-bar"><label>Perfil<select value={personaKey} onChange={(event)=>setPersonaKey(event.target.value)} disabled={busy}>{personas.map((item)=><option key={item.key} value={item.key}>{item.label}</option>)}</select></label><span>{pageContext?.screen??activeProjectLabel??"Contexto atual"}</span></div>:<div className="elos-ia-personas" role="tablist" aria-label="Persona do Elos IA">{personas.map((item)=><button key={item.key} type="button" role="tab" aria-selected={item.key===personaKey} className={`elos-ia-persona ${item.key===personaKey?"active":""}`} onClick={()=>setPersonaKey(item.key)}><strong>{item.label}</strong><span>{item.tagline}</span></button>)}</div>}
    <section className="elos-ia-card" aria-label={`Conversa com ${persona.label}`}>
      <header className="elos-ia-card-head"><div className="elos-ia-sources"><span className="elos-ia-sources-label">Consulta</span>{persona.sources.map((source)=><span key={source.label} className={`elos-ia-chip ${source.available?"":"off"}`}>{source.label}</span>)}</div>{messages.length?<button type="button" className="elos-button" disabled={busy} onClick={()=>setThreads((current)=>({...current,[personaKey]:[]}))}>Nova conversa</button>:null}</header>
      {persona.pilotNote?<p className="elos-ia-note">{persona.pilotNote}</p>:null}
      <div className="elos-ia-messages" aria-live="polite">
        {!messages.length?<div className="elos-ia-empty"><h2>{compact?"Estou vendo esta tela com você":`Pergunte sobre ${activeProjectLabel??"as obras da empresa"}`}</h2><p>{compact?`Contexto: ${[activeProjectLabel,pageContext?.screen].filter(Boolean).join(" · ")||"visão atual do Elos OS"}. Pergunte, peça uma análise ou uma ação.`:"Além de analisar os dados, agora você pode anexar orçamento de fornecedor ou boletim de medição. A IA prepara o lançamento e você revisa antes de gravar."}</p><div className="elos-ia-suggestions">{persona.suggestions.map((suggestion)=><button key={suggestion} type="button" disabled={busy||!canType} onClick={()=>void send(suggestion)}>{suggestion}</button>)}</div></div>:null}
        {messages.map((message)=><article key={message.id} className={`elos-ia-message ${message.role} ${message.error?"error":""}`}>
          {message.role==="assistant"&&!message.error?<ElosIaMarkdown text={message.content}/>:<p>{message.content}</p>}
          {message.attachments?.length?<div className="elos-ia-message-files">{message.attachments.map((name)=><span key={name}>📎 {name}</span>)}</div>:null}
          {message.actions?.map((action)=><ElosIaActionCard key={action.id} action={action} onChange={(next)=>replaceAction(personaKey,message.id,next)}/>) }
          {message.role==="assistant"&&!message.error?<footer>{uniqueSources(message.consultas??[]).length?<><span>Usou</span>{uniqueSources(message.consultas??[]).map((c)=><span key={c.nome} className={`elos-ia-chip ${c.ok?"":"off"}`}>{c.nome}</span>)}</>:<span>Respondeu sem ferramentas</span>}{message.tokens?<span className="elos-ia-tokens">{tokenLabel(message.tokens)} tokens</span>:null}</footer>:null}
        </article>)}
        {waiting?<article className="elos-ia-message assistant waiting"><p>Lendo dados e documentos<span className="elos-ia-dots" aria-hidden="true"><i/><i/><i/></span></p></article>:null}<div ref={bottomRef}/>
      </div>
      <form className="elos-ia-composer elos-ia-composer-with-files" onSubmit={(event)=>{event.preventDefault();void send(draft);}}>
        {files.length?<div className="elos-ia-files">{files.map((file,index)=><span key={`${file.name}-${index}`}>📎 {file.name}<button type="button" aria-label={`Remover ${file.name}`} onClick={()=>setFiles((current)=>current.filter((_,i)=>i!==index))}>×</button></span>)}</div>:null}
        {fileError?<div className="elos-ia-file-error">{fileError}</div>:null}
        <div className="elos-ia-composer-row"><button type="button" className="elos-button elos-ia-attach" disabled={!canType||busy} onClick={()=>fileRef.current?.click()}>+ Arquivo</button><input ref={fileRef} type="file" multiple accept={ACCEPT} hidden onChange={chooseFiles}/><textarea value={draft} onChange={(event)=>setDraft(event.target.value.slice(0,maxQuestionChars))} onKeyDown={onKeyDown} rows={2} placeholder={placeholder} aria-label="Pergunta para o Elos IA" disabled={!canType}/><button type="submit" className="elos-button primary" disabled={!canType||busy||!draft.trim()}>{busy?"Aguarde…":"Enviar"}</button></div>
      </form>
      <footer className="elos-ia-card-foot">{quota.tracking?<div className="elos-ia-quota" title={`Empresa no mês: ${tokenLabel(quota.companyTokensMonth)} de ${tokenLabel(quota.monthlyCompanyTokens)} tokens · ${usdLabel(quota.companyUsdMonth)} de ${usdLabel(quota.monthlyCompanyUsd)}`}><span>Seu uso hoje: {tokenLabel(quota.userTokensToday)} de {tokenLabel(quota.dailyUserTokens)} tokens</span><span>Empresa: {usdLabel(quota.companyUsdMonth)} / {usdLabel(quota.monthlyCompanyUsd)} no mês{quota.costTracking?"":" (estimativa conservadora)"}</span><span className="elos-ia-quota-bar" aria-hidden="true"><i style={{width:`${dailyPercent}%`}}/></span></div>:<span>Cota diária ainda não ativada.</span>}<span>Até 3 arquivos · 15 MB cada · PDF, foto, Excel, Word, CSV ou TXT</span></footer>
    </section>
  </div>;
}
