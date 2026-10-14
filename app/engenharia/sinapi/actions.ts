"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { parseSinapiWorkbook } from "@/lib/preconstruction/sinapi-parser";
import { requireCompanyPermission } from "@/lib/workspace";

const PATH = "/engenharia/sinapi";
function go(message: string, type: "success" | "error" = "success", catalog?: string) {
  const params = new URLSearchParams({ [type]: message });
  if (catalog) params.set("catalog", catalog);
  redirect(`${PATH}?${params.toString()}`);
}
function text(formData: FormData, key: string) { return String(formData.get(key) ?? "").trim(); }
function stableSourceId(code: string, kind: "input" | "service" | "aux" = "input") { return `SINAPI:${kind.toUpperCase()}:${code}`; }
function engineeringCode(code: string, prefix = "SINAPI") { return `${prefix}-${code}`.slice(0, 80); }
function mapCategory(value: string | null | undefined) {
  const normalized = String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
  if (/MAO|TRABALHO|OPERARIO|SERVENTE|PEDREIRO/.test(normalized)) return "labor";
  if (/EQUIP|MAQUINA|FERRAMENTA/.test(normalized)) return "equipment";
  if (/FRETE|TRANSPORTE/.test(normalized)) return "freight";
  if (/SERVICO/.test(normalized)) return "service";
  return "material";
}
async function insertBatches<T extends Record<string, unknown>>(
  supabase: Awaited<ReturnType<typeof requireCompanyPermission>>["supabase"],
  table: string,
  rows: T[],
  batchSize = 500,
) {
  for (let index = 0; index < rows.length; index += batchSize) {
    const { error } = await supabase.from(table).insert(rows.slice(index, index + batchSize));
    if (error) throw new Error(error.message);
  }
}

async function catalogMetadata(
  supabase: Awaited<ReturnType<typeof requireCompanyPermission>>["supabase"],
  companyId: string,
  catalogId: string,
) {
  const { data } = await supabase.from("engineering_reference_catalogs")
    .select("competence, state_code, burden_type")
    .eq("id", catalogId).eq("company_id", companyId).maybeSingle();
  return data;
}

async function saveSinapiPrice({
  supabase,
  companyId,
  userId,
  inputId,
  catalogId,
  unitPrice,
  forceAdopt,
}: {
  supabase: Awaited<ReturnType<typeof requireCompanyPermission>>["supabase"];
  companyId: string;
  userId: string;
  inputId: string;
  catalogId: string;
  unitPrice: number;
  forceAdopt: boolean;
}) {
  if (!(unitPrice > 0)) return;
  const catalog = await catalogMetadata(supabase, companyId, catalogId);
  const priceDate = catalog ? `${catalog.competence}-01` : new Date().toISOString().slice(0, 10);
  const notes = catalog ? `${catalog.state_code} · ${catalog.competence} · ${catalog.burden_type}` : "SINAPI";
  const { data: adopted } = await supabase.from("engineering_input_prices").select("id")
    .eq("company_id", companyId).eq("input_id", inputId).is("project_id", null)
    .eq("is_adopted", true).eq("status", "active").maybeSingle();
  const shouldAdopt = forceAdopt || !adopted;
  if (forceAdopt && adopted) {
    const { error } = await supabase.from("engineering_input_prices").update({ is_adopted: false, updated_at: new Date().toISOString() })
      .eq("id", adopted.id).eq("company_id", companyId);
    if (error) throw new Error(error.message);
  }
  const { data: existing } = await supabase.from("engineering_input_prices").select("id, is_adopted")
    .eq("company_id", companyId).eq("input_id", inputId).is("project_id", null)
    .eq("price_date", priceDate).eq("source", "SINAPI").eq("status", "active").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (existing) {
    const { error } = await supabase.from("engineering_input_prices").update({
      unit_price: unitPrice,
      is_adopted: shouldAdopt || existing.is_adopted,
      notes,
      updated_at: new Date().toISOString(),
    }).eq("id", existing.id).eq("company_id", companyId);
    if (error) throw new Error(error.message);
    return;
  }
  const { error } = await supabase.from("engineering_input_prices").insert({
    company_id: companyId,
    input_id: inputId,
    price_date: priceDate,
    unit_price: unitPrice,
    is_adopted: shouldAdopt,
    source: "SINAPI",
    notes,
    created_by: userId,
  });
  if (error) throw new Error(error.message);
}

