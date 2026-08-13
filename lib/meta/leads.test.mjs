import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  verifyMetaSignature,
  extractLeadEvents,
  fetchMetaLeadDetails,
  parseLeadFieldData,
  normalizePhone,
} from "./leads.mjs";

const APP_SECRET = "test-app-secret";

function sign(body, secret = APP_SECRET) {
  const digest = crypto.createHmac("sha256", secret).update(body, "utf8").digest("hex");
  return `sha256=${digest}`;
}

test("verifyMetaSignature aceita assinatura válida", () => {
  const body = JSON.stringify({ object: "page" });
  assert.equal(verifyMetaSignature(body, sign(body), APP_SECRET), true);
});

test("verifyMetaSignature rejeita assinatura de outro segredo", () => {
  const body = JSON.stringify({ object: "page" });
  assert.equal(verifyMetaSignature(body, sign(body, "outro-segredo"), APP_SECRET), false);
});

test("verifyMetaSignature rejeita corpo adulterado", () => {
  const signature = sign(JSON.stringify({ object: "page" }));
  assert.equal(verifyMetaSignature(JSON.stringify({ object: "hack" }), signature, APP_SECRET), false);
});

test("verifyMetaSignature rejeita header ausente ou mal formado", () => {
  const body = "{}";
  assert.equal(verifyMetaSignature(body, null, APP_SECRET), false);
  assert.equal(verifyMetaSignature(body, "md5=abc", APP_SECRET), false);
  assert.equal(verifyMetaSignature(body, sign(body), ""), false);
});

test("extractLeadEvents coleta eventos de leadgen de todas as entradas", () => {
  const payload = {
    object: "page",
    entry: [
      {
        changes: [
          { field: "leadgen", value: { leadgen_id: "L1", form_id: "F1", ad_id: "A1", page_id: "P1" } },
          { field: "messages", value: { leadgen_id: "IGNORAR" } },
        ],
      },
      { changes: [{ field: "leadgen", value: { leadgen_id: "L2" } }] },
    ],
  };
  const events = extractLeadEvents(payload);
  assert.equal(events.length, 2);
  assert.deepEqual(events[0], { leadgenId: "L1", formId: "F1", adId: "A1", pageId: "P1", createdTime: undefined });
  assert.equal(events[1].leadgenId, "L2");
});

test("extractLeadEvents ignora payloads que não são de página ou sem leadgen_id", () => {
  assert.deepEqual(extractLeadEvents(null), []);
  assert.deepEqual(extractLeadEvents({ object: "user", entry: [] }), []);
  assert.deepEqual(
    extractLeadEvents({ object: "page", entry: [{ changes: [{ field: "leadgen", value: {} }] }] }),
    [],
  );
});

test("parseLeadFieldData extrai campos conhecidos e preserva todas as respostas", () => {
  const parsed = parseLeadFieldData([
    { name: "full_name", values: ["Maria Silva"] },
    { name: "email", values: ["maria@exemplo.com"] },
    { name: "phone_number", values: ["+55 11 99999-8888"] },
    { name: "mensagem", values: ["Tenho interesse no Flow Aptos"] },
    { name: "projeto", values: ["Flow Aptos"] },
  ]);
  assert.equal(parsed.nome, "Maria Silva");
  assert.equal(parsed.email, "maria@exemplo.com");
  assert.equal(parsed.telefoneBruto, "+55 11 99999-8888");
  assert.equal(parsed.mensagem, "Tenho interesse no Flow Aptos");
  assert.equal(parsed.respostas["projeto"], "Flow Aptos");
});

test("parseLeadFieldData compõe nome a partir de first_name/last_name", () => {
  const parsed = parseLeadFieldData([
    { name: "first_name", values: ["João"] },
    { name: "last_name", values: ["Pereira"] },
  ]);
  assert.equal(parsed.nome, "João Pereira");
});

test("parseLeadFieldData lida com field_data vazio", () => {
  const parsed = parseLeadFieldData();
  assert.deepEqual(parsed, {
    nome: null,
    email: null,
    telefoneBruto: null,
    mensagem: null,
    respostas: {},
  });
});

test("normalizePhone converte número brasileiro para E.164", () => {
  assert.equal(normalizePhone("(11) 99999-8888"), "+5511999998888");
  assert.equal(normalizePhone("+55 11 99999-8888"), "+5511999998888");
});

test("normalizePhone devolve dígitos limpos quando não valida", () => {
  assert.equal(normalizePhone("abc 12-34"), "1234");
  assert.equal(normalizePhone(null), null);
  assert.equal(normalizePhone(""), null);
});

test("fetchMetaLeadDetails consulta a Graph API e normaliza field_data ausente", async () => {
  let calledUrl;
  const fetchImpl = async (url) => {
    calledUrl = url;
    return { ok: true, json: async () => ({ id: "L1", ad_id: "A1" }) };
  };
  const details = await fetchMetaLeadDetails("L1", "token-123", { fetchImpl });
  assert.equal(details.id, "L1");
  assert.deepEqual(details.field_data, []);
  assert.ok(String(calledUrl).includes("/L1"));
  assert.ok(String(calledUrl).includes("access_token=token-123"));
});

test("fetchMetaLeadDetails lança erro em resposta não-ok", async () => {
  const fetchImpl = async () => ({ ok: false, status: 400, text: async () => "erro" });
  await assert.rejects(() => fetchMetaLeadDetails("L1", "token", { fetchImpl }), /HTTP 400/);
});
