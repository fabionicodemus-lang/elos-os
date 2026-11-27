import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSicrediSandboxConnector, createSantanderSandboxConnector } from "../../lib/collections/bank-sandbox/connector.mjs";
import { createSandboxJournal, createSandboxTransport } from "../../lib/collections/bank-sandbox/common.mjs";

const reply = (status, payload) => ({ status, bytes: Buffer.from(JSON.stringify(payload)), headers: {} });
const codes = bank => {
  const barcode = `${bank}91` + "1234" + "0000010000" + "1234567890123456789012345";
  const free = barcode.slice(19);
  const line = barcode.slice(0,4) + free.slice(0,5) + "0" + free.slice(5,15) + "0" + free.slice(15) + "0" + barcode[4] + barcode.slice(5,19);
  return { barcode, line };
};
const fixture = provider => {
  const scope = { provider, environment:"sandbox", test_only:true, company_id:"company-test", project_id:"project-test", legal_entity_id:"spe-test", bank_account_id:"bank-test", config_id:"config-test", agreement:provider === "sicredi"?"01234":"000123456", beneficiary_cnpj:"00000000000000", bank_code:provider === "sicredi"?"748":"033", document_kind:"OUTROS", ...(provider === "sicredi" ? {cooperative:"0101",post:"02"} : {workspace_id:"sandbox-workspace"}) };
  return { scope, charge:{...scope, id:"collection-test", amount:"100.00", due_date:"2026-12-15", account_snapshot:{bank:scope.bank_code}}, payer:{test_only:true,document:"00000000000",name:"PAGADOR FICTICIO",address:"Rua de Teste, 1",neighborhood:"Centro",city:"Teste",state:"SC",zip:"00000000"}, reservation:{bankNumber:provider === "sicredi"?"260000001":"0000000000001", customerRef:"TESTE01",externalRef:"ELOS-TESTE-01",nsuCode:"NSU01",issueDate:"2026-11-26"} };
};
const memoryJournal = () => { const seen=new Set(); return { async claim(a) { const key=`${a.scope.provider}:${a.scope.agreement}:${a.operation}:${a.bankNumber}`; if(seen.has(key))return false; seen.add(key);return true; } }; };

function sicrediMock(f,{timeout=false,wrong=false}={}) {
  let registered=false, cancelled=false;
  const requests=[];
  const c=codes("748");
  const transport=async req => {
    requests.push(req);
    if(req.path.includes("/auth/")) return reply(200,{access_token:"TEST-TOKEN",expires_in:300});
    if(req.path.includes("/pdf?")) return {status:201,bytes:Buffer.from("%PDF-1.4 sandbox fixture")};
    if(req.method==="POST") { registered=true; if(timeout)throw new Error("timeout");return reply(201,{nossoNumero:f.reservation.bankNumber}); }
    if(req.method==="PATCH") { cancelled=true;return reply(202,{transactionId:"test"}); }
    if(!registered)return reply(404,{});
    return reply(200,{nossoNumero:f.reservation.bankNumber,seuNumero:f.reservation.customerRef,idTituloEmpresa:f.reservation.externalRef,valorNominal:wrong?101:100,dataVencimento:f.charge.due_date,pagador:{documento:f.payer.document},situacao:cancelled?"BAIXADO POR SOLICITACAO":"EM CARTEIRA",linhaDigitavel:c.line,codigoBarras:c.barcode});
  };
  return { requests, transport };
}
const sicrediCredentials={apiKey:"TEST-KEY",username:"012340101",accessCode:"TEST-PASSWORD"};
const santanderCredentials={clientId:"TEST-ID",clientSecret:"TEST-SECRET"};

test("Sicredi authenticates, registers exact beneficiary, verifies GET and retrieves PDF",async()=>{
  const f=fixture("sicredi"), mock=sicrediMock(f), bank=createSicrediSandboxConnector({scope:f.scope,credentials:sicrediCredentials,journal:memoryJournal(),transport:mock.transport});
  const result=await bank.register(f.charge,f.payer,f.reservation);
  assert.equal(result.status,"registered_at_bank");assert.equal(result.identifier,f.reservation.bankNumber);
  const post=mock.requests.find(r=>r.method==="POST" && r.path.endsWith("/boletos"));
  assert.equal(new URLSearchParams(mock.requests[0].body).get("grant_type"),"password");
  assert.equal(post.headers.cooperativa,"0101");assert.equal(post.headers.posto,"02");
  assert.equal(JSON.parse(post.body).codigoBeneficiario,"01234");assert.equal(JSON.parse(post.body).valor,100);
  assert.equal((await bank.pdf(f.charge,f.payer,f.reservation)).mimeType,"application/pdf");
  assert.equal((await bank.register(f.charge,f.payer,f.reservation)).status,"registered_at_bank");
  assert.equal(mock.requests.filter(r=>r.method==="POST" && r.path.endsWith("/boletos")).length,1);
  assert.equal((await bank.cancel(f.charge,f.payer,f.reservation)).status,"cancelled");
});

