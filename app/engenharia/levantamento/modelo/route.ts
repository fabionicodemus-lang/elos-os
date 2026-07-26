import ExcelJS from "exceljs";
import { fetchAllRows } from "@/lib/supabase-pagination";
import { requireCompanyPermission } from "@/lib/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ServiceRecord = { code: string; description: string; unit: string; group_code: string | null; default_method: string };
type LocationRecord = { code: string; name: string; location_type: string; repetitions: number };
type BudgetRecord = { id: string; code: string; name: string; version: string; status: string; updated_at: string };

const green = "0F766E";
const darkGreen = "174A45";
const lightGreen = "DDF1EC";
const lightGray = "EEF3F2";
const textGray = "526462";

function styleHeader(row: ExcelJS.Row, requiredColumns: Set<number>) {
  row.height = 32;
  row.eachCell((cell, columnNumber) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: requiredColumns.has(columnNumber) ? `FF${green}` : `FF${darkGreen}` } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = {
      top: { style: "thin", color: { argb: "FFD2DEDC" } },
      bottom: { style: "thin", color: { argb: "FFD2DEDC" } },
      left: { style: "thin", color: { argb: "FFD2DEDC" } },
      right: { style: "thin", color: { argb: "FFD2DEDC" } },
    };
  });
}

function styleReferenceHeader(row: ExcelJS.Row) {
  row.height = 25;
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${green}` } };
    cell.alignment = { vertical: "middle" };
  });
}

export async function GET(request: Request) {
  const { supabase, company, companyId, projectId } = await requireCompanyPermission("takeoffs.view");
  const requestedBudgetId = new URL(request.url).searchParams.get("budget");

  const [servicesResult, locationsResult, budgetsResult] = await Promise.all([
    fetchAllRows<ServiceRecord>(async (from, to) => {
      const { data, error } = await supabase
        .from("engineering_services")
        .select("code, description, unit, group_code, default_method")
        .eq("company_id", companyId)
        .eq("status", "active")
        .order("group_code", { ascending: true, nullsFirst: false })
        .order("code")
        .range(from, to);
      return { data: (data ?? []) as ServiceRecord[], error };
    }),
    projectId
      ? fetchAllRows<LocationRecord>(async (from, to) => {
          const { data, error } = await supabase
            .from("engineering_takeoff_locations")
            .select("code, name, location_type, repetitions")
            .eq("company_id", companyId)
            .eq("project_id", projectId)
            .eq("status", "active")
            .order("sort_order")
            .order("code")
            .range(from, to);
          return { data: (data ?? []) as LocationRecord[], error };
        })
      : Promise.resolve({ data: [] as LocationRecord[], error: null }),
    projectId
      ? fetchAllRows<BudgetRecord>(async (from, to) => {
          const { data, error } = await supabase
            .from("engineering_budgets")
            .select("id, code, name, version, status, updated_at")
            .eq("company_id", companyId)
            .eq("project_id", projectId)
            .neq("status", "archived")
            .order("updated_at", { ascending: false })
            .range(from, to);
          return { data: (data ?? []) as BudgetRecord[], error };
        })
      : Promise.resolve({ data: [] as BudgetRecord[], error: null }),
  ]);

  const services = servicesResult.data;
  const locations = locationsResult.data;
  const budgets = budgetsResult.data;
  const budget = budgets.find((item) => item.id === requestedBudgetId) ?? budgets[0] ?? null;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Elos OS";
  workbook.company = company.name;
  workbook.subject = "Modelo para importação de levantamento de quantitativos";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Levantamento", {
    views: [{ state: "frozen", ySplit: 1 }],
    properties: { defaultRowHeight: 22 },
  });

  sheet.columns = [
    { header: "local_codigo", key: "local_codigo", width: 19 },
    { header: "local_nome", key: "local_nome", width: 34 },
    { header: "local_tipo", key: "local_tipo", width: 18 },
    { header: "local_superior_codigo", key: "local_superior_codigo", width: 24 },
    { header: "repeticoes", key: "repeticoes", width: 15 },
    { header: "ordem_local", key: "ordem_local", width: 14 },
    { header: "servico_codigo", key: "servico_codigo", width: 21 },
    { header: "metodo", key: "metodo", width: 20 },
    { header: "quantidade_elementos", key: "quantidade_elementos", width: 22 },
    { header: "dimensao_a", key: "dimensao_a", width: 15 },
    { header: "dimensao_b", key: "dimensao_b", width: 15 },
    { header: "dimensao_c", key: "dimensao_c", width: 15 },
    { header: "ajuste", key: "ajuste", width: 14 },
    { header: "memoria_calculo", key: "memoria_calculo", width: 42 },
    { header: "quantidade_por_local", key: "quantidade_por_local", width: 23 },
    { header: "quantidade_total", key: "quantidade_total", width: 20 },
    { header: "origem_projeto_prancha", key: "origem_projeto_prancha", width: 30 },
    { header: "revisao_projeto", key: "revisao_projeto", width: 18 },
    { header: "descricao_memoria", key: "descricao_memoria", width: 40 },
    { header: "status", key: "status", width: 18 },
    { header: "local_observacoes", key: "local_observacoes", width: 36 },
  ];

  styleHeader(sheet.getRow(1), new Set([1, 2, 5, 7, 14, 16]));
  sheet.autoFilter = "A1:U1";

  const notes: Record<number, string> = {
    1: "Obrigatório. Código único do pavimento/local. Se já existir na obra, será atualizado; se não existir, será criado.",
    2: "Obrigatório. Nome do pavimento ou local.",
    3: "Opcional. Pavimento, Torre / bloco, Unidade, Ambiente, Setor, Área externa, Empreendimento ou Outro. Padrão: Pavimento.",
    4: "Opcional. Código de outro local que será o nível superior. Pode estar na aba Locais ou em outra linha deste arquivo.",
    5: "Obrigatório. Quantas vezes esse local se repete na obra.",
    6: "Opcional. Ordem de exibição do local.",
    7: "Obrigatório. Use um código existente na aba Serviços.",
    8: "Opcional. Contagem, Comprimento, Área, Volume, Peso, Valor global / unidade ou Quantidade direta.",
    9: "Opcional. Quantidade de elementos usada na memória.",
    10: "Opcional. Primeira dimensão da memória.",
    11: "Opcional. Segunda dimensão da memória.",
    12: "Opcional. Terceira dimensão da memória.",
    13: "Opcional. Acréscimo positivo ou desconto negativo.",
    14: "Obrigatório. Texto da memória ou fórmula que ficará armazenada, por exemplo: 15 × (4 paredes × 3,20 × 2,80).",
    15: "Opcional. Quantidade de uma repetição. Quando vazio, o sistema calcula quantidade_total ÷ repeticoes.",
    16: "Obrigatório. Quantidade consolidada do serviço para todas as repetições desse local.",
    17: "Opcional. Projeto, disciplina, arquivo ou prancha de origem.",
    18: "Opcional. Revisão do projeto utilizada.",
    19: "Opcional. Descrição do que foi medido.",
    20: "Opcional. Rascunho, Em conferência ou Aprovado. Padrão: Rascunho.",
    21: "Opcional. Observação do pavimento/local.",
  };
  Object.entries(notes).forEach(([column, note]) => { sheet.getCell(1, Number(column)).note = note; });

  const serviceLastRow = Math.max(2, services.length + 1);
  const locationLastRow = Math.max(2, locations.length + 1);
  for (let row = 2; row <= 5001; row += 1) {
    sheet.getCell(row, 3).dataValidation = { type: "list", allowBlank: true, formulae: ['"Pavimento,Torre / bloco,Unidade,Ambiente,Setor,Área externa,Empreendimento,Outro"'] };
    sheet.getCell(row, 4).dataValidation = { type: "list", allowBlank: true, formulae: [`Locais!$A$2:$A$${locationLastRow}`] };
    sheet.getCell(row, 7).dataValidation = {
      type: "list",
      allowBlank: false,
      formulae: [`Serviços!$A$2:$A$${serviceLastRow}`],
      errorStyle: "stop",
      errorTitle: "Serviço inválido",
      error: "Escolha um código existente na aba Serviços.",
    };
    sheet.getCell(row, 8).dataValidation = { type: "list", allowBlank: true, formulae: ['"Contagem,Comprimento,Área,Volume,Peso,Valor global / unidade,Quantidade direta"'] };
    sheet.getCell(row, 20).dataValidation = { type: "list", allowBlank: true, formulae: ['"Rascunho,Em conferência,Aprovado"'] };
  }

  [5, 6, 9, 10, 11, 12, 13, 15, 16].forEach((column) => { sheet.getColumn(column).numFmt = "0.000000"; });
  [14, 17, 19, 21].forEach((column) => { sheet.getColumn(column).alignment = { wrapText: true, vertical: "top" }; });
  sheet.getCell("A2").fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${lightGreen}` } };
  sheet.getCell("A2").note = "Comece a preencher nesta linha. Repita os dados do local em todas as linhas de serviços daquele pavimento.";

  const instructions = workbook.addWorksheet("Instruções", { views: [{ state: "frozen", ySplit: 3 }] });
  instructions.columns = [{ width: 30 }, { width: 86 }];
  instructions.mergeCells("A1:B1");
  instructions.getCell("A1").value = "Elos OS · Importação do Levantamento de Quantitativos";
  instructions.getCell("A1").font = { bold: true, size: 18, color: { argb: "FFFFFFFF" } };
  instructions.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${darkGreen}` } };
  instructions.getCell("A1").alignment = { vertical: "middle", horizontal: "center" };
  instructions.getRow(1).height = 38;
  instructions.mergeCells("A2:B2");
  instructions.getCell("A2").value = `Empresa: ${company.name} · Revisão de destino: ${budget ? `${budget.code} · ${budget.version} · ${budget.name}` : "nenhuma revisão disponível"}`;
  instructions.getCell("A2").font = { italic: true, color: { argb: `FF${textGray}` } };
  instructions.getCell("A2").alignment = { horizontal: "center" };
  instructions.addRow(["Como usar", "Preencha somente a aba Levantamento. Cada linha representa um serviço medido em um pavimento/local. Repita o código e os dados do local quando houver vários serviços no mesmo pavimento."]);
  instructions.addRow(["Criação de locais", "O sistema cria automaticamente os pavimentos e locais que ainda não existirem. Quando o código já existir, nome, tipo, repetições e ordem serão sincronizados."]);
  instructions.addRow(["Repetições", "Informe quantas vezes o local se repete. Exemplo: um pavimento tipo repetido do 6º ao 20º andar possui 15 repetições."]);
  instructions.addRow(["Memória e quantidade", "A memória de cálculo é armazenada exatamente como informada. A quantidade total deve representar todas as repetições. Quantidade por local é opcional e pode ser calculada pelo sistema."]);
  instructions.addRow(["Serviços", "Use somente códigos da aba Serviços. O sistema utiliza automaticamente a unidade cadastrada no serviço."]);
  instructions.addRow(["Validação", "A importação é integral. Se alguma linha tiver erro, nenhum local nem memória do arquivo será gravado."]);
  instructions.addRow(["Limites", "Até 5.000 memórias e 5 MB por arquivo XLSX."]);
  styleReferenceHeader(instructions.getRow(3));
  instructions.getColumn(2).alignment = { wrapText: true, vertical: "top" };
  instructions.eachRow((row, rowNumber) => { if (rowNumber > 3) row.height = 45; });

  const servicesSheet = workbook.addWorksheet("Serviços", { views: [{ state: "frozen", ySplit: 1 }] });
  servicesSheet.columns = [
    { header: "servico_codigo", key: "code", width: 24 },
    { header: "descricao", key: "description", width: 64 },
    { header: "unidade", key: "unit", width: 14 },
    { header: "grupo", key: "group_code", width: 28 },
    { header: "metodo_padrao", key: "default_method", width: 20 },
  ];
  styleReferenceHeader(servicesSheet.getRow(1));
  services.forEach((service) => servicesSheet.addRow(service));
  servicesSheet.autoFilter = `A1:E${Math.max(1, services.length + 1)}`;

  const locationsSheet = workbook.addWorksheet("Locais", { views: [{ state: "frozen", ySplit: 1 }] });
  locationsSheet.columns = [
    { header: "local_codigo", key: "code", width: 22 },
    { header: "local_nome", key: "name", width: 44 },
    { header: "local_tipo", key: "location_type", width: 20 },
    { header: "repeticoes", key: "repetitions", width: 15 },
  ];
  styleReferenceHeader(locationsSheet.getRow(1));
  locations.forEach((location) => locationsSheet.addRow(location));
  locationsSheet.autoFilter = `A1:D${Math.max(1, locations.length + 1)}`;

  const revisionsSheet = workbook.addWorksheet("Revisões", { views: [{ state: "frozen", ySplit: 1 }] });
  revisionsSheet.columns = [
    { header: "codigo_orcamento", key: "code", width: 24 },
    { header: "versao", key: "version", width: 14 },
    { header: "nome", key: "name", width: 52 },
    { header: "status", key: "status", width: 18 },
  ];
  styleReferenceHeader(revisionsSheet.getRow(1));
  budgets.forEach((item) => revisionsSheet.addRow(item));

  [sheet, instructions, servicesSheet, locationsSheet, revisionsSheet].forEach((worksheet) => {
    worksheet.eachRow((row) => {
      row.eachCell((cell) => {
        if (!cell.border) cell.border = { bottom: { style: "hair", color: { argb: `FF${lightGray}` } } };
      });
    });
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const body = new Uint8Array(buffer as ArrayBuffer);
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="modelo_importacao_levantamento_elos_os.xlsx"',
      "Cache-Control": "no-store",
    },
  });
}