async function findOrCreateSinapiInput({
  supabase,
  companyId,
  userId,
  sourceCode,
  description,
  unit,
  category,
  auxiliary = false,
}: {
  supabase: Awaited<ReturnType<typeof requireCompanyPermission>>["supabase"];
  companyId: string;
  userId: string;
  sourceCode: string;
  description: string;
  unit: string;
  category?: string | null;
  auxiliary?: boolean;
}) {
  const normalizedSourceCode = auxiliary ? `AUX:${sourceCode}` : sourceCode;
  const { data: existing } = await supabase.from("engineering_inputs").select("id")
    .eq("company_id", companyId).eq("source_system", "SINAPI").eq("source_code", normalizedSourceCode).maybeSingle();
  if (existing) return existing.id as string;

  const preferredCode = auxiliary ? engineeringCode(sourceCode, "SINAPI-AUX") : sourceCode;
  const { data: collision } = await supabase.from("engineering_inputs").select("id")
    .eq("company_id", companyId).eq("code", preferredCode).maybeSingle();
  const code = collision ? engineeringCode(sourceCode, auxiliary ? "SINAPI-AUX-I" : "SINAPI-I") : preferredCode;
  const { data: inserted, error } = await supabase.from("engineering_inputs").insert({
    company_id: companyId,
    code,
    description,
    unit: unit || "un",
    category: auxiliary ? "service" : mapCategory(category),
    source_system: "SINAPI",
    source_code: normalizedSourceCode,
    source_id: stableSourceId(sourceCode, auxiliary ? "aux" : "input"),
    notes: auxiliary ? "Composição auxiliar SINAPI tratada como insumo de serviço no catálogo Elos." : "Referência técnica SINAPI.",
    created_by: userId,
  }).select("id").single();
  if (error || !inserted) throw new Error(error?.message ?? "Não foi possível copiar o insumo SINAPI.");
  return inserted.id as string;
}