test("a timeout never causes a second registration; exact GET can recover",async()=>{
  const f=fixture("sicredi"), mock=sicrediMock(f,{timeout:true}), bank=createSicrediSandboxConnector({scope:f.scope,credentials:sicrediCredentials,journal:memoryJournal(),transport:mock.transport});
  assert.equal((await bank.register(f.charge,f.payer,f.reservation)).status,"pending_review");
  assert.equal((await bank.register(f.charge,f.payer,f.reservation)).status,"registered_at_bank");
  assert.equal(mock.requests.filter(r=>r.method==="POST" && r.path.endsWith("/boletos")).length,1);
});

test("unknown timeout plus 404 stays reserved; no blind resend", async()=>{
 const f=fixture("sicredi");let posts=0;
 const bank=createSicrediSandboxConnector({scope:f.scope,credentials:sicrediCredentials,journal:memoryJournal(),transport:async r=>{
   if(r.path.includes("/auth/"))return reply(200,{access_token:"token",expires_in:300});if(r.method==="POST"){posts++;throw new Error("timeout");}return reply(404,{});
 }});
 assert.equal((await bank.register(f.charge,f.payer,f.reservation)).status,"pending_review");
 assert.equal((await bank.register(f.charge,f.payer,f.reservation)).status,"pending_review");assert.equal(posts,1);
});

test("mismatched values and tenant, SPE, account, environment are blocked",async()=>{
 const f=fixture("sicredi"),mock=sicrediMock(f,{wrong:true}),bank=createSicrediSandboxConnector({scope:f.scope,credentials:sicrediCredentials,journal:memoryJournal(),transport:mock.transport});
 for(const key of ["company_id","project_id","legal_entity_id","bank_account_id","config_id","agreement"]) await assert.rejects(bank.register({...f.charge,[key]:"different"},f.payer,f.reservation),/fora do escopo/);
 assert.equal(mock.requests.length,0);
 await assert.rejects(bank.register(f.charge,f.payer,f.reservation),/diverge/);
 assert.throws(()=>createSicrediSandboxConnector({scope:{...f.scope,environment:"production"},credentials:sicrediCredentials,journal:memoryJournal(),transport:mock.transport}),/sandbox/);
 assert.throws(()=>createSandboxTransport("santander"),/mTLS/);
 await assert.rejects(createSandboxTransport("sicredi")({method:"GET",path:"/cobranca/boleto/v1/boletos"}),/sandbox/);
 await assert.rejects(createSandboxTransport("sicredi")({method:"GET",path:"/sb/../cobranca/boleto/v1/boletos"}),/sandbox/);
});

test("Santander uses OAuth client credentials, workspace, TESTE and verified title; no production PDF",async()=>{
 const f=fixture("santander"),c=codes("033"); let registered=false, lowered=false; const requests=[];
 const bank=createSantanderSandboxConnector({scope:f.scope,credentials:santanderCredentials,journal:memoryJournal(),transport:async r=>{
  requests.push(r);
  if(r.path.includes("/auth/"))return reply(200,{access_token:"token",expires_in:300});
  if(r.method==="POST"){registered=true;return reply(200,{});}
  if(r.method==="PATCH"){lowered=true;return reply(200,{});}
  if(r.path.includes("tipoConsulta=settlement"))return reply(200,{observacao:"retorno de teste"});
  if(!registered)return reply(404,{});
  return reply(200,{_content:[{beneficiaryCode:f.scope.agreement,bankNumber:f.reservation.bankNumber,clientNumber:f.reservation.customerRef,nominalValue:100,dueDate:f.charge.due_date,status:lowered?"Baixado":"Ativo",payer:{documentNumber:f.payer.document},digitableLine:c.line,barCode:c.barcode}]});
 }});
 assert.equal((await bank.register(f.charge,f.payer,f.reservation)).status,"registered_at_bank");
 const post=requests.find(r=>r.path.endsWith("/bank_slips")&&r.method==="POST");assert.ok(post.path.includes(f.scope.workspace_id));
 assert.equal(JSON.parse(post.body).environment,"TESTE");assert.equal(JSON.parse(post.body).nominalValue,"100.00");assert.equal(post.headers["X-Application-Key"],"TEST-ID");
 assert.equal(new URLSearchParams(requests[0].body).get("grant_type"),"client_credentials");
 assert.equal((await bank.pdf(f.charge,f.payer,f.reservation)).status,"pending_review");
 assert.equal((await bank.settlement(f.charge,f.payer,f.reservation)).requiresReconciliation,true);
 assert.equal((await bank.cancel(f.charge,f.payer,f.reservation)).status,"pending_review");
 assert.equal((await bank.query(f.charge,f.payer,f.reservation)).bankStatus,"BAIXADO");
});

test("journal claims survive restart and concurrent claims conflict", async()=>{
 const directory=await mkdtemp(join(tmpdir(),"elos-bank-test-"));const journal=createSandboxJournal(directory);const f=fixture("sicredi");
 const claim={scope:f.scope,chargeId:f.charge.id,bankNumber:f.reservation.bankNumber,operation:"registration",fingerprint:"synthetic"};
 const results=await Promise.all([journal.claim(claim),journal.claim(claim)]);assert.deepEqual(results.sort(),[false,true]);
 assert.equal(await createSandboxJournal(directory).claim(claim),false);
 assert.equal(await createSandboxJournal(directory).claim({...claim,chargeId:"other-charge"}),false);
 assert.equal(await createSandboxJournal(directory).claim({...claim,bankNumber:"260000002"}),false);
});
