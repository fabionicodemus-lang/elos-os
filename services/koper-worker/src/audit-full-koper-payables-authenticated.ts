import type { Response } from "playwright-core";
import { performKoperLogin } from "./auth/koper-auto-login.js";
import { withBrowserless } from "./browser/browserless.js";
import { isAllowedFlowSwitch } from "./diagnostics/inspect-koper-engineering.js";
import { selectFlow } from "./diagnostics/collect-flow-stock-requests.js";

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null => typeof v === "object" && v !== null && !Array.isArray(v) ? v as Json : null;
const num = (v: unknown): number => Number.isFinite(Number(v)) ? Number(v) : 0;
const has = (v: unknown): boolean => v !== null && v !== undefined && String(v).trim() !== "";
const cents = (v: unknown): number => Math.round((num(v) + Number.EPSILON) * 100);

try {
  const result = await withBrowserless(async ({ page }) => {
    const login = await performKoperLogin(page);
    if (!login.authenticated) return { ok: false, message: login.message };
    let blockedWrites = 0;
    await page.route("**/*", async (route) => {
      const request = route.request();
      try {
        const url = new URL(request.url());
        const koper = url.hostname === "koper.com.br" || url.hostname.endsWith(".koper.com.br");
        if (koper && !["GET", "HEAD", "OPTIONS"].includes(request.method()) && !isAllowedFlowSwitch(url, request.method(), request.postData())) {
          blockedWrites += 1; await route.abort("blockedbyclient"); return;
        }
      } catch {}
      await route.continue();
    });
    if (!await selectFlow(page)) return { ok: false, message: "FLOW_NOT_SELECTED", blockedWrites };

    const seedPromise = page.waitForResponse((response: Response) => {
      try { const u = new URL(response.url()); return response.request().method() === "GET" && u.hostname === "api.koper.com.br" && u.pathname === "/financial/v1/bills_to_pay"; } catch { return false; }
    }, { timeout: 20_000 }).catch(() => null);
    await page.goto("https://app.koper.com.br/financeiro/contas_pagar", { waitUntil: "domcontentloaded", timeout: 12_000 }).catch(() => undefined);
    const seed = await seedPromise;
    if (!seed) return { ok: false, message: "SEED_NOT_FOUND", blockedWrites };

    const seedHeaders = seed.request().headers();
    const headers: Record<string, string> = {};
    for (const key of ["accept", "origin", "referer", "x-accesstoken", "x-koper"]) if (seedHeaders[key]) headers[key] = seedHeaders[key];
    const base = new URL(seed.url());
    const rows: Json[] = [];
    const pageSize = 500;
    let expectedCount = 0, expectedTotalCents = 0, pages = 0;

    for (let offset = 0; offset < 10000; offset += pageSize) {
      const u = new URL(base);
      for (const [k,v] of Object.entries({ allBills:"yes", initialDate:"", finalDate:"", limit:String(pageSize), offset:String(offset), orderFlag:"asc", orderby:"dueDate", typeDate:"dueDate", cb:String(Date.now()) })) u.searchParams.set(k,v);
      const response = await page.request.get(u.toString(), { headers, timeout: 8_000 });
      if (!response.ok()) return { ok:false, message:"PAGE_FAILED", status:response.status(), offset, pages, blockedWrites };
      const body = obj(await response.json().catch(() => null));
      if (!body) return { ok:false, message:"INVALID_BODY", offset, pages, blockedWrites };
      const pageRows = Array.isArray(body.bills) ? body.bills.map(obj).filter((v):v is Json=>Boolean(v)) : [];
      if (pages === 0) { expectedCount = num(body.billsAmount); expectedTotalCents = cents(body.totalBills); }
      rows.push(...pageRows); pages += 1;
      if (!pageRows.length || rows.length >= expectedCount || pageRows.length < pageSize) break;
    }

    const byId = new Map<string, Json>();
    const duplicateIds: string[] = [];
    for (const row of rows) {
      const id = has(row.billId) ? String(row.billId) : "";
      if (!id) continue;
      if (byId.has(id)) duplicateIds.push(id); else byId.set(id,row);
    }
    const bills = [...byId.values()];
    let sumCents=0, paidCents=0, openCents=0, paidCount=0, openCount=0;
    const refs={invoiceOnly:0,receiptOnly:0,invoiceAndReceipt:0,neither:0,father:0,joined:0,tax:0,split:0,recurring:0};
    const maxIds:number[]=[];
    for (const row of bills) {
      const v=cents(row.billValue); sumCents+=v;
      if(row.isPaid===true){paidCount++;paidCents+=v}else{openCount++;openCents+=v}
      const inv=has(row.invoiceNumber),rec=has(row.receiptNumber);
      if(inv&&rec)refs.invoiceAndReceipt++;else if(inv)refs.invoiceOnly++;else if(rec)refs.receiptOnly++;else refs.neither++;
      if(has(row.fatherBillId))refs.father++; if(has(row.joinBillId))refs.joined++; if(has(row.taxId))refs.tax++; if(row.splitted===true)refs.split++; if(row.hasRecurrence===true)refs.recurring++;
      const id=num(row.billId); if(id>0)maxIds.push(id);
    }
    maxIds.sort((a,b)=>b-a);
    const highestBills=maxIds.slice(0,12).map(id=>{
      const row=byId.get(String(id))!;
      return {billId:id,billToPayId:row.billToPayId??null,billValue:num(row.billValue),dueDate:row.dueDate??null,isPaid:row.isPaid??null,invoiceNumber:row.invoiceNumber??null,receiptNumber:row.receiptNumber??null,recTypeId:row.recTypeId??null};
    });

    return {
      ok:bills.length===expectedCount && sumCents===expectedTotalCents,
      readOnly:true, blockedWrites,
      source:{pages,fetchedRows:rows.length,uniqueBillIds:bills.length,duplicateBillIds:duplicateIds.length,headerRows:expectedCount,headerTotal:expectedTotalCents/100,summedBillValue:sumCents/100,amountDifference:(sumCents-expectedTotalCents)/100},
      status:{paidCount,openCount,paidAmount:paidCents/100,openAmount:openCents/100},
      references:refs,
      highestBills
    };
  }, { sessionTimeoutMs:58_000 });
  console.log("KOPER_FULL_PAYABLE_AUTH_AUDIT", JSON.stringify(result));
} catch(error:unknown){console.error("KOPER_FULL_PAYABLE_AUTH_AUDIT_FAILED",JSON.stringify({message:error instanceof Error?error.message.slice(0,1000):"unknown"}));}
await import("./index.js");
