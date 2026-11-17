import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolveElosIaAccess } from "@/lib/elos-ia/server";
import { loadElosIaActionProposal } from "@/lib/elos-ia/action-executor";
import { ELOS_IA_ATTACHMENT_BUCKET } from "@/lib/elos-ia/attachments";

function error(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status, headers: { "cache-control": "no-store" } });
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ proposalId: string }> }) {
  const client = await createClient();
  const auth = await client.auth.getClaims();
  if (auth.error || typeof auth.data?.claims?.sub !== "string") return error("Sua sessão expirou.", 401);
  const access = await resolveElosIaAccess();
  if (!access.allowed) return error("Você não tem acesso à Elos IA.", 403);
  const { proposalId } = await params;
  const proposal = await loadElosIaActionProposal(access.workspace.supabase, access.workspace.companyId, proposalId);
  if (!proposal) return error("Documento não encontrado nesta empresa.", 404);
  if (!access.can(proposal.required_permission)) return error("Você não tem permissão para consultar este documento.", 403);
  const files = await access.workspace.supabase.from("ai_action_attachments")
    .select("storage_path,file_name").eq("company_id", access.workspace.companyId).eq("proposal_id", proposalId).limit(2);
  if (files.error || files.data?.length !== 1) return error("O documento original não está disponível.", 404);
  const signed = await access.workspace.supabase.storage.from(ELOS_IA_ATTACHMENT_BUCKET).createSignedUrl(files.data[0].storage_path, 60);
  if (signed.error || !signed.data?.signedUrl) return error("Não foi possível abrir o documento.", 409);
  return NextResponse.redirect(signed.data.signedUrl, { status: 307, headers: { "cache-control": "no-store", "referrer-policy": "no-referrer" } });
}
