import type { ElosIaActionToolContext } from "./action-tools";

export type DocumentActionType = "commercial_sale_create" | "procurement_quotation_create" | "execution_contract_create";

/** Enable only after the document migrations and the homologation checklist. */
export function elosIaDocumentActionsEnabled() {
  return process.env.ELOS_IA_DOCUMENT_ACTIONS_ENABLED?.trim().toLowerCase() === "true";
}

export function isDocumentActionType(value: string): value is DocumentActionType {
  return ["commercial_sale_create", "procurement_quotation_create", "execution_contract_create"].includes(value);
}

export async function createDocumentProposal(context: ElosIaActionToolContext, input: {
  projectId: string;
  actionType: DocumentActionType;
  title: string;
  summary: string;
  payload: Record<string, unknown>;
  preview: Record<string, unknown>;
  sourceFile: string;
  documentKey: string;
}): Promise<{ id: string; title: string; summary: string }> {
  const matches = context.attachmentNames.filter((name) => name === input.sourceFile);
  if (matches.length !== 1) throw new Error("Anexe o documento de origem e informe seu nome exato. Para corrigir um rascunho, descarte o cartão anterior e reenvie o documento com o ajuste.");
  const result = await context.supabase.rpc("ai_prepare_document_action", {
    p_company_id: context.companyId,
    p_project_id: input.projectId,
    p_turn_id: context.turnId,
    p_persona: context.persona,
    p_action_type: input.actionType,
    p_title: input.title,
    p_summary: input.summary,
    p_payload: input.payload,
    p_preview: { ...input.preview, kind: input.actionType, sourceFile: input.sourceFile },
    p_file_name: input.sourceFile,
    p_document_key: input.documentKey,
  });
  if (result.error || !result.data) throw new Error(result.error?.message || "Não foi possível preparar o documento para revisão.");
  const row = result.data as { id?: string; title?: string; summary?: string };
  if (!row.id) throw new Error("O rascunho não retornou uma identificação válida.");
  return { id: row.id, title: row.title ?? input.title, summary: row.summary ?? input.summary };
}