export async function importSinapiWorkbook(formData: FormData) {
  const competence = text(formData, "competence");
  const stateCode = text(formData, "state_code").toUpperCase();
  const burdenType = text(formData, "burden_type") || "NAO_INFORMADO";
  const file = formData.get("file");
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(competence) || !/^[A-Z]{2}$/.test(stateCode) || !["DESONERADO", "NAO_DESONERADO", "NAO_INFORMADO"].includes(burdenType)) {
    go("Revise competência, UF e regime da referência.", "error");
  }
  if (!(file instanceof File) || file.size === 0) go("Selecione uma planilha XLSX.", "error");
  if (file.size > 20 * 1024 * 1024) go("A planilha deve ter no máximo 20 MB.", "error");
  if (!file.name.toLowerCase().endsWith(".xlsx")) go("Use uma planilha XLSX da referência SINAPI.", "error");

  const { supabase, companyId, userId } = await requireCompanyPermission("inputs.manage");
  const parsed = await parseSinapiWorkbook(await file.arrayBuffer());
  if (!parsed.inputs.length && !parsed.compositions.length) go("Não consegui identificar abas de insumos ou composições na planilha.", "error");
  const allPrices = [...parsed.inputs.map((row) => row.unitPrice), ...parsed.compositions.map((row) => row.totalCost)];
  const positive = allPrices.filter((value) => value > 0).length;
  const pricesStatus = positive === 0 ? "zeroed" : positive === allPrices.length ? "available" : "partial";

  const { data: catalog, error: catalogError } = await supabase.from("engineering_reference_catalogs").upsert({
    company_id: companyId,
    source: "SINAPI",
    competence,
    state_code: stateCode,
    burden_type: burdenType,
    prices_status: pricesStatus,
    source_file: file.name,
    notes: parsed.sheets.length ? `Abas reconhecidas: ${parsed.sheets.join(", ")}` : null,
    imported_by: userId,
    imported_at: new Date().toISOString(),
  }, { onConflict: "company_id,source,competence,state_code,burden_type" }).select("id").single();
  if (catalogError || !catalog) go(catalogError?.message ?? "Não foi possível registrar a competência.", "error");

  const catalogId = catalog.id as string;
  const { data: oldCompositions, error: oldError } = await supabase.from("engineering_reference_compositions").select("id")
    .eq("company_id", companyId).eq("catalog_id", catalogId);
  if (oldError) go(oldError.message, "error", catalogId);
  const oldIds = (oldCompositions ?? []).map((row) => row.id);
  if (oldIds.length) {
    const { error } = await supabase.from("engineering_reference_composition_items").delete()
      .eq("company_id", companyId).in("composition_id", oldIds);
    if (error) go(error.message, "error", catalogId);
  }
  const clearResults = await Promise.all([
    supabase.from("engineering_reference_inputs").delete().eq("company_id", companyId).eq("catalog_id", catalogId),
    supabase.from("engineering_reference_compositions").delete().eq("company_id", companyId).eq("catalog_id", catalogId),
  ]);
  const clearError = clearResults.find((item) => item.error)?.error;
  if (clearError) go(clearError.message, "error", catalogId);

  try {
    await insertBatches(supabase, "engineering_reference_inputs", parsed.inputs.map((row) => ({
      company_id: companyId, catalog_id: catalogId, source_code: row.code, description: row.description,
      unit: row.unit, category: row.category, unit_price: row.unitPrice, raw_data: row.raw,
    })));
    await insertBatches(supabase, "engineering_reference_compositions", parsed.compositions.map((row) => ({
      company_id: companyId, catalog_id: catalogId, source_code: row.code, description: row.description,
      unit: row.unit, total_cost: row.totalCost, raw_data: row.raw,
    })));
    const { data: referenceCompositions, error: referenceError } = await supabase.from("engineering_reference_compositions")
      .select("id, source_code").eq("company_id", companyId).eq("catalog_id", catalogId);
    if (referenceError) throw new Error(referenceError.message);
    const compositionIdByCode = new Map((referenceCompositions ?? []).map((row) => [row.source_code, row.id]));
    const analyticRows = parsed.compositionItems.flatMap((row, index) => {
      const compositionId = compositionIdByCode.get(row.compositionCode);
      if (!compositionId) return [];
      return [{
        company_id: companyId, composition_id: compositionId, item_type: row.itemType, item_code: row.itemCode,
        description: row.description, unit: row.unit, coefficient: row.coefficient, unit_price: row.unitPrice,
        subtotal: row.subtotal, sort_order: index + 1,
      }];
    });
    await insertBatches(supabase, "engineering_reference_composition_items", analyticRows);
  } catch (error) {
    go(error instanceof Error ? error.message : "Falha ao importar as linhas da referência.", "error", catalogId);
  }

  revalidatePath(PATH);
  go(`${parsed.inputs.length} insumo(s), ${parsed.compositions.length} composição(ões) e ${parsed.compositionItems.length} item(ns) analítico(s) importados.`, "success", catalogId);
}

export async function adoptSinapiInput(formData: FormData) {
  const catalogId = text(formData, "catalog_id");
  const referenceId = text(formData, "reference_id");
  const { supabase, companyId, userId } = await requireCompanyPermission("inputs.manage");
  const { data: reference, error: referenceError } = await supabase.from("engineering_reference_inputs")
    .select("id, catalog_id, source_code, description, unit, category, unit_price")
    .eq("id", referenceId).eq("company_id", companyId).maybeSingle();
  if (referenceError || !reference || reference.catalog_id !== catalogId) go("Insumo SINAPI não localizado.", "error", catalogId);
  try {
    const inputId = await findOrCreateSinapiInput({
      supabase, companyId, userId, sourceCode: reference.source_code, description: reference.description,
      unit: reference.unit, category: reference.category,
    });
    await saveSinapiPrice({ supabase, companyId, userId, inputId, catalogId, unitPrice: Number(reference.unit_price), forceAdopt: true });
  } catch (error) {
    go(error instanceof Error ? error.message : "Não foi possível copiar o insumo.", "error", catalogId);
  }
  revalidatePath(PATH);
  revalidatePath("/engenharia/insumos");
  revalidatePath("/engenharia/precos");
  go("Insumo copiado para a base técnica da empresa. Quando havia preço válido, esta competência foi adotada como referência.", "success", catalogId);
}

