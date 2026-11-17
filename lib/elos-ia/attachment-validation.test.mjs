import { test } from "node:test";
import assert from "node:assert/strict";
import { validateDocumentBytes } from "./attachment-validation.mjs";
const bytes = text => new TextEncoder().encode(text);

test("confere assinaturas reais e recusa binário disfarçado de documento", () => {
  assert.doesNotThrow(() => validateDocumentBytes(bytes("%PDF-1.7\ncontrato"), "application/pdf"));
  assert.doesNotThrow(() => validateDocumentBytes(new Uint8Array([137,80,78,71,13,10,26,10]), "image/png"));
  assert.doesNotThrow(() => validateDocumentBytes(bytes("Descrição;Quantidade\nCimento;100"), "text/csv"));
  assert.throws(() => validateDocumentBytes(bytes("<html>Outra resposta</html>"), "application/pdf"));
  assert.throws(() => validateDocumentBytes(new Uint8Array([1,0,2]), "text/plain"));
  assert.throws(() => validateDocumentBytes(bytes("%PDF-1.7"), "image/jpeg"));
});
