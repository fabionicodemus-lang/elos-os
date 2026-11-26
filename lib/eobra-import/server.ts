import "server-only";

import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { type EntityKind, type ImportRow, ENTITY_KINDS, FIELD_DEFINITIONS, MAX_FILE_BYTES } from "./parser.mjs";
import { isUuid, resolveFinancialRows } from "./resolution.mjs";
import { ImportRequestError } from "./request.mjs";
export { ImportRequestError, assertImportOrigin, readImportFormData } from "./request.mjs";

const PERMISSIONS: Record<EntityKind, string> = {
  supplier: "suppliers.manage", client: "clients.manage", payable: "payables.manage", receivable: "receivables.manage",
};

export function importKind(value: FormDataEntryValue | null): EntityKind {
  const kind = String(value ?? "");
  if (!(ENTITY_KINDS as readonly string[]).includes(kind)) throw new ImportRequestError("Selecione o tipo de dados da importação.");
  return kind as EntityKind;
}

export function importHeaderRow(value: FormDataEntryValue | null) {
  const row = Number(value ?? 1);
  if (!Number.isInteger(row) || row < 1 || row > 50) throw new ImportRequestError("A linha do cabeçalho deve estar entre 1 e 50.");
  return row;
}

export function importMapping(value: FormDataEntryValue | null, kind: EntityKind): Record<string, string> {
  let parsed: unknown;
  try { parsed = JSON.parse(String(value ?? "{}")); } catch { throw new ImportRequestError("O mapeamento de colunas é inválido."); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new ImportRequestError("O mapeamento de colunas é inválido.");
  const allowed = new Set(FIELD_DEFINITIONS[kind].map((field) => field.key));
  const entries = Object.entries(parsed).filter(([, header]) => header !== "" && header !== null);
  if (entries.some(([key, header]) => !allowed.has(key) || typeof header !== "string" || header.length > 300)) {
    throw new ImportRequestError("O mapeamento contém um campo ou cabeçalho não reconhecido.");
  }
  return Object.fromEntries(entries) as Record<string, string>;
}

export async function readImportUpload(form: FormData) {
  const file = form.get("file");
  if (!(file instanceof File) || !file.size) throw new ImportRequestError("Selecione um arquivo CSV ou XLSX.");
  if (file.size > MAX_FILE_BYTES) throw new ImportRequestError("O arquivo excede o limite de 4 MB.", 413);
  if (!/\.(csv|xlsx)$/i.test(file.name)) throw new ImportRequestError("Use uma exportação CSV ou XLSX.");
  return { file, bytes: new Uint8Array(await file.arrayBuffer()) };
}

type Relation = { id: string; name?: string; key?: string; status?: string };
type Membership = { company_id: string; companies: Relation | Relation[] | null; roles: Relation | Relation[] | null };
const first = (relation: Relation | Relation[] | null) => Array.isArray(relation) ? relation[0] : relation;

/** Mirrors the active company selection without accepting a tenant from an upload. */
export async function getImportWorkspace(kind?: EntityKind) {
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getClaims();
  const userId = typeof auth?.claims?.sub === "string" ? auth.claims.sub : "";
  if (authError || !userId) throw new ImportRequestError("Entre no Elos novamente para importar.", 401);
  const cookieStore = await cookies();
  const requestedCompanyId = cookieStore.get("elos_company_id")?.value;
  const membershipResult = await supabase.from("company_memberships")
    .select("company_id,companies(id,name),roles(id,key,status)").eq("user_id", userId).eq("status", "active").order("created_at");
  if (membershipResult.error) throw new ImportRequestError("Não foi possível validar seu ambiente.", 403);
  const memberships = (membershipResult.data ?? []) as unknown as Membership[];
  const membership = requestedCompanyId ? memberships.find((row) => row.company_id === requestedCompanyId) : memberships[0];
  if (!membership || !first(membership.companies) || first(membership.roles)?.status !== "active") {
    throw new ImportRequestError("Seu acesso a uma empresa ativa precisa ser liberado.", 403);
  }
  const companyId = membership.company_id;
  const permissions = ["admin.company.manage", ...(kind ? [PERMISSIONS[kind]] : [])];
  const checks = await Promise.all(permissions.map((permission) =>
    supabase.rpc("has_company_permission", { target_company_id: companyId, target_permission: permission })));
  if (checks.some((check) => check.error || check.data !== true)) {
    throw new ImportRequestError("Você não tem permissão para importar esses dados nesta empresa.", 403);
  }
  return { supabase, companyId, userId };
}

export async function assertImportEntityPermission(workspace: Awaited<ReturnType<typeof getImportWorkspace>>, kind: EntityKind) {
  const result = await workspace.supabase.rpc("has_company_permission", { target_company_id: workspace.companyId, target_permission: PERMISSIONS[kind] });
  if (result.error || result.data !== true) {
    throw new ImportRequestError("Você não tem permissão para importar esses dados nesta empresa.", 403);
  }
}

export async function checkImportProject(workspace: Awaited<ReturnType<typeof getImportWorkspace>>, kind: EntityKind, raw: FormDataEntryValue | null) {
  const projectId = String(raw ?? "").trim();
  if (kind === "supplier" || kind === "client") {
    if (projectId) throw new ImportRequestError("Fornecedores e clientes pertencem à empresa. Deixe a obra vazia neste lote.");
    return null;
  }
  if (!isUuid(projectId)) throw new ImportRequestError("Selecione a obra que corresponde a este arquivo.");
  const result = await workspace.supabase.from("projects").select("id,name,code")
    .eq("company_id", workspace.companyId).eq("id", projectId).neq("status", "archived").maybeSingle();
  if (result.error || !result.data) throw new ImportRequestError("A obra não está disponível nesta empresa.", 403);
  return projectId;
}

/** The form identifies its displayed company only to detect a switch in another tab. */
export function assertImportCompany(companyId: string, displayedCompany: FormDataEntryValue | null) {
  if (displayedCompany !== companyId) {
    throw new ImportRequestError("A empresa selecionada mudou. Atualize a página e confira a empresa antes de enviar o arquivo.", 409);
  }
}

type CatalogueRow = Record<string, unknown>;
type Client = Awaited<ReturnType<typeof createClient>>;

async function matchingRows(db: Client, table: string, columns: string, field: string, values: string[], companyId: string, projectId?: string, filters: Record<string, string> = {}) {
  const unique = [...new Set(values.filter(Boolean))];
  const found = new Map<string, CatalogueRow>();
  const groups: string[][] = [];
  let group: string[] = [];
  let encodedLength = 0;
  for (const value of unique) {
    const length = encodeURIComponent(value).length + 5;
    if (group.length && (encodedLength + length > 4_000 || group.length >= 150)) {
      groups.push(group); group = []; encodedLength = 0;
    }
    group.push(value); encodedLength += length;
  }
  if (group.length) groups.push(group);
  for (const keys of groups) {
    for (let from = 0; ; from += 500) {
      let query = db.from(table).select(columns).eq("company_id", companyId).in(field, keys);
      if (projectId) query = query.eq("project_id", projectId);
      for (const [key, value] of Object.entries(filters)) query = query.eq(key, value);
      const result = await query.order("id").range(from, from + 499);
      if (result.error) throw new ImportRequestError("Não foi possível conferir os vínculos dos cadastros. Atualize a página e tente novamente.", 500);
      const rows = result.data as unknown as CatalogueRow[];
      for (const row of rows) found.set(String(row.id), row);
      if (found.size > 10_000) throw new ImportRequestError("Há muitos cadastros correspondentes. Revise os identificadores da exportação.");
      if (rows.length < 500) break;
    }
  }
  return [...found.values()];
}

function documentVariants(value: unknown) {
  const raw = String(value ?? "").replace(/\D/g, "");
  const variants = [raw];
  if (raw.length === 11) variants.push(raw.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4"));
  if (raw.length === 14) variants.push(raw.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5"));
  return variants.filter(Boolean);
}

export async function resolveImportRelationships(workspace: Awaited<ReturnType<typeof getImportWorkspace>>, kind: EntityKind, sourceHost: string, projectId: string | null, rows: ImportRow[]) {
  if (!projectId || (kind !== "payable" && kind !== "receivable")) return rows;
  const { supabase, companyId } = workspace;
  const string = (value: unknown) => String(value ?? "").trim();
  if (kind === "payable") {
    const links = await matchingRows(supabase, "integration_import_records", "id,company_id,scope_id,source_host,entity_kind,external_id,target_id", "external_id",
      rows.map((row) => string(row.normalized_data.counterparty_external_id)), companyId, undefined,
      { entity_kind: "supplier", source_host: sourceHost, scope_id: companyId });
    const supplierLinks = links.filter((row) => row.entity_kind === "supplier" && row.source_host === sourceHost && row.scope_id === companyId);
    const columns = "id,company_id,legal_name,tax_id,status";
    const [linked, byDocument] = await Promise.all([
      matchingRows(supabase, "suppliers", columns, "id", supplierLinks.map((row) => string(row.target_id)), companyId),
      matchingRows(supabase, "suppliers", columns, "tax_id", rows.flatMap((row) => documentVariants(row.normalized_data.counterparty_tax_id)), companyId),
    ]);
    const suppliers = [...new Map([...linked, ...byDocument].map((row) => [row.id, row])).values()];
    return resolveFinancialRows(rows, { companyId, projectId, sourceHost, entityKind: kind, supplierLinks, suppliers });
  }
  const references = rows.map((row) => string(row.normalized_data.sale_reference)).filter(Boolean);
  const columns = "id,company_id,project_id,client_id,unit_id,number,contract_number,source_code,source_system,source_id,status";
  const candidates = await Promise.all([
    ...["number", "contract_number", "source_code"].map((field) => matchingRows(supabase, "sales", columns, field, references, companyId, projectId)),
    matchingRows(supabase, "sales", columns, "id", references.filter(isUuid), companyId, projectId),
    matchingRows(supabase, "sales", columns, "source_id", references.flatMap((reference) => [reference, `${sourceHost}|${projectId}|${reference}`]), companyId, projectId),
  ]);
  const sales = [...new Map(candidates.flat().map((row) => [row.id, row])).values()];
  const [clients, units] = await Promise.all([
    matchingRows(supabase, "clients", "id,company_id,name,tax_id", "id", sales.map((row) => string(row.client_id)), companyId),
    matchingRows(supabase, "units", "id,company_id,project_id", "id", sales.map((row) => string(row.unit_id)), companyId, projectId),
  ]);
  return resolveFinancialRows(rows, { companyId, projectId, sourceHost, entityKind: kind, sales, clients, units });
}

export function safeImportDatabaseMessage(error: { code?: string; message?: string }) {
  if (error.code === "42P01" || error.code === "PGRST202") return "O importador ainda aguarda a atualização do banco de dados.";
  if (error.code === "42501") return "Você não tem permissão para executar esta importação.";
  if (error.code === "P0001" && error.message) return error.message.slice(0, 600);
  return "Não foi possível concluir a operação. Os dados oficiais não foram alterados.";
}
