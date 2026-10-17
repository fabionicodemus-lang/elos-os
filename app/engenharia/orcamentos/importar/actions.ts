"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { normalizeImportText, parseBudgetWorkbook } from "@/lib/budget-import/parser.mjs";
import { fetchAllRows } from "@/lib/supabase-pagination";
import { requireCompanyPermission } from "@/lib/workspace";

const IMPORT_PATH = "/engenharia/orcamentos/importar";
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const INSERT_CHUNK = 400;

function resultUrl(message: string, type: "error" | "success" = "error") {
  const safe = message.length > 1500 ? `${message.slice(0, 1497)}...` : message;
  return `${IMPORT_PATH}?${new URLSearchParams({ [type]: safe }).toString()}`;
}

function key(value: unknown) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function nameUnit(name: unknown, unit: unknown) {
  return `${normalizeImportText(name)}|${normalizeImportText(unit)}`;
}

type CatalogEntity = { id: string; code: string; description: string; unit: string };
type IntegrationMapping = {
  source_entity_type: string;
  scope: "company" | "project";
  scope_id: string;
  key_kind: string;
  external_key: string;
  target_entity_type: string;
  target_entity_id: string;
};
type MatchResult = {
  target_entity_type: string | null;
  target_entity_id: string | null;
  target_label: string | null;
  match_status: "mapped" | "exact_code" | "exact_name_unit" | "ambiguous" | "new" | "ignored";
  match_method: string | null;
  confidence: number | null;
};

function catalogIndexes(rows: CatalogEntity[]) {
  const byCode = new Map<string, CatalogEntity[]>();
  const byNameUnit = new Map<string, CatalogEntity[]>();
  rows.forEach((row) => {
    const code = String(row.code ?? "").trim().toUpperCase();
    if (code) byCode.set(code, [...(byCode.get(code) ?? []), row]);
    const nk = nameUnit(row.description, row.unit);
    if (nk !== "|") byNameUnit.set(nk, [...(byNameUnit.get(nk) ?? []), row]);
  });
  return { byCode, byNameUnit };
}

function mappedTarget(mappings: IntegrationMapping[], projectId: string, externalCode: string | null, targetType: string, entityTypes: string[]) {
  if (!externalCode) return null;
  const externalKey = key(externalCode);
  const candidates = mappings.filter((mapping) =>
    mapping.target_entity_type === targetType
    && mapping.key_kind === "code"
    && mapping.external_key === externalKey
    && entityTypes.includes(mapping.source_entity_type)
    && (mapping.scope !== "project" || mapping.scope_id === projectId)
  );
  candidates.sort((a, b) => Number(b.scope === "project") - Number(a.scope === "project"));
  return candidates[0] ?? null;
}

function matchEntity(options: {
  projectId: string;
  externalCode: string | null;
  externalName: string | null;
  externalUnit: string | null;
  targetType: "engineering_service" | "engineering_input";
  entityTypes: string[];
  mappings: IntegrationMapping[];
  catalog: CatalogEntity[];
  byCode: Map<string, CatalogEntity[]>;
  byNameUnit: Map<string, CatalogEntity[]>;
}): MatchResult {
  const mapped = mappedTarget(options.mappings, options.projectId, options.externalCode, options.targetType, options.entityTypes);
  if (mapped) {
    const target = options.catalog.find((row) => row.id === mapped.target_entity_id) ?? null;
    if (!target || nameUnit("", target.unit) !== nameUnit("", options.externalUnit)) return {
      target_entity_type: options.targetType, target_entity_id: null,
      target_label: "Vínculo antigo sem cadastro ativo ou com unidade diferente. Revise o equivalente.",
      match_status: "ambiguous", match_method: "stale_mapping", confidence: null,
    };
    return {
      target_entity_type: options.targetType,
      target_entity_id: mapped.target_entity_id,
      target_label: target ? `${target.code} · ${target.description}` : mapped.target_entity_id,
      match_status: "mapped",
      match_method: "integration_map",
      confidence: 100,
    };
  }

  if (options.externalCode) {
    const direct = options.byCode.get(options.externalCode.toUpperCase()) ?? [];
    if (direct.length === 1 && normalizeImportText(direct[0].unit) === normalizeImportText(options.externalUnit)) return {
      target_entity_type: options.targetType,
      target_entity_id: direct[0].id,
      target_label: `${direct[0].code} · ${direct[0].description}`,
      match_status: "exact_code",
      match_method: "catalog_code",
      confidence: 100,
    };
    if (direct.length > 0) return {
      target_entity_type: options.targetType,
      target_entity_id: null,
      target_label: direct.length > 1 ? `${direct.length} cadastros com o mesmo código` : "Código encontrado com unidade diferente",
      match_status: "ambiguous",
      match_method: "catalog_code_collision",
      confidence: null,
    };
  }

  if (options.externalName) {
    const exactName = options.byNameUnit.get(nameUnit(options.externalName, options.externalUnit)) ?? [];
    if (exactName.length === 1) return {
      target_entity_type: options.targetType,
      target_entity_id: exactName[0].id,
      target_label: `${exactName[0].code} · ${exactName[0].description}`,
      match_status: "exact_name_unit",
      match_method: "catalog_name_unit",
      confidence: 98,
    };
    if (exactName.length > 1) return {
      target_entity_type: options.targetType,
      target_entity_id: null,
      target_label: `${exactName.length} cadastros com mesmo nome e unidade`,
      match_status: "ambiguous",
      match_method: "catalog_name_unit_collision",
      confidence: null,
    };
  }

  return {
    target_entity_type: options.targetType,
    target_entity_id: null,
    target_label: null,
    match_status: "new",
    match_method: null,
    confidence: null,
  };
}

