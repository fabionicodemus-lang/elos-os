import test from "node:test";
import assert from "node:assert/strict";
import { MAX_REQUEST_BYTES, assertImportOrigin, readImportFormData } from "../../lib/eobra-import/request.mjs";

const URL = "https://example.com/api/imports/eobra/stage";

test("multipart import rejects missing and foreign origins", () => {
  assert.doesNotThrow(() => assertImportOrigin(new Request(URL, { headers: { origin: "https://example.com" } })));
  for (const origin of [undefined, "https://other.example.com", "http://example.com", "null"]) {
    assert.throws(() => assertImportOrigin(new Request(URL, { headers: origin ? { origin } : {} })), { status: 403 });
  }
  assert.throws(() => assertImportOrigin(new Request(URL, { headers: { origin: "https://example.com", "content-length": String(MAX_REQUEST_BYTES + 1) } })), { status: 413 });
});

test("bounded multipart reader preserves an actual file and the displayed company", async () => {
  const form = new FormData();
  form.set("company_id", "displayed-company");
  form.set("file", new Blob(["id;nome\n0001;Exemplo"], { type: "text/csv" }), "fornecedores.csv");
  const parsed = await readImportFormData(new Request(URL, { method: "POST", body: form }));
  assert.equal(parsed.get("company_id"), "displayed-company");
  assert.equal(parsed.get("file").name, "fornecedores.csv");
  assert.equal(await parsed.get("file").text(), "id;nome\n0001;Exemplo");
});

test("streamed upload is stopped at the limit without trusting Content-Length", async () => {
  for (const claimedLength of [undefined, "1"]) {
    let cancelled = false;
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(2 * 1024 * 1024));
        controller.enqueue(new Uint8Array(2 * 1024 * 1024));
        controller.enqueue(new Uint8Array(200_001));
      },
      cancel() { cancelled = true; },
    });
    const headers = { "content-type": "multipart/form-data; boundary=test" };
    if (claimedLength) headers["content-length"] = claimedLength;
    await assert.rejects(readImportFormData(new Request(URL, { method: "POST", headers, body, duplex: "half" })), { status: 413 });
    assert.equal(cancelled, true);
  }
});

test("malformed or wrong-type form does not expose multipart parser internals", async () => {
  await assert.rejects(readImportFormData(new Request(URL, { method: "POST", body: "garbage" })), /formulário/);
  await assert.rejects(readImportFormData(new Request(URL, { method: "POST", headers: { "content-type": "multipart/form-data; boundary=absent" }, body: "garbage" })), /Selecione o arquivo novamente/);
});
