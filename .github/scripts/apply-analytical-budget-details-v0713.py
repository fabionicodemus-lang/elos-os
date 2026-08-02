from pathlib import Path

PAGE = Path("app/engenharia/orcamento-analitico/page.tsx")
CSS = Path("app/analytical-budget.css")
SWITCHER = Path("components/project-switcher.tsx")
SELF = Path(".github/scripts/apply-analytical-budget-details-v0713.py")
WORKFLOW = Path(".github/workflows/apply-analytical-budget-details-v0713.yml")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: esperado 1 trecho, encontrado {count}")
    return text.replace(old, new, 1)


text = PAGE.read_text(encoding="utf-8")

text = replace_once(
    text,
    'import Link from "next/link";\n',
    'import { Fragment } from "react";\nimport Link from "next/link";\n',
    "import Fragment",
)

text = replace_once(
    text,
    '''type CompositionItem = {
  composition_id: string;
  input_id: string;
  effective_coefficient: number;
  status: "active" | "inactive";
};''',
    '''type CompositionItem = {
  id: string;
  composition_id: string;
  input_id: string;
  coefficient: number;
  waste_percentage: number;
  effective_coefficient: number;
  notes: string | null;
  status: "active" | "inactive";
};''',
    "tipo CompositionItem",
)

text = replace_once(
    text,
    '''type Input = {
  id: string;
  category: "material" | "labor" | "equipment" | "service" | "freight" | "other";
};''',
    '''type Input = {
  id: string;
  code: string;
  description: string;
  unit: string;
  category: "material" | "labor" | "equipment" | "service" | "freight" | "other";
};''',
    "tipo Input",
)

text = replace_once(
    text,
    '''const natureLabels: Record<keyof NatureTotals, string> = {
  material: "Materiais",
  labor: "Mão de obra",
  equipment: "Equipamentos",
  service: "Serviços terceirizados",
  freight: "Fretes",
  other: "Outros custos",
};''',
    '''const natureLabels: Record<keyof NatureTotals, string> = {
  material: "Materiais",
  labor: "Mão de obra",
  equipment: "Equipamentos",
  service: "Serviços terceirizados",
  freight: "Fretes",
  other: "Outros custos",
};

const inputCategoryLabels: Record<Input["category"], string> = {
  material: "Material",
  labor: "Mão de obra",
  equipment: "Equipamento",
  service: "Serviço terceirizado",
  freight: "Frete",
  other: "Outro custo",
};''',
    "rótulos das naturezas",
)

text = replace_once(
    text,
    '''    group?: string;
    situation?: string;
  }>;''',
    '''    group?: string;
    situation?: string;
    view?: string;
  }>;''',
    "parâmetro view",
)

text = replace_once(
    text,
    '''  const baseMode = params.base === "approved" ? "approved" : "active";
  const queryText = (params.q ?? "").trim().toLowerCase();''',
    '''  const baseMode = params.base === "approved" ? "approved" : "active";
  const detailMode = params.view === "details";
  const queryText = (params.q ?? "").trim().toLowerCase();''',
    "modo detalhado",
)

text = replace_once(
    text,
    '.select("composition_id, input_id, effective_coefficient, status")',
    '.select("id, composition_id, input_id, coefficient, waste_percentage, effective_coefficient, notes, status")',
    "campos da composição",
)

text = replace_once(
    text,
    '.select("id, category")',
    '.select("id, code, description, unit, category")',
    "campos dos insumos",
)

text = replace_once(
    text,
    '''  const projectLabel = project ? `${project.code ? `${project.code} · ` : ""}${project.name}` : "nenhuma obra selecionada";

  return (''',
    '''  const projectLabel = project ? `${project.code ? `${project.code} · ` : ""}${project.name}` : "nenhuma obra selecionada";
  const detailToggleParams = new URLSearchParams();
  if (selectedBudget) detailToggleParams.set("budget", selectedBudget.id);
  detailToggleParams.set("base", baseMode);
  if (!detailMode) detailToggleParams.set("view", "details");
  if (params.q) detailToggleParams.set("q", params.q);
  if (groupFilter) detailToggleParams.set("group", groupFilter);
  if (situationFilter) detailToggleParams.set("situation", situationFilter);
  const detailToggleHref = `?${detailToggleParams.toString()}`;

  return (''',
    "link do modo detalhado",
)

