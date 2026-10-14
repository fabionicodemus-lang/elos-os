import { createHash } from "node:crypto";
export type StatementEntry = {
  fit_id: string;
  transaction_date: string;
  amount: number;
  description: string;
};
const tag = (text: string, name: string) =>
  text.match(new RegExp(`<${name}\\s*>\\s*([^<\\r\\n]+)`, "i"))?.[1]?.trim() ??
  "";
const clean = (text: string) =>
  text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
export function parseOfx(text: string) {
  if (Buffer.byteLength(text) > 4_000_000) throw new Error("OFX excede 4 MB.");
  if (!/<OFX[\s>]/i.test(text) || /<!DOCTYPE|<!ENTITY/i.test(text))
    throw new Error("Arquivo OFX inválido.");
  if ((text.match(/<STMTRS[\s>]/gi) ?? []).length !== 1)
    throw new Error("Importe um extrato bancário de uma única conta por vez.");
  const account = tag(text, "ACCTID");
  const bank = tag(text, "BANKID");
  if (!account || tag(text, "CURDEF") !== "BRL")
    throw new Error("Informe extrato de conta em BRL.");
  const blocks = [...text.matchAll(/<STMTTRN\s*>([\s\S]*?)<\/STMTTRN\s*>/gi)];
  if (blocks.length !== (text.match(/<STMTTRN\s*>/gi) ?? []).length)
    throw new Error("OFX contém movimentos incompletos.");
  if (!blocks.length || blocks.length > 10000)
    throw new Error("Extrato vazio ou acima de 10.000 movimentos.");
  const seen = new Map<string, string>();
  const entries: StatementEntry[] = [];
  for (const [, block] of blocks) {
    const rawDate = tag(block, "DTPOSTED").slice(0, 8);
    const date = `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`;
    if (
      !/^\d{8}$/.test(rawDate) ||
      !Number.isFinite(Date.parse(date)) ||
      new Date(date).toISOString().slice(0, 10) !== date
    )
      throw new Error("Data inválida no OFX.");
    const rawAmount = tag(block, "TRNAMT");
    if (!/^-?\d+(\.\d{1,2})?$/.test(rawAmount))
      throw new Error("Valor inválido no OFX.");
    const amount = Number(rawAmount);
    if (!amount || !Number.isSafeInteger(Math.round(amount * 100)))
      throw new Error("Movimento sem valor válido.");
    const fitId = tag(block, "FITID");
    if (!fitId || fitId.length > 200)
      throw new Error("Movimento sem identificador bancário FITID válido.");
    const description =
      clean(
        [tag(block, "NAME"), tag(block, "MEMO")].filter(Boolean).join(" · "),
      ).slice(0, 1000) || "Movimento bancário";
    const entry = {
      fit_id: fitId,
      transaction_date: date,
      amount,
      description,
    };
    const signature = JSON.stringify(entry);
    if (seen.has(fitId)) {
      if (seen.get(fitId) !== signature)
        throw new Error("FITID repetido com dados divergentes.");
      continue;
    }
    seen.set(fitId, signature);
    entries.push(entry);
  }
  return {
    account,
    bank,
    entries,
    sha256: createHash("sha256").update(text).digest("hex"),
  };
}
export function suggestMatches(
  entry: StatementEntry,
  candidates: {
    id: string;
    transaction_date: string;
    amount: number;
    direction: string;
    description: string;
  }[],
) {
  const amount = Math.round(Math.abs(entry.amount) * 100);
  return candidates
    .filter(
      (t) =>
        (entry.amount > 0 ? "credit" : "debit") === t.direction &&
        Math.round(Number(t.amount) * 100) === amount,
    )
    .map((t) => ({
      ...t,
      days:
        Math.abs(
          Date.parse(t.transaction_date) - Date.parse(entry.transaction_date),
        ) / 86400000,
    }))
    .filter((t) => t.days <= 5)
    .sort((a, b) => a.days - b.days)
    .slice(0, 5);
}
