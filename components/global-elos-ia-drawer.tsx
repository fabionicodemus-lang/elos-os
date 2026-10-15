"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ElosIaChat, type ElosIaChatPersona, type ElosIaPageContext } from "@/app/elos-ia/elos-ia-chat";

type Quota={tracking:boolean;costTracking:boolean;userTokensToday:number;dailyUserTokens:number;companyTokensMonth:number;monthlyCompanyTokens:number;companyUsdMonth:number;monthlyCompanyUsd:number};
type Bootstrap={
  ok:boolean;
  configured:boolean;
  personas:ElosIaChatPersona[];
  defaultPersona:string;
  activeProjectLabel:string|null;
  initialQuota:Quota;
  maxQuestionChars:number;
  companyId:string;
  userId:string;
  error?:string;
};

const OPEN_KEY="elos-ia-global-drawer-open";

function visiblePageContext(pathname:string,activeProjectLabel:string|null):ElosIaPageContext {
  if(typeof document==="undefined") return {pathname,activeProjectLabel};
  const heading=document.querySelector(".elos-page-top h1");
  const screen=heading ? Array.from(heading.childNodes).filter((node)=>node.nodeType===Node.TEXT_NODE).map((node)=>node.textContent?.trim()??"").filter(Boolean).join(" ") : null;
  const breadcrumb=Array.from(document.querySelectorAll(".elos-breadcrumb > *")).map((node)=>node.textContent?.trim()??"").filter(Boolean);
  const module=breadcrumb.length>=2?breadcrumb[1]:null;
  const eyebrow=document.querySelector(".elos-eyebrow")?.textContent?.trim()??null;
  return {pathname,module,screen:screen||eyebrow||null,eyebrow,activeProjectLabel};
}

export function GlobalElosIaDrawer({activeProjectLabel}:{activeProjectLabel:string|null}){
  const pathname=usePathname();
  const [mounted,setMounted]=useState(false);
  const [open,setOpen]=useState(false);
  const [bootstrap,setBootstrap]=useState<Bootstrap|null>(null);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [reloadKey,setReloadKey]=useState(0);
  const [context,setContext]=useState<ElosIaPageContext>({pathname,activeProjectLabel});

  useEffect(()=>{
    setMounted(true);
    try{setOpen(sessionStorage.getItem(OPEN_KEY)==="1");}catch{}
  },[]);

  useEffect(()=>{
    if(!mounted)return;
    try{sessionStorage.setItem(OPEN_KEY,open?"1":"0");}catch{}
  },[mounted,open]);

  useEffect(()=>{
    if(!mounted)return;
    const frame=requestAnimationFrame(()=>setContext(visiblePageContext(pathname,activeProjectLabel)));
    return()=>cancelAnimationFrame(frame);
  },[mounted,pathname,activeProjectLabel,open]);

  useEffect(()=>{
    if(!open||bootstrap||loading||error)return;
    let cancelled=false;
    setLoading(true);
    fetch("/api/elos-ia/bootstrap",{headers:{accept:"application/json"},cache:"no-store"})
      .then(async(response)=>{
        const payload=await response.json().catch(()=>null) as Bootstrap|null;
        if(cancelled)return;
        if(!response.ok||!payload?.ok){setError(payload?.error??"Não foi possível abrir o Elos IA.");return;}
        setBootstrap(payload);
      })
      .catch(()=>{if(!cancelled)setError("Não foi possível conectar ao Elos IA.");})
      .finally(()=>{if(!cancelled)setLoading(false);});
    return()=>{cancelled=true;};
  },[open,bootstrap,loading,error,reloadKey]);

  useEffect(()=>{
    if(!open)return;
    const onKey=(event:KeyboardEvent)=>{if(event.key==="Escape")setOpen(false);};
    window.addEventListener("keydown",onKey);
    return()=>window.removeEventListener("keydown",onKey);
  },[open]);

  const retry=()=>{setError(null);setBootstrap(null);setReloadKey((value)=>value+1);};
  const contextLabel=[activeProjectLabel,context.screen].filter(Boolean).join(" · ")||"Contexto atual";

  const drawer=mounted&&open?createPortal(
    <aside className="elos-ai-drawer" aria-label="Elos IA" aria-live="polite">
      <header className="elos-ai-drawer-head">
        <div><strong><span aria-hidden="true">✦</span> Elos IA</strong><span>{contextLabel}</span></div>
        <div className="elos-ai-drawer-actions"><Link href="/elos-ia" title="Abrir Elos IA em tela completa" aria-label="Abrir Elos IA em tela completa">↗</Link><button type="button" onClick={()=>setOpen(false)} title="Fechar Elos IA" aria-label="Fechar Elos IA">×</button></div>
      </header>
      <div className="elos-ai-drawer-body">
        {loading?<div className="elos-ai-drawer-state"><span className="elos-ai-drawer-spark">✦</span><strong>Preparando o contexto desta tela…</strong></div>:null}
        {error?<div className="elos-ai-drawer-state error"><strong>{error}</strong><button type="button" className="elos-button" onClick={retry}>Tentar novamente</button></div>:null}
        {bootstrap?<ElosIaChat personas={bootstrap.personas} defaultPersona={bootstrap.defaultPersona} configured={bootstrap.configured} activeProjectLabel={activeProjectLabel??bootstrap.activeProjectLabel} initialQuota={bootstrap.initialQuota} maxQuestionChars={bootstrap.maxQuestionChars} companyId={bootstrap.companyId} userId={bootstrap.userId} compact pageContext={context} storageKey={`elos-ia-global:${bootstrap.companyId}:${bootstrap.userId}`}/>:null}
      </div>
    </aside>,document.body):null;

  return <>
    <button type="button" className={`elos-ai-launcher ${open?"active":""}`} onClick={()=>setOpen((value)=>!value)} title={open?"Fechar Elos IA":"Abrir Elos IA"} aria-label={open?"Fechar Elos IA":"Abrir Elos IA"} aria-expanded={open}>
      <span aria-hidden="true">✦</span><b>IA</b>
    </button>
    {drawer}
  </>;
}
