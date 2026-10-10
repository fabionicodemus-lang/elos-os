/**
 * Rotina diária do espelho Koper → Elos OS.
 *
 * 1. Atualiza a staging `mirror.*` das três empresas (só relê detalhe do que é novo ou mudou).
 * 2. Promove para `payables` as contas a pagar das empresas Bossa e Alma, nas obras
 *    Escritório Bossa, Soul, Jazz e Alma (o Flow segue em `sync-koper-payables-daily.ts`).
 *
 *   node dist/sync-koper-mirror-daily.js           # grava (uso do cron)
 *   node dist/sync-koper-mirror-daily.js --full    # relê todos os detalhes antes de promover
 *   node dist/sync-koper-mirror-daily.js --plan    # não grava nada: só mostra o que faria
 *
 * A promoção roda mesmo quando o espelho teve falha parcial: ela só cria e dá baixa,
 * nunca apaga, e trabalha com o que já está conferido na staging. O processo sai com
 * erro se qualquer uma das duas etapas falhar, para o Railway acusar a execução.
 */
import { runKoperMirror } from "./mirror-koper.js";
import { promoteMirrorPayables } from "./promote-mirror-payables.js";

const write = !process.argv.includes("--plan");
const full = process.argv.includes("--full");
let failed = false;

try {
  const mirror = await runKoperMirror({ write, full });
  if (!mirror.ok) failed = true;
} catch (error) {
  failed = true;
  console.error("KOPER_MIRROR_FAILED", JSON.stringify({ message: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500) }));
}

try {
  await promoteMirrorPayables({ write, limit: 0 });
} catch (error) {
  failed = true;
  console.error("KOPER_PROMOTE_FAILED", JSON.stringify({ message: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500) }));
}

console.log("KOPER_MIRROR_DAILY_DONE", JSON.stringify({ write, full, ok: !failed }));
if (failed) process.exitCode = 1;
