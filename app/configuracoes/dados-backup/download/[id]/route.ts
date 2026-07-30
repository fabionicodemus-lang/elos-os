import { NextResponse } from "next/server";
import { resolveActiveWorkspace } from "@/lib/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const { supabase, companyId, roleKey } = await resolveActiveWorkspace();
  const privileged = roleKey === "owner" || roleKey === "admin";

  if (!privileged) {
    const checks = await Promise.all([
      supabase.rpc("has_company_permission", { target_company_id: companyId, target_permission: "admin.data.view" }),
      supabase.rpc("has_company_permission", { target_company_id: companyId, target_permission: "admin.data.export" }),
      supabase.rpc("has_company_permission", { target_company_id: companyId, target_permission: "admin.data.manage" }),
    ]);
    if (!checks.some((result) => result.data === true)) {
      return NextResponse.json({ error: "Sem permissão para baixar este pacote." }, { status: 403 });
    }
  }

  const { data: record, error } = await supabase
    .from("system_data_exports")
    .select("id, status, storage_path, file_name, expires_at")
    .eq("id", id)
    .eq("company_id", companyId)
    .maybeSingle();

  if (error || !record) {
    return NextResponse.json({ error: error?.message ?? "Pacote não localizado." }, { status: 404 });
  }
  if (record.status !== "ready" || !record.storage_path || new Date(record.expires_at).getTime() <= Date.now()) {
    return NextResponse.json({ error: "O pacote não está mais disponível." }, { status: 410 });
  }

  const { data: signed, error: signedError } = await supabase.storage
    .from("system-backups")
    .createSignedUrl(record.storage_path, 90, { download: record.file_name || true });
  if (signedError || !signed?.signedUrl) {
    return NextResponse.json({ error: signedError?.message ?? "Não foi possível autorizar o download." }, { status: 500 });
  }

  await supabase.rpc("system_log_data_export_download", { p_export_id: id });
  return NextResponse.redirect(signed.signedUrl, 302);
}
