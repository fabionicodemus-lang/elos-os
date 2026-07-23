import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { requireCompanyPermission } from "@/lib/workspace";
import { saveCorrectionIndexValue } from "./actions";

type CorrectionIndex = {
  id: string;
  code: string;
  name: string;
  value_type: "index_number" | "percentage";
  unit_label: string;
  source_name: string | null;
  status: "active" | "inactive";
};

type IndexValue = {
  id: string;
  correction_index_id: string;
  reference_month: string;
  value: number;
  notes: string | null;
  updated_at: string;
  correction_indices: CorrectionIndex | CorrectionIndex[] | null;
};

function relatedOne<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function monthBR(value: string | null) {
  if (!value) return "Sem lançamento";
  const [year, month] = value.split("-");
  return new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${year}-${month}-01T00:00:00Z`),
  );
}

function formatIndexValue(value: number | null | undefined, index: CorrectionIndex | null) {
  if (value === null || value === undefined || !index) return "—";
  const digits = index.value_type === "percentage" ? 4 : 2;
  return `${new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number(value))} ${index.unit_label}`;
}

export default async function CorrectionIndicesPage({
  searchParams,
}: {
  searchParams: Promise<{ index?: string; year?: string; error?: string; success?: string }>;
}) {
  const params = await searchParams;
  const { supabase, company, companyId, roleKey } = await requireCompanyPermission("indices.view");
  const currentYear = new Date().getFullYear();
  const selectedIndexId = params.index ?? "";
  const selectedYear = /^\d{4}$/.test(params.year ?? "") ? Number(params.year) : currentYear;

  const indicesResult = await supabase
    .from("correction_indices")
    .select("id, code, name, value_type, unit_label, source_name, status")
    .eq("company_id", companyId)
    .order("code");

  const schemaMissing =
    indicesResult.error?.code === "42P01" ||
    indicesResult.error?.message.includes("correction_indices");

  const indices = (indicesResult.data ?? []) as CorrectionIndex[];
  const activeIndices = indices.filter((item) => item.status === "active");

  let valuesQuery = supabase
    .from("correction_index_values")
    .select("id, correction_index_id, reference_month, value, notes, updated_at, correction_indices(id, code, name, value_type, unit_label, source_name, status)")
    .eq("company_id", companyId)
    .gte("reference_month", `${selectedYear}-01-01`)
    .lte("reference_month", `${selectedYear}-12-01`)
    .order("reference_month", { ascending: false });

  if (selectedIndexId) valuesQuery = valuesQuery.eq("correction_index_id", selectedIndexId);

  const [valuesResult, latestResult, manageResult] = schemaMissing
    ? [
        { data: [], error: null },
        { data: [], error: null },
        { data: false, error: null },
      ]
    : await Promise.all([
        valuesQuery,
        supabase
          .from("correction_index_values")
          .select("id, correction_index_id, reference_month, value, notes, updated_at, correction_indices(id, code, name, value_type, unit_label, source_name, status)")
          .eq("company_id", companyId)
          .order("reference_month", { ascending: false })
          .limit(120),
        supabase.rpc("has_company_permission", {
          target_company_id: companyId,
          target_permission: "indices.manage",
        }),
      ]);

  const values = (valuesResult.data ?? []) as unknown as IndexValue[];
  const latestValues = (latestResult.data ?? []) as unknown as IndexValue[];
  const latestByIndex = new Map<string, IndexValue>();
  for (const row of latestValues) {
    if (!latestByIndex.has(row.correction_index_id)) latestByIndex.set(row.correction_index_id, row);
  }

  const canManage = manageResult.data === true || roleKey === "owner" || roleKey === "admin";
  const defaultMonth = new Date().toISOString().slice(0, 7);
  const years = Array.from({ length: 12 }, (_, index) => currentYear + 1 - index);

  return (
    <AppShell
      activeGroup="finance"
      activeItem="correction-indices"
      eyebrow="Financeiro · Atualização monetária"
      title="Índices de Correção"
      description={`${company.name} · cadastro mensal usado nos planos de pagamento e contratos.`}
      actions={
        <>
          <Link className="elos-button" href="/comercial/vendas">Vendas</Link>
          <Link className="elos-button" href="/comercial/planos-de-pagamento">Contas a receber</Link>
        </>
      }
    >
      {params.error ? <div className="auth-message error workspace-message">{params.error}</div> : null}
      {params.success ? <div className="auth-message success workspace-message">{params.success}</div> : null}

      {schemaMissing ? (
        <section className="setup-panel">
          <span>Banco de dados pendente</span>
          <h2>Instale o cadastro de índices</h2>
          <p>Execute no SQL Editor do Supabase o arquivo <code>supabase/migrations/20260723_0006_correction_indices.sql</code>.</p>
        </section>
      ) : (
        <>
          <section className="index-summary-grid">
            {activeIndices.map((index) => {
              const latest = latestByIndex.get(index.id) ?? null;
              return (
                <article key={index.id}>
                  <div className="index-card-heading">
                    <span>{index.source_name || "Fonte oficial"}</span>
                    <strong>{index.code}</strong>
                  </div>
                  <h2>{formatIndexValue(latest?.value, index)}</h2>
                  <p>{monthBR(latest?.reference_month ?? null)}</p>
                  <small>{index.value_type === "percentage" ? "Variação mensal" : "Valor publicado do índice"}</small>
                </article>
              );
            })}
          </section>

          <section className="registry-toolbar index-toolbar">
            <form className="index-filter" method="get">
              <select name="index" defaultValue={selectedIndexId}>
                <option value="">Todos os índices</option>
                {activeIndices.map((index) => <option key={index.id} value={index.id}>{index.code}</option>)}
              </select>
              <select name="year" defaultValue={String(selectedYear)}>
                {years.map((year) => <option key={year} value={year}>{year}</option>)}
              </select>
              <button type="submit">Filtrar</button>
              <Link href="/financeiro/indices-de-correcao">Limpar</Link>
            </form>

            {canManage ? (
              <details className="registry-create" open={values.length === 0}>
                <summary>+ Lançar valor mensal</summary>
                <form action={saveCorrectionIndexValue}>
                  <div className="registry-form-grid index-entry-grid">
                    <label>Índice
                      <select name="correction_index_id" required defaultValue={selectedIndexId}>
                        <option value="" disabled>Selecione o índice</option>
                        {activeIndices.map((index) => <option key={index.id} value={index.id}>{index.code} · {index.unit_label}</option>)}
                      </select>
                    </label>
                    <label>Mês de referência<input name="reference_month" type="month" defaultValue={defaultMonth} required /></label>
                    <label>Valor publicado<input name="value" inputMode="decimal" placeholder="0,0000" required /></label>
                    <label className="registry-wide">Observações<textarea name="notes" rows={3} placeholder="Fonte, observação ou revisão do índice" /></label>
                  </div>
                  <button className="auth-primary" type="submit">Salvar índice do mês</button>
                </form>
              </details>
            ) : null}
          </section>

          <section className="registry-table-panel">
            <div className="section-heading">
              <div><span>Histórico mensal</span><h2>Valores cadastrados em {selectedYear}</h2></div>
              <p>{values.length} lançamento(s). Repetir o mesmo índice e mês atualiza o valor existente.</p>
            </div>
            <div className="registry-table-wrap">
              <table className="registry-table index-table">
                <thead><tr><th>Índice</th><th>Mês de referência</th><th>Valor</th><th>Unidade</th><th>Fonte</th><th>Observações</th></tr></thead>
                <tbody>
                  {values.map((row) => {
                    const index = relatedOne(row.correction_indices);
                    return (
                      <tr key={row.id}>
                        <td><strong>{index?.code || "Índice"}</strong><small>{index?.name}</small></td>
                        <td>{monthBR(row.reference_month)}</td>
                        <td><strong>{formatIndexValue(row.value, index)}</strong></td>
                        <td>{index?.value_type === "percentage" ? "Variação mensal" : "Número-índice"}</td>
                        <td>{index?.source_name || "—"}</td>
                        <td>{row.notes || "—"}</td>
                      </tr>
                    );
                  })}
                  {values.length === 0 ? <tr><td className="empty-table" colSpan={6}>Nenhum valor cadastrado para este filtro.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </AppShell>
  );
}
