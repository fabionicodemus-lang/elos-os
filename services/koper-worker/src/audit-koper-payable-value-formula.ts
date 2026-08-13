import type { Response } from "playwright-core";
import { performKoperLogin } from "./auth/koper-auto-login.js";
import { withBrowserless } from "./browser/browserless.js";
import { isAllowedFlowSwitch } from "./diagnostics/inspect-koper-engineering.js";
import { selectFlow } from "./diagnostics/collect-flow-stock-requests.js";

type Json = Record<string, unknown>;
const obj=(v:unknown):Json|null=>typeof v==="object"&&v!==null&&!Array.isArray(v)?v as Json:null;
const n=(v:unknown):number=>Number.isFinite(Number(v))?Number(v):0;
const c=(v:unknown):number=>Math.round((n(v)+Number.EPSILON)*100);
const br=(v:number)=>v/100;
const paid=(v:unknown):boolean=>v===true||v===1||v==="1"||String(v??"").toUpperCase()==="S";

try{
 const result=await withBrowserless(async({page})=>{
  const login=await performKoperLogin(page);if(!login.authenticated)return{ok:false,message:login.message};
  let blockedWrites=0;
  await page.route("**/*",async route=>{const r=route.request();try{const u=new URL(r.url());const koper=u.hostname==="koper.com.br"||u.hostname.endsWith(".koper.com.br");if(koper&&!["GET","HEAD","OPTIONS"].includes(r.method())&&!isAllowedFlowSwitch(u,r.method(),r.postData())){blockedWrites++;await route.abort("blockedbyclient");return;}}catch{}await route.continue();});
  if(!await selectFlow(page))return{ok:false,message:"FLOW_NOT_SELECTED",blockedWrites};
  const seedPromise=page.waitForResponse((response:Response)=>{try{const u=new URL(response.url());return response.request().method()==="GET"&&u.hostname==="api.koper.com.br"&&u.pathname==="/financial/v1/bills_to_pay"&&!u.searchParams.has("billId");}catch{return false;}},{timeout:20000}).catch(()=>null);
  await page.goto("https://app.koper.com.br/financeiro/contas_pagar",{waitUntil:"domcontentloaded",timeout:12000}).catch(()=>undefined);const seed=await seedPromise;if(!seed)return{ok:false,message:"SEED_NOT_FOUND",blockedWrites};
  const sh=seed.request().headers();const headers:Record<string,string>={};for(const k of["accept","origin","referer","x-accesstoken","x-koper"])if(sh[k])headers[k]=sh[k];
  const base=new URL(seed.url());const rows:Json[]=[];let header:Json|null=null;
  for(let offset=0;offset<10000;offset+=500){const u=new URL(base);for(const[k,v]of Object.entries({allBills:"yes",initialDate:"",finalDate:"",limit:"500",offset:String(offset),orderFlag:"asc",orderby:"dueDate",typeDate:"dueDate",cb:String(Date.now())}))u.searchParams.set(k,v);const response=await page.request.get(u.toString(),{headers,timeout:8000});if(!response.ok())return{ok:false,message:"PAGE_FAILED",status:response.status(),offset,blockedWrites};const body=obj(await response.json().catch(()=>null));if(!body)return{ok:false,message:"INVALID_BODY",offset,blockedWrites};if(!header)header=body;const pageRows=Array.isArray(body.bills)?body.bills.map(obj).filter((x):x is Json=>Boolean(x)):[];rows.push(...pageRows);if(rows.length>=n(body.billsAmount)||pageRows.length<500)break;}
  const seen=new Map<string,Json>();for(const r of rows){const id=String(r.billId??"");if(id&&!seen.has(id))seen.set(id,r);}const bills=[...seen.values()];
  let paidBill=0,paidPayment=0,openBill=0,openPayment=0,allBill=0,allPayment=0,allEffective=0;
  let discount=0,interest=0,lateFee=0,otherAccruals=0,paidFormula=0,openFormula=0,allFormula=0;
  let paidRows=0,openRows=0,paymentDiffRows=0,paymentMatchesFormula=0,paymentMissingPaid=0;
  const largestDiffs:Array<{billId:unknown,billValue:number,paymentValue:number,formula:number,discount:number,interest:number,lateFee:number,otherAccruals:number,diffPaymentVsBill:number,diffPaymentVsFormula:number}>=[];
  for(const r of bills){
   const bv=c(r.billValue),pv=c(r.paymentValue),d=c(r.discountValue),i=c(r.interestValue),l=c(r.lateFeeValue),o=c(r.otherAccruals);
   const formula=bv-d+i+l+o;
   allBill+=bv;allPayment+=pv;discount+=d;interest+=i;lateFee+=l;otherAccruals+=o;allFormula+=formula;
   const isPaid=paid(r.isPaid);
   if(isPaid){paidRows++;paidBill+=bv;paidPayment+=pv;paidFormula+=formula;if(pv===0)paymentMissingPaid++;if(pv===formula)paymentMatchesFormula++;}else{openRows++;openBill+=bv;openPayment+=pv;openFormula+=formula;}
   allEffective+=(isPaid?(pv||formula):formula);
   if(isPaid&&pv!==bv){paymentDiffRows++;largestDiffs.push({billId:r.billId??null,billValue:br(bv),paymentValue:br(pv),formula:br(formula),discount:br(d),interest:br(i),lateFee:br(l),otherAccruals:br(o),diffPaymentVsBill:br(pv-bv),diffPaymentVsFormula:br(pv-formula)});}
  }
  largestDiffs.sort((a,b)=>Math.abs(b.diffPaymentVsBill)-Math.abs(a.diffPaymentVsBill));
  const totalBills=c(header?.totalBills),totalPaid=c(header?.totalPaid),totalNotPaid=c(header?.totalNotPaid);
  return{ok:true,readOnly:true,blockedWrites,count:bills.length,header:{billsAmount:n(header?.billsAmount),totalBills:br(totalBills),totalPaid:br(totalPaid),totalNotPaid:br(totalNotPaid),totalDiscount:n(header?.totalDiscount),totalInterest:n(header?.totalInterest)},sums:{paidRows,openRows,paidBillValue:br(paidBill),paidPaymentValue:br(paidPayment),openBillValue:br(openBill),openPaymentValue:br(openPayment),allBillValue:br(allBill),allPaymentValue:br(allPayment),discount:br(discount),interest:br(interest),lateFee:br(lateFee),otherAccruals:br(otherAccruals),paidFormulaBillMinusDiscountPlusAccruals:br(paidFormula),openFormulaBillMinusDiscountPlusAccruals:br(openFormula),allFormulaBillMinusDiscountPlusAccruals:br(allFormula),effectivePaidPaymentElseFormula:br(allEffective)},differencesToHeader:{paidBillMinusHeaderPaid:br(paidBill-totalPaid),paidPaymentMinusHeaderPaid:br(paidPayment-totalPaid),paidFormulaMinusHeaderPaid:br(paidFormula-totalPaid),openBillMinusHeaderOpen:br(openBill-totalNotPaid),openFormulaMinusHeaderOpen:br(openFormula-totalNotPaid),allBillMinusHeaderTotal:br(allBill-totalBills),allFormulaMinusHeaderTotal:br(allFormula-totalBills),effectiveMinusHeaderTotal:br(allEffective-totalBills)},paymentDiffRows,paymentMatchesFormula,paymentMissingPaid,largestPaymentDiffs:largestDiffs.slice(0,20)};
 },{sessionTimeoutMs:58_000});
 console.log("KOPER_PAYABLE_VALUE_FORMULA",JSON.stringify(result));
}catch(error:unknown){console.error("KOPER_PAYABLE_VALUE_FORMULA_FAILED",JSON.stringify({message:error instanceof Error?error.message.slice(0,1000):"unknown"}));}
await import("./index.js");