export async function stageBudgetImport(formData: FormData) {
  const uploaded = formData.get("file");
  if (!(uploaded instanceof File) || uploaded.size === 0) redirect(resultUrl("Selecione o arquivo XLSX do orçamento."));
  if (!uploaded.name.toLowerCase().endsWith(".xlsx")) redirect(resultUrl("O arquivo precisa estar em formato XLSX."));
  if (uploaded.size > MAX_FILE_SIZE) redirect(resultUrl("O arquivo ultrapassa o limite de 10 MB."));

  const { supabase, companyId, projectId, userId } = await requireCompanyPermission("budgets.manage");
  if (!projectId) redirect(resultUrl("Selecione uma obra antes de importar o orçamento."));

  const bytes = new Uint8Array(await uploaded.arrayBuffer());
  const fileHash = createHash("sha256").update(bytes).digest("hex");
  let parsed;
  try {
    parsed = parseBudgetWorkbook(bytes);
  } catch (error) {
    console.error("budget_import_parse_error", error);
    redirect(resultUrl(error instanceof Error ? error.message : "Não foi possível interpretar o orçamento."));
  }

  const [servicesResult, inputsResult, mappingsResult, duplicateResult] = await Promise.all([
    fetchAllRows<CatalogEntity>(async (from, to) => await supabase.from("engineering_services").select("id,code,description,unit").eq("company_id", companyId).eq("status", "active").order("id").range(from, to)),
    fetchAllRows<CatalogEntity>(async (from, to) => await supabase.from("engineering_inputs").select("id,code,description,unit").eq("company_id", companyId).eq("status", "active").order("id").range(from, to)),
    fetchAllRows<IntegrationMapping>(async (from, to) => await supabase.from("integration_mappings")
      .select("source_entity_type,scope,scope_id,key_kind,external_key,target_entity_type,target_entity_id")
      .eq("company_id", companyId).eq("source_system", parsed.catalog_namespace).eq("status", "confirmed").order("id").range(from, to)),
    supabase.from("engineering_budget_import_batches")
      .select("id,created_at,status").eq("company_id", companyId).eq("project_id", projectId).eq("file_hash", fileHash)
      .order("created_at", { ascending: false }).limit(1),
  ]);

  if (duplicateResult.error) redirect(resultUrl(duplicateResult.error.message));
  const previous = duplicateResult.data?.[0];
  if (previous && !["cancelled", "failed"].includes(previous.status)) {
    redirect(`${IMPORT_PATH}/${previous.id}?${new URLSearchParams({ success: "Este arquivo já foi enviado para esta obra. Continue a revisão do lote existente." })}`);
  }

  if (servicesResult.error) redirect(resultUrl(servicesResult.error.message));
  if (inputsResult.error) redirect(resultUrl(inputsResult.error.message));
  if (mappingsResult.error) redirect(resultUrl(mappingsResult.error.message));

  const services = (servicesResult.data ?? []) as CatalogEntity[];
  const inputs = (inputsResult.data ?? []) as CatalogEntity[];
  const mappings = (mappingsResult.data ?? []) as IntegrationMapping[];
  const serviceIndexes = catalogIndexes(services);
  const inputIndexes = catalogIndexes(inputs);
  let matched = 0;
  let ambiguous = 0;
  let newCount = 0;

  const stagedRows = parsed.rows.map((row) => {
    let match: MatchResult;
    if (row.entity_kind === "group") {
      match = { target_entity_type: null, target_entity_id: null, target_label: null, match_status: "ignored", match_method: "budget_hierarchy", confidence: 100 };
    } else if (row.entity_kind === "service") {
      match = matchEntity({ projectId, externalCode: row.external_code, externalName: row.external_name, externalUnit: row.external_unit,
        targetType: "engineering_service", entityTypes: ["service", "cost_center"], mappings, catalog: services, ...serviceIndexes });
    } else {
      match = matchEntity({ projectId, externalCode: row.external_code, externalName: row.external_name, externalUnit: row.external_unit,
        targetType: "engineering_input", entityTypes: ["input"], mappings, catalog: inputs, ...inputIndexes });
    }

    if (["mapped", "exact_code", "exact_name_unit"].includes(match.match_status)) matched += 1;
    else if (match.match_status === "ambiguous") ambiguous += 1;
    else if (match.match_status === "new") newCount += 1;

    return {
      company_id: companyId, project_id: projectId,
      entity_kind: row.entity_kind, source_sheet: row.source_sheet, source_row: row.source_row, sort_order: row.sort_order,
      source_group_code: row.source_group_code, source_group_name: row.source_group_name,
      source_service_code: row.source_service_code, source_service_name: row.source_service_name,
      external_code: row.external_code, external_name: row.external_name, external_unit: row.external_unit,
      quantity: row.quantity, unit_cost: row.unit_cost, total_cost: row.total_cost,
      coefficient: row.coefficient, raw_coefficient: row.raw_coefficient,
      target_entity_type: match.target_entity_type, target_entity_id: match.target_entity_id, target_label: match.target_label,
      match_status: match.match_status, match_method: match.match_method, confidence: match.confidence,
      payload: row.payload ?? {}, created_by: userId,
    };
  });

  const { data: batch, error: batchError } = await supabase.from("engineering_budget_import_batches").insert({
    company_id: companyId, project_id: projectId, source_system: "xlsx", catalog_namespace: parsed.catalog_namespace,
    parser_key: parsed.parser_key, file_name: uploaded.name, file_hash: fileHash, source_sheet: parsed.source_sheet,
    source_budget_code: parsed.source_budget_code, source_budget_name: parsed.source_budget_name, source_version: parsed.source_version,
    source_reference_date: parsed.source_reference_date, source_area_m2: parsed.source_area_m2, source_total: parsed.source_total,
    status: "review", groups_total: parsed.summary.groups, services_total: parsed.summary.services, inputs_total: parsed.summary.inputs,
    matched_total: matched, suggested_total: 0, ambiguous_total: ambiguous, new_total: newCount,
    metadata: { skipped_zero_services: parsed.summary.skipped_zero_services, skipped_zero_inputs: parsed.summary.skipped_zero_inputs, unique_input_codes: parsed.summary.unique_input_codes, priced_inputs: parsed.summary.priced_inputs,
      previous_batch_id: duplicateResult.data?.[0]?.id ?? null },
    created_by: userId,
  }).select("id").single();

  if (batchError || !batch?.id) redirect(resultUrl(batchError?.message || "Não foi possível criar o lote de staging."));

  for (let index = 0; index < stagedRows.length; index += INSERT_CHUNK) {
    const chunk = stagedRows.slice(index, index + INSERT_CHUNK).map((row) => ({ ...row, batch_id: batch.id }));
    const { error } = await supabase.from("engineering_budget_import_rows").insert(chunk);
    if (error) {
      await supabase.from("engineering_budget_import_batches").delete().eq("id", batch.id).eq("company_id", companyId);
      redirect(resultUrl(`Falha ao gravar staging: ${error.message}`));
    }
  }

  const { error: statusError } = await supabase.from("engineering_budget_import_batches")
    .update({ status: ambiguous + newCount === 0 ? "ready" : "review", updated_at: new Date().toISOString() })
    .eq("id", batch.id).eq("company_id", companyId);
  if (statusError) redirect(`${IMPORT_PATH}/${batch.id}?${new URLSearchParams({ error: statusError.message })}`);
  revalidatePath(IMPORT_PATH);
  redirect(`${IMPORT_PATH}/${batch.id}`);
}

export async function cancelBudgetImport(formData: FormData) {
  const batchId = String(formData.get("batch_id") ?? "").trim();
  if (!batchId) redirect(resultUrl("Lote inválido."));
  const { supabase, companyId } = await requireCompanyPermission("budgets.manage");
  const { error } = await supabase.from("engineering_budget_import_batches")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", batchId).eq("company_id", companyId).neq("status", "promoted");
  if (error) redirect(resultUrl(error.message));
  revalidatePath(IMPORT_PATH);
  redirect(resultUrl("Lote cancelado. Nenhum dado canônico foi alterado.", "success"));
}
