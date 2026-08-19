import { performKoperLogin } from "./auth/koper-auto-login.js";
import { withBrowserless } from "./browser/browserless.js";
import { isAllowedFlowSwitch } from "./diagnostics/inspect-koper-engineering.js";
import { selectFlow } from "./diagnostics/collect-flow-stock-requests.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

try {
  console.log("KOPER_MEASUREMENT_PERIOD_DROPDOWN_START");
  const result = await withBrowserless(async ({ page }) => {
    const login = await performKoperLogin(page);
    if (!login.authenticated) return { ok:false, message: login.message };
    let blockedWrites = 0;
    await page.route("**/*", async route => {
      const req = route.request();
      try {
        const u = new URL(req.url());
        const isKoper = u.hostname === "koper.com.br" || u.hostname.endsWith(".koper.com.br");
        if (isKoper && !["GET","HEAD","OPTIONS"].includes(req.method()) && !isAllowedFlowSwitch(u, req.method(), req.postData())) {
          blockedWrites++; await route.abort("blockedbyclient"); return;
        }
      } catch {}
      await route.continue();
    });
    if (!await selectFlow(page)) return { ok:false, message:"FLOW_NOT_SELECTED", blockedWrites };

    const calls:Array<Record<string,unknown>> = [];
    page.on("response", async resp => {
      try {
        const req=resp.request(); const u=new URL(resp.url());
        if(req.method()!=="GET"||u.hostname!=="api.koper.com.br"||u.pathname!=="/engineering/v1/build_measurement") return;
        u.searchParams.delete("accessToken");u.searchParams.delete("cb");u.searchParams.delete("appVersion");u.searchParams.delete("visited-page");
        const b=await resp.json().catch(()=>null) as any;
        calls.push({url:`${u.pathname}?${u.searchParams.toString()}`,itemsAmount:b?.itemsAmount??null,returned:Array.isArray(b?.measurements)?b.measurements.length:null,firstDate:b?.measurements?.[0]?.measurementDate??null,lastDate:b?.measurements?.at?.(-1)?.measurementDate??null});
      } catch {}
    });

    await page.goto("https://app.koper.com.br/engenharia/medicoes/finalizadas",{waitUntil:"domcontentloaded",timeout:20000});
    await sleep(4000);

    const dropdowns=page.locator("div.input-default.dropdown-toggle");
    const n=await dropdowns.count();
    let targetIndex=-1;
    const dropdownMeta=[];
    for(let i=0;i<n;i++){
      const box=await dropdowns.nth(i).boundingBox();
      const text=(await dropdowns.nth(i).innerText().catch(()=>"")).replace(/\s+/g," ").trim();
      dropdownMeta.push({i,box,text});
      if(box&&box.x>=480&&box.x<=680&&box.y>=130&&box.y<=190) targetIndex=i;
    }
    if(targetIndex<0) return {ok:false,message:"DATE_DROPDOWN_NOT_FOUND",blockedWrites,dropdownMeta,calls};
    await dropdowns.nth(targetIndex).click({timeout:5000});
    await sleep(1000);
    const popup = await page.evaluate(() => {
      const nodes=Array.from(document.querySelectorAll<HTMLElement>("ul.dropdown-menu, .dropdown-menu, [role='menu'], li, a"));
      return nodes.map((el,index)=>{const r=el.getBoundingClientRect();const s=getComputedStyle(el);return {index,tag:el.tagName.toLowerCase(),text:(el.innerText||"").replace(/\s+/g," ").trim().slice(0,200),className:String(el.className||"").slice(0,160),x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height),visible:r.width>0&&r.height>0&&s.display!=="none"&&s.visibility!=="hidden"};}).filter(x=>x.visible&&x.x>=430&&x.x<=750&&x.y>=130&&x.y<=700&&x.text);
    });

    // Click a visible 2024 option if present and record the GET it triggers.
    const year2024 = page.getByText(/^2024$/, { exact:true }).last();
    let selected2024=false;
    if(await year2024.count().catch(()=>0)){
      const before=calls.length;
      selected2024=await year2024.click({timeout:5000}).then(()=>true).catch(()=>false);
      await sleep(4000);
      return {ok:true,readOnly:true,blockedWrites,dropdownMeta,popup,selected2024,newCalls:calls.slice(before),calls};
    }
    return {ok:true,readOnly:true,blockedWrites,dropdownMeta,popup,selected2024,calls};
  },{sessionTimeoutMs:90000});
  console.log("KOPER_MEASUREMENT_PERIOD_DROPDOWN_RESULT",JSON.stringify(result));
} catch(error:unknown){
  console.error("KOPER_MEASUREMENT_PERIOD_DROPDOWN_FAILED",JSON.stringify({message:error instanceof Error?error.message.slice(0,1000):String(error).slice(0,1000)}));
}
await import("./index.js");
