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
 *   KOPER_TOOL=reconcile          confere os títulos da obra alvo: Elos OS × Koper (leitura)
 *   KOPER_TOOL=payable-corrections lista, título a título, o que diverge do Koper e a
 *                                 correção proposta (leitura; não grava)
 *   KOPER_TOOL=payable-cancel     cancela (status `cancelled`, sem apagar) os títulos da lista
 *                                 aprovada pelo Fábio que não existem mais no Koper
 *   KOPER_TOOL=budget             promove o orçamento (acompanhamento do Koper) da obra alvo
 *   KOPER_TOOL=allocations        promove o rateio dos títulos por serviço da obra alvo
 *   KOPER_TOOL=budget,allocations várias ferramentas, em ordem
 *   KOPER_TOOL_TARGET=alma|flow   obra alvo
 *   KOPER_ALLOC_LIMIT=5           piloto (rateio ou cancelamento): nº de títulos gravados
 */
import { pathToFileURL } from "node:url";

const write = process.env.KOPER_TOOL_WRITE === "true";
const tools = (process.env.KOPER_TOOL ?? "chain-audit").split(",").map((item) => item.trim()).filter(Boolean);

export async function runTool(tool: string) {
  const { parseTarget } = await import("./mirror-shared.js");
  const target = parseTarget(process.env.KOPER_TOOL_TARGET);
  console.log("KOPER_TOOL_START", JSON.stringify({ tool, target, write }));
  if (tool === "chain-audit") {
    const { auditAppropriationChain } = await import("./audit-mirror-appropriation-chain.js");
    await auditAppropriationChain(["bossa", "flow", "alma"]);
  } else if (tool === "inspect-elos") {
    const { inspectElos } = await import("./inspect-elos-allocation-base.js");
    await inspectElos();
  } else if (tool === "reconcile") {
    const { reconcilePayables } = await import("./reconcile-mirror-payables.js");
    await reconcilePayables({ target });
  } else if (tool === "payable-corrections") {
    const { planPayableCorrections } = await import("./plan-payable-corrections.js");
    await planPayableCorrections({ target });
  } else if (tool === "payable-cancel") {
    const { cancelMissingPayables } = await import("./cancel-missing-payables.js");
    const limit = Math.max(0, Number(process.env.KOPER_ALLOC_LIMIT ?? "0") || 0);
    await cancelMissingPayables({ write, target, limit });
  } else if (tool === "budget") {
    const { promoteMirrorBudget } = await import("./promote-mirror-budget.js");
    await promoteMirrorBudget({ write, target });
  } else if (tool === "allocations") {
    const { promoteMirrorAllocations } = await import("./promote-mirror-allocations.js");
    const limit = Math.max(0, Number(process.env.KOPER_ALLOC_LIMIT ?? "0") || 0);
    await promoteMirrorAllocations({ write, target, limit });
  } else {
    throw new Error(`KOPER_TOOL_UNKNOWN_${tool}`);
  }
  console.log("KOPER_TOOL_DONE", JSON.stringify({ tool, target, write }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  (async () => {
    // Várias ferramentas separadas por vírgula rodam em ordem; a primeira falha interrompe.
    for (const tool of tools) await runTool(tool);
  })().catch((error: unknown) => {
    console.error("KOPER_TOOL_FAILED", JSON.stringify({ tools, message: error instanceof Error ? error.message.slice(0, 800) : String(error).slice(0, 800) }));
    process.exitCode = 1;
  });
}
