"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { decryptCertificatePassword, distributeDfe, encryptCertificatePassword } from "@/lib/sefaz-dfe";
import { requireCompanyPermission } from "@/lib/workspace";
import { importElectronicInvoice } from "./actions";

const PATH = "/financeiro/notas-eletronicas";
function text(formData: FormData, key: string) { return String(formData.get(key) ?? "").trim(); }
function url(message: string, type: "success" | "error") { return `${PATH}?${new URLSearchParams({ [type]: message })}`; }
function cleanFileName(value: string) { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9_.-]+/g, "-").slice(0, 120) || "certificado.pfx"; }

export async function saveSefazConnection(formData: FormData) {
  const { supabase, companyId, projectId, userId } = await requireCompanyPermission("finance.invoices.manage");
  if (!projectId) redirect(url("Selecione uma obra antes de configurar a SEFAZ.", "error"));
  const project = await supabase.from("projects").select("legal_entity_id").eq("company_id", companyId).eq("id", projectId).maybeSingle();
  if (!project.data?.legal_entity_id) redirect(url("Vincule uma SPE ao empreendimento antes de configurar a SEFAZ.", "error"));
  const entity = await supabase.from("legal_entities").select("id,cnpj,state").eq("company_id", companyId).eq("id", project.data.legal_entity_id).maybeSingle();
  const taxId = String(entity.data?.cnpj ?? "").replace(/\D/g, "");
  if (taxId.length !== 14) redirect(url("Cadastre o CNPJ completo da SPE.", "error"));
  const state = text(formData, "state") || String(entity.data?.state ?? "");
  const stateCodes: Record<string, string> = { AC:"12",AL:"27",AP:"16",AM:"13",BA:"29",CE:"23",DF:"53",ES:"32",GO:"52",MA:"21",MT:"51",MS:"50",MG:"31",PA:"15",PB:"25",PR:"41",PE:"26",PI:"22",RJ:"33",RN:"24",RS:"43",RO:"11",RR:"14",SC:"42",SP:"35",SE:"28",TO:"17" };
  const stateCode = stateCodes[state.toUpperCase()];
  if (!stateCode) redirect(url("Informe a UF válida da SPE.", "error"));
  const certificate = formData.get("certificate");
  const password = text(formData, "password");
  const environment = text(formData, "environment") === "homologation" ? "homologation" : "production";
  if (!(certificate instanceof File) || certificate.size <= 0) redirect(url("Selecione o certificado A1 .pfx ou .p12.", "error"));
  if (certificate.size > 10 * 1024 * 1024) redirect(url("O certificado excede 10 MB.", "error"));
  if (!/\.(pfx|p12)$/i.test(certificate.name)) redirect(url("O certificado precisa ser A1 no formato .pfx ou .p12.", "error"));
  if (!password) redirect(url("Informe a senha do certificado A1.", "error"));
  let encryptedPassword: string;
  try { encryptedPassword = encryptCertificatePassword(password); }
  catch (error) { redirect(url(error instanceof Error ? error.message : "Falha ao proteger a senha do certificado.", "error")); }
  const bytes = Buffer.from(await certificate.arrayBuffer());
  const hash = createHash("sha256").update(Array.from(bytes).join(",")).digest("hex");
  const storagePath = `${companyId}/${entity.data!.id}/${environment}/${hash.slice(0, 16)}-${cleanFileName(certificate.name)}`;
  const upload = await supabase.storage.from("sefaz-certificates").upload(storagePath, bytes, { contentType: "application/x-pkcs12", upsert: true });
  if (upload.error) redirect(url(upload.error.message, "error"));
  const existing = await supabase.from("finance_sefaz_connections").select("id,certificate_storage_path").eq("company_id", companyId).eq("legal_entity_id", entity.data!.id).eq("environment", environment).maybeSingle();
  const saved = await supabase.from("finance_sefaz_connections").upsert({
    company_id: companyId,
    legal_entity_id: entity.data!.id,
    environment,
    state_code: stateCode,
    tax_id: taxId,
    certificate_storage_path: storagePath,
    certificate_file_name: cleanFileName(certificate.name),
    certificate_password_encrypted: encryptedPassword,
    status: "active",
    updated_by: userId,
    created_by: userId,
    updated_at: new Date().toISOString(),
  }, { onConflict: "company_id,legal_entity_id,environment" }).select("id").single();
  if (saved.error) {
    await supabase.storage.from("sefaz-certificates").remove([storagePath]);
    redirect(url(saved.error.message, "error"));
  }
  if (existing.data?.certificate_storage_path && existing.data.certificate_storage_path !== storagePath) await supabase.storage.from("sefaz-certificates").remove([existing.data.certificate_storage_path]);
  revalidatePath(PATH);
  redirect(url("Certificado A1 configurado. A conexão já pode consultar os documentos destinados à SPE.", "success"));
}

