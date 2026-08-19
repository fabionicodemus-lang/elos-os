import { performKoperLogin } from "./auth/koper-auto-login.js";
import { withBrowserless } from "./browser/browserless.js";
import { isAllowedFlowSwitch } from "./diagnostics/inspect-koper-engineering.js";
import { selectFlow } from "./diagnostics/collect-flow-stock-requests.js";

const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));

try{
 console.log("KOPER_MEASUREMENT_SPECIFIC_PERIOD_START");
 const result=await withBrowserless(async({page})=>{
  const login=await performKoperLogin(page); if(!login.authenticated)return{ok:false,message:login.message};
  let blockedWrites=0;
  await page.route("**/*",async route=>{const req=route.request();try{const u=new URL(req.url());const isK=u.hostname==="koper.com.br"||u.hostname.endsWith(".koper.com.br");if(isK&&!["GET","HEAD","OPTIONS"].includes(req.method())&&!isAllowedFlowSwitch(u,req.method(),req.postData())){blockedWrites++;await route.abort("blockedbyclient");return;}}catch{}await route.continue();});
  if(!await selectFlow(page))return{ok:false,message:"FLOW_NOT_SELECTED",blockedWrites};
  const calls:Array<Record<string,unknown>>=[];
  page.on("response",async resp=>{try{const req=resp.request(),u=new URL(resp.url());if(req.method()!=="GET"||u.hostname!=="api.koper.com.br"||u.pathname!=="/engineering/v1/build_measurement")return;u.searchParams.delete("accessToken");u.searchParams.delete("cb");u.searchParams.delete("appVersion");u.searchParams.delete("visited-page");const b=await resp.json().catch(()=>null) as any;calls.push({url:`${u.pathname}?${u.searchParams.toString()}`,itemsAmount:b?.itemsAmount??null,returned:Array.isArray(b?.measurements)?b.measurements.length:null,firstDate:b?.measurements?.[0]?.measurementDate??null,lastDate:b?.measurements?.at?.(-1)?.measurementDate??null});}catch{}});
  await page.goto("https://app.koper.com.br/engenharia/medicoes/finalizadas",{waitUntil:"domcontentloaded",timeout:20000});await sleep(4000);
  const dropdowns=page.locator("div.input-default.dropdown-toggle");let dateDrop=-1;for(let i=0;i<await dropdowns.count();i++){const b=await dropdowns.nth(i).boundingBox();if(b&&b.x>=480&&b.x<=680&&b.y>=130&&b.y<=190)dateDrop=i;}
  if(dateDrop<0)return{ok:false,message:"DATE_DROPDOWN_NOT_FOUND",blockedWrites,calls};
  await dropdowns.nth(dateDrop).click();await sleep(500);
  const specific=page.locator("ul.dropdown-menu a").filter({hasText:"Período específico"}).first();
  if(!await specific.count())return{ok:false,message:"SPECIFIC_OPTION_NOT_FOUND",blockedWrites,calls};
  await specific.click();await sleep(1000);
  const controls=await page.evaluate(()=>Array.from(document.querySelectorAll<HTMLInputElement>("input")).map((el,index)=>{const r=el.getBoundingClientRect();return{index,type:el.type,value:el.value,placeholder:el.placeholder,name:el.name||null,id:el.id||null,className:String(el.className||"").slice(0,180),ngModel:el.getAttribute("ng-model"),x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height),visible:r.width>0&&r.height>0};}).filter(x=>x.visible&&x.y<350));
  const body=(await page.locator("body").innerText()).replace(/\s+/g," ").slice(0,3000);
  return{ok:true,readOnly:true,blockedWrites,calls,controls,body};
 },{sessionTimeoutMs:90000});
 console.log("KOPER_MEASUREMENT_SPECIFIC_PERIOD_RESULT",JSON.stringify(result));
}catch(error:unknown){console.error("KOPER_MEASUREMENT_SPECIFIC_PERIOD_FAILED",JSON.stringify({message:error instanceof Error?error.message.slice(0,1000):String(error).slice(0,1000)}));}
await import("./index.js");