text = replace_once(
    text,
    '''        <>
          <Link className="elos-button" href={`/engenharia/levantamento?budget=${selectedBudget.id}`}>Abrir levantamento</Link>
          <Link className="elos-button" href={`/engenharia/orcamentos/${selectedBudget.id}`}>Dados da revisão</Link>
        </>''',
    '''        <>
          <Link className="elos-button analytical-view-toggle" href={detailToggleHref}>
            {detailMode ? "Ocultar insumos" : "Ver insumos e mão de obra"}
          </Link>
          <Link className="elos-button" href={`/engenharia/levantamento?budget=${selectedBudget.id}`}>Abrir levantamento</Link>
          <Link className="elos-button" href={`/engenharia/orcamentos/${selectedBudget.id}`}>Dados da revisão</Link>
        </>''',
    "ações do topo",
)

text = replace_once(
    text,
    '''              <input type="hidden" name="budget" value={selectedBudget.id} />
              <input type="hidden" name="base" value={baseMode} />''',
    '''              <input type="hidden" name="budget" value={selectedBudget.id} />
              <input type="hidden" name="base" value={baseMode} />
              {detailMode ? <input type="hidden" name="view" value="details" /> : null}''',
    "preservar view nos filtros",
)

text = replace_once(
    text,
    '''              <Link href={`?budget=${selectedBudget.id}&base=${baseMode}`}>Limpar</Link>''',
    '''              <Link href={`?budget=${selectedBudget.id}&base=${baseMode}${detailMode ? "&view=details" : ""}`}>Limpar</Link>''',
    "limpar filtros",
)

text = replace_once(
    text,
    '''              <div><span>Estrutura analítica</span><h2>Serviços, quantidades e valores da revisão</h2></div>
              <p>{filteredRows.length} serviço(s) no filtro atual.</p>''',
    '''              <div>
                <span>Estrutura analítica</span>
                <h2>{detailMode ? "Serviços abertos com insumos e mão de obra" : "Serviços, quantidades e valores da revisão"}</h2>
              </div>
              <p>{filteredRows.length} serviço(s) no filtro atual{detailMode ? " · composição detalhada ativa" : ""}.</p>''',
    "título da estrutura analítica",
)

start_marker = '                          {groupRows.map((row) => (\n'
end_marker = '                          ))}\n'
start = text.find(start_marker)
if start < 0:
    raise RuntimeError("início do mapa de serviços não encontrado")
end = text.find(end_marker, start)
if end < 0:
    raise RuntimeError("fim do mapa de serviços não encontrado")
end += len(end_marker)

