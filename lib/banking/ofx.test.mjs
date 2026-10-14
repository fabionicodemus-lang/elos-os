import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
const source = ts.transpileModule(
  readFileSync(new URL("./ofx.ts", import.meta.url), "utf8"),
  {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
const { parseOfx, suggestMatches } = await import(
  "data:text/javascript;base64," + Buffer.from(source).toString("base64")
);
const row = (id = "1", value = "-123.45", date = "20261013000000[-3:BRT]") =>
  `<STMTTRN><DTPOSTED>${date}<TRNAMT>${value}<FITID>${id}<MEMO>Fornecedor &amp; Cia</STMTTRN>`;
const file = (rows = row()) =>
  `OFXHEADER:100\n<OFX><STMTRS><CURDEF>BRL<BANKACCTFROM><BANKID>748<ACCTID>12345</BANKACCTFROM><BANKTRANLIST>${rows}</BANKTRANLIST></STMTRS></OFX>`;
test("SGML preserves signed amount, civil date and FITID", () => {
  const p = parseOfx(file());
  assert.equal(p.entries[0].amount, -123.45);
  assert.equal(p.entries[0].transaction_date, "2026-10-13");
  assert.equal(p.entries[0].description, "Fornecedor & Cia");
});
test("duplicate identical FITID collapses; conflicting duplicate rejected", () => {
  assert.equal(parseOfx(file(row() + row())).entries.length, 1);
  assert.throws(() => parseOfx(file(row() + row("1", "-1.00"))));
});
test("rejects invalid dates, ambiguous money, missing identity and entities", () => {
  for (const value of [
    file(row("1", "1,20")),
    file(row("1", "2.00", "20260230")),
    file(row("", "1")),
    '<!ENTITY a "bad">' + file(),
  ])
    assert.throws(() => parseOfx(value));
});
test("suggestions respect direction, cents and date window", () => {
  const e = parseOfx(file()).entries[0];
  const c = (id, direction, amount, date) => ({
    id,
    direction,
    amount,
    transaction_date: date,
    description: "x",
  });
  assert.deepEqual(
    suggestMatches(e, [
      c("yes", "debit", 123.45, "2026-10-14"),
      c("wrong", "credit", 123.45, "2026-10-13"),
      c("old", "debit", 123.45, "2026-09-01"),
      c("value", "debit", 123.46, "2026-10-13"),
    ]).map((x) => x.id),
    ["yes"],
  );
});

test("XML bank statements and incomplete transaction rejection", () => {
  const xml = file()
    .replace("<CURDEF>BRL", "<CURDEF>BRL</CURDEF>")
    .replace("<BANKID>748", "<BANKID>748</BANKID>")
    .replace("<ACCTID>12345", "<ACCTID>12345</ACCTID>");
  assert.equal(parseOfx(xml).entries.length, 1);
  assert.throws(
    () => parseOfx(file(row() + "<STMTTRN><FITID>unfinished")),
    /incompletos/,
  );
  assert.throws(() => parseOfx(file().replace("BRL", "USD")), /BRL/);
  assert.throws(
    () => parseOfx(file().replace("</OFX>", "<STMTRS></STMTRS></OFX>")),
    /única conta/,
  );
});
