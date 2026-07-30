import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { requireCompanyPermission } from "@/lib/workspace";
import { SefazImporter } from "../sefaz-importer";

export default async function SefazNfePage({ searchParams }: {
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  const params = await searchParams;
  const { supabase, company, companyId, projectId, roleKey } = await requireCompanyPermission("finance.invoices.view");
  const privileged = roleKey === "owner" || roleKey === "admin";
  const manageResult = privileged ? { data: true, error: null } : await supabase.rpc("has_company_permission", { target_company_id: companyId, target_permission: "finance.invoices.manage" });
  const projectResult = projectId ? await supabase.from("projects").select("id,code,name,legal_entity_id").eq("company_id", companyId).eq("id", projectId).maybeSingle() : { data: null, error: null };
  const project = projectResult.data;
  const entityResult = project?.legal_entity_id ? await supabase.from("legal_entities").select("id,legal_name,trade_name,cnpj,state").eq("company_id", companyId).eq("id", project.legal_entity_id).maybeSingle() : { data: null, error: null };
  const entity = entityResult.data;
  const context = project ? `${project.code ? `${project.code} · ` : ""}${project.name}` : "Selecione uma obra";

  return <AppShell
    activeGroup="finance"
    activeItem="electronic-invoices"
    eyebrow="Financeiro · Documentos fiscais"
    title="Importador NF-e · SEFAZ"
    description={`${company.name} · ${context} · documentos fiscais destinados à SPE pelo Ambiente Nacional da NF-e.`}
    actions={<Link className="elos-button" href="/financeiro/notas-eletronicas">Voltar às notas</Link>}
  >
    {params.success ? <div className="auth-message success workspace-message">{params.success}</div> : null}
    {params.error ? <div className="auth-message error workspace-message">{params.error}</div> : null}
    {!projectId ? <section className="xml-empty-state">Selecione uma obra no topo para consultar a SEFAZ da SPE correspondente.</section> : null}
    {projectId ? <SefazImporter
      legalEntityId={entity?.id ?? null}
      legalEntityName={entity?.trade_name || entity?.legal_name || null}
      legalEntityCnpj={entity?.cnpj ?? null}
      legalEntityState={entity?.state ?? null}
      canManage={manageResult.data === true || privileged}
    /> : null}
  </AppShell>;
}
