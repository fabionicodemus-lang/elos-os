import test from "node:test";
import assert from "node:assert/strict";
import { collectionDocumentMessage, runCollectionCycle } from "../../lib/collections/worker.mjs";

test("direct document payload has issuer, unit, project, amount and date; no portal", () => {
 const payload=collectionDocumentMessage({collection:{beneficiary_name:"SPE Teste",beneficiary_cnpj:"11222333000181",amount:1000,due_date:"2026-12-01",document_ref:"private/test.pdf"},message:{id:"m",purpose:"d-1",recipient:"teste@example.invalid",sender:"financeiro@example.invalid",channel:"email"},context:{project:"Obra A",unit:"101",installment:"Mensal 2"}});
 assert.equal(payload.filename,"boleto.pdf");assert.equal(payload.documentRef,"private/test.pdf");assert.equal(payload.to,"teste@example.invalid");
 for(const text of ["SPE Teste","Obra A","101","Mensal 2","1.000,00","01/12/2026","amanhã"]) assert.ok(payload.text.includes(text));
 assert.equal(payload.text.includes("http"),false);
});

test("worker refuses missing adapter", async () => {
 await assert.rejects(runCollectionCycle({db:null,configId:"test",adapter:null}),/homologado/);
});