new_rows = '''                          {groupRows.map((row) => {
                            const serviceHref = row.serviceId
                              ? `/engenharia/servicos?service=${row.serviceId}#insumos-do-servico`
                              : `/engenharia/orcamentos/${selectedBudget.id}`;
                            const composition = row.serviceId ? compositionByService.get(row.serviceId) ?? null : null;
                            const detailItems = composition
                              ? (itemsByComposition.get(composition.id) ?? []).map((item) => {
                                  const input = inputMap.get(item.input_id) ?? null;
                                  const price = projectPriceMap.get(item.input_id) ?? corporatePriceMap.get(item.input_id) ?? null;
                                  const coefficient = Number(item.effective_coefficient ?? 0);
                                  const totalQuantity = coefficient * row.quantityUsed;
                                  const inputUnitPrice = price ? Number(price.final_unit_price ?? 0) : null;
                                  return {
                                    id: item.id,
                                    input,
                                    coefficient,
                                    totalQuantity,
                                    inputUnitPrice,
                                    unitServiceCost: inputUnitPrice == null ? null : coefficient * inputUnitPrice,
                                    totalCost: inputUnitPrice == null ? null : totalQuantity * inputUnitPrice,
                                  };
                                })
                              : [];

                            return (
                              <Fragment key={row.id}>
                                <tr>
                                  <td>
                                    <Link className="analytical-service-link" href={serviceHref}>
                                      <strong>{row.code}</strong>
                                      <span>{row.description}</span>
                                      <small>{row.serviceId ? "Abrir e editar serviço" : "Abrir item da revisão"}</small>
                                    </Link>
                                  </td>
                                  <td>{row.sourceLabel}</td>
                                  <td>{row.unit}</td>
                                  <td>{row.quantities.memories}</td>
                                  <td>{decimal(row.quantities.total)} {row.unit}</td>
                                  <td>{decimal(row.quantities.approved)} {row.unit}</td>
                                  <td><strong>{decimal(row.quantityUsed)} {row.unit}</strong></td>
                                  <td>{money(row.unitCost)}</td>
                                  <td><strong>{money(row.totalCost)}</strong></td>
                                  <td>
                                    <span className={`analytical-status ${row.statusKey}`}>{row.statusLabel}</span>
                                    {row.source === "revision" && row.statusKey !== "complete"
                                      ? <Link href={`/engenharia/orcamentos/${selectedBudget.id}`}>Revisar item</Link>
                                      : null}
                                    {row.source === "takeoff" && row.statusKey === "missing_composition"
                                      ? <Link href={`/engenharia/composicoes?q=${encodeURIComponent(row.code)}`}>Abrir composição</Link>
                                      : null}
                                    {row.source === "takeoff" && row.statusKey === "missing_price"
                                      ? <Link href="/engenharia/precos">Abrir preços</Link>
                                      : null}
                                    {row.source === "takeoff" && row.statusKey === "no_quantity"
                                      ? <Link href={`/engenharia/levantamento?budget=${selectedBudget.id}`}>Abrir levantamento</Link>
                                      : null}
                                  </td>
                                </tr>

                                {detailMode ? (
                                  <tr className="analytical-detail-row">
                                    <td colSpan={10}>
                                      <div className="analytical-composition-detail">
                                        <header>
                                          <div>
                                            <span>Composição para 1 {row.unit}</span>
                                            <strong>{row.code} · {row.description}</strong>
                                          </div>
                                          <Link href={serviceHref}>{row.serviceId ? "Editar serviço e composição" : "Vincular serviço"}</Link>
                                        </header>

                                        {detailItems.length > 0 ? (
                                          <div className="registry-table-wrap analytical-inputs-wrap">
                                            <table className="registry-table analytical-inputs-table">
                                              <thead>
                                                <tr>
                                                  <th>Insumo / mão de obra</th>
                                                  <th>Natureza</th>
                                                  <th>Un.</th>
                                                  <th>Coef. por {row.unit}</th>
                                                  <th>Quantidade total</th>
                                                  <th>Preço unit.</th>
                                                  <th>Custo por {row.unit}</th>
                                                  <th>Custo total</th>
                                                </tr>
                                              </thead>
                                              <tbody>
                                                {detailItems.map((detail) => (
                                                  <tr key={detail.id}>
                                                    <td>
                                                      <strong>{detail.input?.code ?? "—"}</strong>
                                                      <span>{detail.input?.description ?? "Insumo indisponível"}</span>
                                                    </td>
                                                    <td>
                                                      <span className={`analytical-input-category ${detail.input?.category ?? "other"}`}>
                                                        {inputCategoryLabels[detail.input?.category ?? "other"]}
                                                      </span>
                                                    </td>
                                                    <td><strong>{detail.input?.unit ?? "—"}</strong></td>
                                                    <td>{decimal(detail.coefficient, 8)} {detail.input?.unit ?? ""}</td>
                                                    <td><strong>{decimal(detail.totalQuantity, 6)} {detail.input?.unit ?? ""}</strong></td>
                                                    <td>{money(detail.inputUnitPrice)}</td>
                                                    <td>{money(detail.unitServiceCost)}</td>
                                                    <td><strong>{money(detail.totalCost)}</strong></td>
                                                  </tr>
                                                ))}
                                              </tbody>
                                            </table>
                                          </div>
                                        ) : (
                                          <div className="analytical-detail-empty">
                                            <strong>{row.serviceId ? "Serviço sem composição de insumos cadastrada." : "Item da revisão ainda não vinculado a um serviço da base técnica."}</strong>
                                            <span>Abra o serviço para cadastrar materiais, mão de obra, equipamentos e respectivos coeficientes.</span>
                                            <Link href={serviceHref}>{row.serviceId ? "Montar composição" : "Revisar vínculo"}</Link>
                                          </div>
                                        )}
                                      </div>
                                    </td>
                                  </tr>
                                ) : null}
                              </Fragment>
                            );
                          })}
'''
text = text[:start] + new_rows + text[end:]

