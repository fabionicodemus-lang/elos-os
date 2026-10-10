/**
 * Ponto de entrada único do serviço Railway `koper-mirror-tools`.
 *
 * O comando do serviço fica fixo (`node dist/tools.js`); a ferramenta é escolhida pela
 * variável `KOPER_TOOL` e a gravação só acontece com `KOPER_TOOL_WRITE=true`. Assim um
 * push qualquer na branch nunca grava nada por acidente: sem a variável, tudo roda em
 * modo plano (somente leitura). Este serviço só fala com o banco do Elos OS: não tem
 * credencial do Koper e nunca chama o Koper (isso é papel do serviço `koper-mirror`).
 *
 *   KOPER_TOOL=chain-audit        mede a cadeia de apropriação (leitura)
 *   KOPER_TOOL=inspect-elos       inspeciona orçamento / serviços / rateios (leitura)
 *   KOPER_TOOL=budget             promove orçamento do Koper para o Elos OS
 *   KOPER_TOOL=allocations        promove o rateio dos títulos por serviço
 *   KOPER_TOOL_TARGET=alma        obra alvo das duas últimas
 */
import { pathToFileURL } from "node:url";

const write = process.env.KOPER_TOOL_WRITE === "true";
const tool = (process.env.KOPER_TOOL ?? "chain-audit").trim();
const target = (process.env.KOPER_TOOL_TARGET ?? "alma").trim().toLowerCase();

export async function runTool() {
  console.log("KOPER_TOOL_START", JSON.stringify({ tool, target, write }));
  if (tool === "chain-audit") {
    const { auditAppropriationChain } = await import("./audit-mirror-appropriation-chain.js");
    await auditAppropriationChain(["bossa", "flow", "alma"]);
  } else if (tool === "inspect-elos") {
    const { inspectElos } = await import("./inspect-elos-allocation-base.js");
    await inspectElos();
  } else {
    throw new Error(`KOPER_TOOL_UNKNOWN_${tool}`);
  }
  console.log("KOPER_TOOL_DONE", JSON.stringify({ tool, target, write }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runTool().catch((error: unknown) => {
    console.error("KOPER_TOOL_FAILED", JSON.stringify({ tool, message: error instanceof Error ? error.message.slice(0, 800) : String(error).slice(0, 800) }));
    process.exitCode = 1;
  });
}