export async function syncSefazDocuments(formData: FormData) {
  const { supabase, companyId, projectId, userId } = await requireCompanyPermission("finance.invoices.manage");
  if (!projectId) redirect(url("Selecione uma obra.", "error"));
  const project = await supabase.from("projects").select("legal_entity_id").eq("company_id", companyId).eq("id", projectId).maybeSingle();
  if (!project.data?.legal_entity_id) redirect(url("O empreendimento não possui SPE vinculada.", "error"));
  const environment = text(formData, "environment") === "homologation" ? "homologation" : "production";
  const connectionResult = await supabase.from("finance_sefaz_connections").select("*").eq("company_id", companyId).eq("legal_entity_id", project.data.legal_entity_id).eq("environment", environment).neq("status", "inactive").maybeSingle();
  if (!connectionResult.data) redirect(url("Configure o certificado A1 antes de sincronizar.", "error"));
  const connection = connectionResult.data;
  const log = await supabase.from("finance_sefaz_sync_logs").insert({ company_id: companyId, legal_entity_id: connection.legal_entity_id, connection_id: connection.id, start_nsu: connection.last_nsu, status: "running", created_by: userId }).select("id").single();
  let successMessage = "Sincronização concluída.";
  try {
    const certificate = await supabase.storage.from("sefaz-certificates").download(connection.certificate_storage_path);
    if (certificate.error || !certificate.data) throw new Error(certificate.error?.message ?? "Certificado não encontrado no armazenamento privado.");
    const response = await distributeDfe({ environment, stateCode: connection.state_code, taxId: connection.tax_id, lastNsu: connection.last_nsu, pfx: Buffer.from(await certificate.data.arrayBuffer()), passphrase: decryptCertificatePassword(connection.certificate_password_encrypted) });
    let fullCount = 0;
    for (const document of response.documents) {
      let storagePath: string | null = null;
      if (document.isFullXml) {
        fullCount += 1;
        const safeKey = document.accessKey || `nsu-${document.nsu}`;
        storagePath = `${companyId}/${connection.legal_entity_id}/${environment}/${safeKey}-${document.nsu}.xml`;
        const upload = await supabase.storage.from("sefaz-dfe").upload(storagePath, Buffer.from(document.xml, "utf8"), { contentType: "application/xml", upsert: true });
        if (upload.error) throw new Error(upload.error.message);
      }
      const inserted = await supabase.from("finance_sefaz_documents").upsert({
        company_id: companyId, legal_entity_id: connection.legal_entity_id, connection_id: connection.id, nsu: document.nsu,
        schema_name: document.schema, access_key: document.accessKey, issuer_tax_id: document.issuerTaxId, issuer_name: document.issuerName,
        issue_datetime: document.issueDateTime, total_amount: document.totalAmount, sefaz_document_status: document.documentStatus,
        document_kind: document.isFullXml ? "full_xml" : document.schema.toLowerCase().includes("evento") ? "event" : "summary",
        xml_storage_path: storagePath, raw_summary: { schema: document.schema, status: document.documentStatus }, updated_at: new Date().toISOString(),
      }, { onConflict: "connection_id,nsu,schema_name", ignoreDuplicates: false });
      if (inserted.error && inserted.error.code !== "23505") throw new Error(inserted.error.message);
    }
    await supabase.from("finance_sefaz_connections").update({ last_nsu: response.lastNsu, max_nsu: response.maxNsu, last_sync_at: new Date().toISOString(), last_status_code: response.statusCode, last_status_message: response.statusMessage, status: "active", updated_by: userId, updated_at: new Date().toISOString() }).eq("id", connection.id);
    if (log.data?.id) await supabase.from("finance_sefaz_sync_logs").update({ finished_at: new Date().toISOString(), final_nsu: response.lastNsu, max_nsu: response.maxNsu, status_code: response.statusCode, status_message: response.statusMessage, documents_received: response.documents.length, full_xml_received: fullCount, status: "success" }).eq("id", log.data.id);
    successMessage = `${response.documents.length} documento(s) recebido(s) da SEFAZ; ${fullCount} XML(s) completo(s) disponível(is).`;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha inesperada ao consultar a SEFAZ.";
    await supabase.from("finance_sefaz_connections").update({ status: "error", last_sync_at: new Date().toISOString(), last_status_message: message, updated_by: userId, updated_at: new Date().toISOString() }).eq("id", connection.id);
    if (log.data?.id) await supabase.from("finance_sefaz_sync_logs").update({ finished_at: new Date().toISOString(), status: "error", error_message: message }).eq("id", log.data.id);
    redirect(url(message, "error"));
  }
  revalidatePath(PATH);
  redirect(url(successMessage, "success"));
}

export async function importSefazDocument(formData: FormData) {
  const documentId = text(formData, "document_id");
  const { supabase, companyId, projectId } = await requireCompanyPermission("finance.invoices.manage");
  if (!projectId) redirect(url("Selecione uma obra.", "error"));
  const document = await supabase.from("finance_sefaz_documents").select("id,legal_entity_id,access_key,xml_storage_path,processing_status").eq("company_id", companyId).eq("id", documentId).maybeSingle();
  if (!document.data?.xml_storage_path) redirect(url("Este registro ainda não possui o XML completo liberado pela SEFAZ.", "error"));
  if (document.data.processing_status === "imported") redirect(url("Este documento já foi importado.", "error"));
  const project = await supabase.from("projects").select("legal_entity_id").eq("company_id", companyId).eq("id", projectId).maybeSingle();
  if (project.data?.legal_entity_id !== document.data.legal_entity_id) redirect(url("Selecione uma obra vinculada à SPE destinatária desta NF-e.", "error"));
  const downloaded = await supabase.storage.from("sefaz-dfe").download(document.data.xml_storage_path);
  if (downloaded.error || !downloaded.data) redirect(url(downloaded.error?.message ?? "XML não encontrado.", "error"));
  const importData = new FormData();
  importData.set("xml_file", new File([await downloaded.data.arrayBuffer()], `${document.data.access_key || document.data.id}.xml`, { type: "application/xml" }));
  importData.set("create_supplier", "1");
  importData.set("items_json", "[]");
  importData.set("installments_json", "[]");
  importData.set("sefaz_document_id", document.data.id);
  await importElectronicInvoice(importData);
}