PAGE.write_text(text, encoding="utf-8")

css = CSS.read_text(encoding="utf-8")
css_addition = r'''

/* V0.71.3 · detalhamento dos insumos no orçamento analítico */
.analytical-view-toggle { white-space: nowrap; }
.analytical-service-link { display: grid; gap: 2px; color: inherit; text-decoration: none; }
.analytical-service-link strong { color: var(--elos-primary, #08766c); }
.analytical-service-link small { color: var(--muted, #667773); font-size: 10px; font-weight: 700; opacity: 0; transition: opacity 0.16s ease; }
.analytical-service-link:hover small, .analytical-service-link:focus-visible small { opacity: 1; }
.analytical-detail-row > td { padding: 0 !important; background: #f4f8f7; border-top: 0 !important; }
.analytical-composition-detail { margin: 0 12px 14px; padding: 12px; border: 1px solid #cfe0dc; border-radius: 12px; background: #ffffff; box-shadow: inset 4px 0 0 #0b7b70; }
.analytical-composition-detail > header { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 10px; }
.analytical-composition-detail > header div { display: grid; gap: 2px; }
.analytical-composition-detail > header span { color: #52706a; font-size: 10px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; }
.analytical-composition-detail > header strong { color: #173d39; font-size: 13px; }
.analytical-composition-detail > header > a, .analytical-detail-empty a { color: #08766c; font-size: 12px; font-weight: 800; text-decoration: none; }
.analytical-inputs-wrap { border: 1px solid #e0eae7; border-radius: 10px; }
.analytical-inputs-table { min-width: 1040px; }
.analytical-inputs-table td:first-child { min-width: 270px; }
.analytical-inputs-table td:first-child strong, .analytical-inputs-table td:first-child span { display: block; }
.analytical-input-category { display: inline-flex; align-items: center; min-height: 22px; padding: 3px 8px; border-radius: 999px; background: #eaf3f1; color: #315f59; font-size: 10px; font-weight: 800; white-space: nowrap; }
.analytical-input-category.labor { background: #fff0d9; color: #88520a; }
.analytical-input-category.equipment { background: #edf0f8; color: #4d5980; }
.analytical-input-category.service, .analytical-input-category.freight { background: #f0eafa; color: #655080; }
.analytical-detail-empty { display: flex; align-items: center; gap: 10px; padding: 12px; border: 1px dashed #bfd2ce; border-radius: 10px; color: #516a65; font-size: 12px; }
.analytical-detail-empty span { flex: 1; }
@media (max-width: 900px) { .analytical-composition-detail > header, .analytical-detail-empty { align-items: flex-start; flex-direction: column; } }
'''
if "V0.71.3 · detalhamento dos insumos" not in css:
    CSS.write_text(css.rstrip() + css_addition + "\n", encoding="utf-8")

switcher = SWITCHER.read_text(encoding="utf-8")
if "V0.71.2" not in switcher:
    raise RuntimeError("versão V0.71.2 não encontrada no seletor")
switcher = switcher.replace("V0.71.2", "V0.71.3")
SWITCHER.write_text(switcher, encoding="utf-8")

for temporary in (SELF, WORKFLOW):
    if temporary.exists():
        temporary.unlink()
