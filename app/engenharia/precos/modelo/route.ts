import ExcelJS from "exceljs";
import { requireCompanyPermission } from "@/lib/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type InputRecord = { code: string; description: string; unit: string };
type SupplierRecord = { tax_id: string | null; legal_name: string; trade_name: string | null };
type ProjectRecord = { code: string | null; name: string };

const green = "0F766E";
const darkGreen = "174A45";
const lightGreen = "DDF1EC";
const lightGray = "EEF3F2";
const textGray = "526462";

function styleHeader(row: ExcelJS.Row, requiredColumns: Set<number>) {
  row.height = 30;
  row.eachCell((cell, columnNumber) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: requiredColumns.has(columnNumber) ? `FF${green}` : `FF${darkGreen}` },
    };
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

export async function GET() {
  const { supabase, company, companyId, projectId } = await requireCompanyPermission("prices.view");

  const [inputsResult, suppliersResult, projectsResult] = await Promise.all([
    supabase
      .from("engineering_inputs")
      .select("code, description, unit")
      .eq("company_id", companyId)
      .eq("status", "active")
      .order("code")
      .limit(10000),
    supabase
      .from("suppliers")
      .select("tax_id, legal_name, trade_name")
      .eq("company_id", companyId)
      .eq("status", "active")
      .order("legal_name")
      .limit(10000),
    supabase
      .from("projects")
      .select("code, name")
      .eq("company_id", companyId)
      .neq("status", "archived")
      .order("name")
      .limit(2000),
  ]);

  const inputs = (inputsResult.data ?? []) as InputRecord[];
  const suppliers = (suppliersResult.data ?? []) as SupplierRecord[];
  const projects = (projectsResult.data ?? []) as ProjectRecord[];

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Elos OS";
  workbook.company = company.name;
  workbook.subject = "Modelo para importação de preços e cotações";
  workbook.created = new Date();

  const quotes = workbook.addWorksheet("Cotações", {
    views: [{ state: "frozen", ySplit: 1 }],
    properties: { defaultRowHeight: 22 },
  });

  quotes.columns = [
    { header: "codigo_insumo", key: "codigo_insumo", width: 22 },
    { header: "fornecedor_cnpj", key: "fornecedor_cnpj", width: 20 },
    { header: "fornecedor_nome", key: "fornecedor_nome", width: 34 },
    { header: "data_preco", key: "data_preco", width: 15 },
    { header: "escopo", key: "escopo", width: 16 },
    { header: "codigo_obra", key: "codigo_obra", width: 18 },
    { header: "preco_unitario", key: "preco_unitario", width: 18 },
    { header: "desconto_percentual", key: "desconto_percentual", width: 20 },
    { header: "frete_unitario", key: "frete_unitario", width: 17 },
    { header: "outros_custos_unitarios", key: "outros_custos_unitarios", width: 24 },
    { header: "adotar_preco", key: "adotar_preco", width: 16 },
    { header: "origem_documento", key: "origem_documento", width: 28 },
    { header: "observacoes", key: "observacoes", width: 42 },
  ];

  styleHeader(quotes.getRow(1), new Set([1, 3, 4, 5, 7]));
  quotes.autoFilter = "A1:M1";

  const headerNotes: Record<number, string> = {
    1: "Obrigatório. Use exatamente um código existente na aba Insumos.",
    2: "Recomendado. Apenas números ou CNPJ formatado. Tem prioridade na identificação do fornecedor.",
    3: "Obrigatório quando o CNPJ não for informado. Use exatamente o nome cadastrado na aba Fornecedores.",
    4: "Obrigatório. Aceita data do Excel ou dd/mm/aaaa.",
    5: "Obrigatório. Valores aceitos: Corporativo ou Obra.",
    6: "Obrigatório apenas para escopo Obra quando não desejar usar a obra selecionada no sistema.",
    7: "Obrigatório. Preço unitário maior que zero.",
    8: "Opcional. Percentual entre 0 e 100. Digite 5 para representar 5%.",
    9: "Opcional. Frete por unidade do insumo.",
    10: "Opcional. Impostos, descarga ou outros custos por unidade.",
    11: "Opcional. Valores aceitos: Sim ou Não. Só pode existir um Sim por insumo e escopo no arquivo.",
    12: "Opcional. Número da cotação, pedido, histórico Koper ou outra referência.",
    13: "Opcional. Prazo, validade, pagamento e demais condições comerciais.",
  };
  Object.entries(headerNotes).forEach(([column, note]) => {
    quotes.getCell(1, Number(column)).note = note;
  });

  for (let row = 2; row <= 2001; row += 1) {
    quotes.getCell(row, 1).dataValidation = {
      type: "list",
      allowBlank: false,
      formulae: [`Insumos!$A$2:$A$${Math.max(2, inputs.length + 1)}`],
      errorStyle: "stop",
      errorTitle: "Código de insumo inválido",
      error: "Escolha um código existente na aba Insumos.",
    };
    quotes.getCell(row, 3).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: [`Fornecedores!$B$2:$B$${Math.max(2, suppliers.length + 1)}`],
    };
    quotes.getCell(row, 5).dataValidation = {
      type: "list",
      allowBlank: false,
      formulae: ['"Corporativo,Obra"'],
    };
    quotes.getCell(row, 6).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: [`Obras!$A$2:$A$${Math.max(2, projects.length + 1)}`],
    };
    quotes.getCell(row, 11).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: ['"Sim,Não"'],
    };
  }

  quotes.getColumn(2).numFmt = "@";
  quotes.getColumn(4).numFmt = "dd/mm/yyyy";
  quotes.getColumn(7).numFmt = 'R$ #,##0.000000';
  quotes.getColumn(8).numFmt = "0.0000";
  quotes.getColumn(9).numFmt = 'R$ #,##0.000000';
  quotes.getColumn(10).numFmt = 'R$ #,##0.000000';
  quotes.getColumn(13).alignment = { wrapText: true, vertical: "top" };

  const instructions = workbook.addWorksheet("Instruções", { views: [{ state: "frozen", ySplit: 3 }] });
  instructions.columns = [{ width: 28 }, { width: 78 }];
  instructions.mergeCells("A1:B1");
  instructions.getCell("A1").value = "Elos OS · Importação de Preços e Cotações";
  instructions.getCell("A1").font = { bold: true, size: 18, color: { argb: "FFFFFFFF" } };
  instructions.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${darkGreen}` } };
  instructions.getCell("A1").alignment = { vertical: "middle", horizontal: "center" };
  instructions.getRow(1).height = 38;
  instructions.mergeCells("A2:B2");
  instructions.getCell("A2").value = `Empresa: ${company.name} · A planilha pode importar até 2.000 linhas e 5 MB.`;
  instructions.getCell("A2").font = { italic: true, color: { argb: `FF${textGray}` } };
  instructions.getCell("A2").alignment = { horizontal: "center" };

  instructions.addRow(["Como usar", "Preencha somente a aba Cotações. Não altere os nomes das colunas. As abas Insumos, Fornecedores e Obras servem como referência dos cadastros existentes."]);
  instructions.addRow(["Fornecedor", "Informe o CNPJ ou o nome exato. Quando os dois forem preenchidos, o CNPJ tem prioridade. O fornecedor precisa estar ativo no Elos OS."]);
  instructions.addRow(["Escopo Corporativo", "O preço fica disponível para todas as obras da empresa."]);
  instructions.addRow(["Escopo Obra", projectId ? "Se codigo_obra ficar vazio, o sistema usa a obra selecionada no momento da importação." : "Informe obrigatoriamente codigo_obra, pois nenhuma obra está selecionada no sistema."]);
  instructions.addRow(["Preço final", "O sistema calcula: preço unitário × (1 − desconto %) + frete unitário + outros custos unitários."]);
  instructions.addRow(["Preço adotado", "Use Sim somente quando a cotação deve virar referência. Deve existir no máximo um Sim por insumo e escopo no mesmo arquivo."]);
  instructions.addRow(["Formato de números", "Aceita números brasileiros ou do Excel, por exemplo: 1.234,56 ou 1234.56. No desconto, digite 5 para representar 5%. Não use fórmulas externas."]);
  instructions.addRow(["Validação", "Se alguma linha tiver erro, nenhuma cotação do arquivo será importada. O sistema informa as primeiras linhas que precisam ser corrigidas."]);
  styleReferenceHeader(instructions.getRow(3));
  instructions.getColumn(2).alignment = { wrapText: true, vertical: "top" };
  instructions.eachRow((row, rowNumber) => {
    if (rowNumber > 3) row.height = 42;
  });

  const inputsSheet = workbook.addWorksheet("Insumos", { views: [{ state: "frozen", ySplit: 1 }] });
  inputsSheet.columns = [
    { header: "codigo_insumo", key: "code", width: 24 },
    { header: "descricao", key: "description", width: 66 },
    { header: "unidade", key: "unit", width: 14 },
  ];
  styleReferenceHeader(inputsSheet.getRow(1));
  inputs.forEach((input) => inputsSheet.addRow(input));
  inputsSheet.autoFilter = `A1:C${Math.max(1, inputs.length + 1)}`;

  const suppliersSheet = workbook.addWorksheet("Fornecedores", { views: [{ state: "frozen", ySplit: 1 }] });
  suppliersSheet.columns = [
    { header: "fornecedor_cnpj", key: "tax_id", width: 22 },
    { header: "fornecedor_nome", key: "display_name", width: 44 },
    { header: "razao_social", key: "legal_name", width: 50 },
  ];
  styleReferenceHeader(suppliersSheet.getRow(1));
  suppliers.forEach((supplier) => suppliersSheet.addRow({
    tax_id: supplier.tax_id ?? "",
    display_name: supplier.trade_name || supplier.legal_name,
    legal_name: supplier.legal_name,
  }));
  suppliersSheet.getColumn(1).numFmt = "@";
  suppliersSheet.autoFilter = `A1:C${Math.max(1, suppliers.length + 1)}`;

  const projectsSheet = workbook.addWorksheet("Obras", { views: [{ state: "frozen", ySplit: 1 }] });
  projectsSheet.columns = [
    { header: "codigo_obra", key: "code", width: 22 },
    { header: "nome_obra", key: "name", width: 52 },
  ];
  styleReferenceHeader(projectsSheet.getRow(1));
  projects.forEach((project) => projectsSheet.addRow({ code: project.code ?? "", name: project.name }));
  projectsSheet.autoFilter = `A1:B${Math.max(1, projects.length + 1)}`;

  [quotes, instructions, inputsSheet, suppliersSheet, projectsSheet].forEach((sheet) => {
    sheet.eachRow((row) => {
      row.eachCell((cell) => {
        if (!cell.border) {
          cell.border = { bottom: { style: "hair", color: { argb: `FF${lightGray}` } } };
        }
      });
    });
  });

  quotes.getCell("A2").fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${lightGreen}` } };
  quotes.getCell("A2").note = "Comece a preencher nesta linha. Não cole cabeçalhos adicionais.";

  const buffer = await workbook.xlsx.writeBuffer();
  const body = new Uint8Array(buffer as ArrayBuffer);

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="modelo_importacao_cotacoes_elos_os.xlsx"',
      "Cache-Control": "no-store",
    },
  });
}
