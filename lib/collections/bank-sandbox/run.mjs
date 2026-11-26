// Explicit, isolated homologation CLI. Never uses the Elos database, never sends
// email/WhatsApp and never selects production. Load secrets from server env.
import { readFile } from "node:fs/promises";
import { createSicrediSandboxConnector, createSantanderSandboxConnector } from "./connector.mjs";
import { createSandboxJournal, required } from "./common.mjs";

async function main() {
  const action = process.argv[2] ?? "query";
  if (!["query", "register", "cancel", "pdf", "settlement"].includes(action)) throw new Error("Operação de homologação inválida.");
  const fixturePath = required(process.env.ELOS_BANK_TEST_FIXTURE, "ELOS_BANK_TEST_FIXTURE");
  const journalPath = required(process.env.ELOS_BANK_TEST_JOURNAL, "ELOS_BANK_TEST_JOURNAL");
  const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
  if (fixture.scope?.environment !== "sandbox" || fixture.scope.test_only !== true || fixture.charge?.test_only !== true || fixture.payer?.test_only !== true) throw new Error("O arquivo deve conter somente dados de homologação.");
  const journal = createSandboxJournal(journalPath);
  let bank;
  if (fixture.scope.provider === "sicredi") {
    bank = createSicrediSandboxConnector({ scope: fixture.scope, journal, credentials: { apiKey: process.env.ELOS_SICREDI_TEST_API_KEY, accessCode: process.env.ELOS_SICREDI_TEST_ACCESS_CODE, username: process.env.ELOS_SICREDI_TEST_USERNAME } });
  } else if (fixture.scope.provider === "santander") {
    const pfxPath = required(process.env.ELOS_SANTANDER_TEST_PFX_PATH, "certificado PFX de sandbox");
    bank = createSantanderSandboxConnector({ scope: fixture.scope, journal, credentials: { clientId: process.env.ELOS_SANTANDER_TEST_CLIENT_ID, clientSecret: process.env.ELOS_SANTANDER_TEST_CLIENT_SECRET, tls: { pfx: await readFile(pfxPath), passphrase: process.env.ELOS_SANTANDER_TEST_PFX_PASSPHRASE } } });
  } else throw new Error("Banco não suportado.");
  const result = await bank[action](fixture.charge, fixture.payer, fixture.reservation);
  // Do not log bank payloads, document bytes, identifiers or personal data.
  process.stdout.write(JSON.stringify({ environment: "sandbox", provider: bank.provider, operation: action, status: result?.status ?? (result?.requiresReconciliation ? "evidence_for_reconciliation" : "not_found"), documentBytes: result?.bytes?.length ?? undefined, requiresReconciliation: result?.requiresReconciliation ?? undefined }) + "\n");
}

main().catch(() => { process.stderr.write("Falha na homologação; confira configuração e resultado com o banco antes de repetir. Nenhum payload foi registrado no log.\n"); process.exitCode = 1; });