export async function adoptSinapiComposition(formData: FormData) {
  const catalogId = text(formData, "catalog_id");
  const referenceId = text(formData, "reference_id");
  const { supabase, companyId, userId } = await requireCompanyPermission("services.manage");
  const { data: reference, error: referenceError } = await supabase.from("engineering_reference_compositions")
    .select("id, catalog_id, source_code, description, unit, total_cost")
    .eq("id", referenceId).eq("company_id", companyId).maybeSingle();
  if (referenceError || !reference || reference.catalog_id !== catalogId) go("Composição SINAPI não localizada.", "error", catalogId);

  try {
    const { data: existingService } = await supabase.from("engineering_services").select("id")
      .eq("company_id", companyId).eq("source_system", "SINAPI").eq("source_id", stableSourceId(reference.source_code, "service")).maybeSingle();
    let serviceId = existingService?.id as string | undefined;
    if (!serviceId) {
      const { data: bySourceCode } = await supabase.from("engineering_services").select("id")
        .eq("company_id", companyId).eq("source_system", "SINAPI").eq("source_id", stableSourceId(reference.source_code, "service")).maybeSingle();
      serviceId = bySourceCode?.id as string | undefined;
    }
    if (!serviceId) {
      const { data: collision } = await supabase.from("engineering_services").select("id")
        .eq("company_id", companyId).eq("code", reference.source_code).maybeSingle();
      const { data: inserted, error } = await supabase.from("engineering_services").insert({
        company_id: companyId,
        code: collision ? engineeringCode(reference.source_code) : reference.source_code,
        description: reference.description,
        unit: reference.unit,
        default_method: "unit",
        source_system: "SINAPI",
        source_id: stableSourceId(reference.source_code, "service"),
        notes: "Composição técnica copiada da biblioteca SINAPI. A competência de preços permanece no histórico de cotações.",
        created_by: userId,
      }).select("id").single();
      if (error || !inserted) throw new Error(error?.message ?? "Não foi possível copiar a composição.");
      serviceId = inserted.id as string;
    }

    let { data: composition } = await supabase.from("engineering_service_compositions").select("id")
      .eq("company_id", companyId).eq("service_id", serviceId).maybeSingle();
    if (!composition) {
      const { data: inserted, error } = await supabase.from("engineering_service_compositions")
        .insert({ company_id: companyId, service_id: serviceId, notes: "Importada do SINAPI", created_by: userId })
        .select("id").single();
      if (error || !inserted) throw new Error(error?.message ?? "Não foi possível criar a composição técnica.");
      composition = inserted;
    }

    const { data: analytic, error: analyticError } = await supabase.from("engineering_reference_composition_items")
      .select("item_type, item_code, description, unit, coefficient, unit_price")
      .eq("company_id", companyId).eq("composition_id", reference.id).order("sort_order");
    if (analyticError) throw new Error(analyticError.message);

    for (const row of analytic ?? []) {
      const refInput = row.item_type === "input"
        ? (await supabase.from("engineering_reference_inputs").select("description, unit, category, unit_price")
            .eq("company_id", companyId).eq("catalog_id", catalogId).eq("source_code", row.item_code).maybeSingle()).data
        : null;
      const inputId = await findOrCreateSinapiInput({
        supabase,
        companyId,
        userId,
        sourceCode: row.item_code,
        description: refInput?.description || row.description || `${row.item_type === "composition" ? "Composição auxiliar" : "Insumo"} SINAPI ${row.item_code}`,
        unit: refInput?.unit || row.unit || "un",
        category: refInput?.category,
        auxiliary: row.item_type === "composition",
      });
      const referencePrice = Number(refInput?.unit_price ?? row.unit_price ?? 0);
      await saveSinapiPrice({
        supabase, companyId, userId, inputId, catalogId, unitPrice: referencePrice, forceAdopt: false,
      });
      const { error: itemError } = await supabase.from("engineering_service_composition_items").upsert({
        company_id: companyId,
        composition_id: composition.id,
        input_id: inputId,
        coefficient: Math.max(0.00000001, Number(row.coefficient || 1)),
        waste_percentage: 0,
        notes: `SINAPI ${row.item_code}`,
        status: "active",
        created_by: userId,
        updated_at: new Date().toISOString(),
      }, { onConflict: "composition_id,input_id" });
      if (itemError) throw new Error(itemError.message);
    }
  } catch (error) {
    go(error instanceof Error ? error.message : "Não foi possível copiar a composição SINAPI.", "error", catalogId);
  }

  revalidatePath(PATH);
  revalidatePath("/engenharia/servicos");
  revalidatePath("/engenharia/insumos");
  revalidatePath("/engenharia/precos");
  go("Composição copiada para o catálogo técnico. Referências de preço SINAPI foram preservadas sem substituir preços próprios já adotados.", "success", catalogId);
}