import ExcelJS from "exceljs";
import { GET as exportFiscal } from "../exportacao-fiscal/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Severity = "ERRO" | "ALERTA";
type FiscalIssue = {
  severity: Severity;
  code: string;
  message: string;
  action: string;
};

type DocumentRow = {
  row: ExcelJS.Row;
  origin: string;
  registry: string;
  competence: string;
  project: string;
  taxId: string;
  supplier: string;
  type: string;
  number: string;
  series: string;
  accessKey: string;
  documentTotal: number;
  net: number;
  inss: number;
  iss: number;
  irrf: number;
  pisRet: number;
  cofinsRet: number;
  csll: number;
  otherRet: number;
  allocation: string;
  dueDates: string;
  status: string;
};

function normalize(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function money(value: unknown) {
  if (typeof value === "number") return value;
  if (value === null || value === undefined || value === "") return 0;
  const parsed = Number(String(value).replace(/[^0-9,.-]/g, "").replace(/\./g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function headerMap(sheet: ExcelJS.Worksheet) {
  const result = new Map<string, number>();
  sheet.getRow(1).eachCell((cell, columnNumber) => {
    result.set(normalize(cell.text), columnNumber);
  });
  return result;
}

function cellText(row: ExcelJS.Row, headers: Map<string, number>, header: string) {
  const column = headers.get(normalize(header));
  return column ? String(row.getCell(column).text ?? "").trim() : "";
}

function cellNumber(row: ExcelJS.Row, headers: Map<string, number>, header: string) {
  const column = headers.get(normalize(header));
  return column ? money(row.getCell(column).value) : 0;
}

function classifyStatus(status: string): FiscalIssue | null {
  const value = normalize(status);
  if (value === "rejeitado") {
    return { severity: "ERRO", code: "DOC_REJEITADO", message: "Documento fiscal está rejeitado.", action: "Corrigir ou cancelar o documento antes do fechamento." };
  }
  if (["rascunho", "enviado", "em conferência"].includes(value)) {
    return { severity: "ALERTA", code: "DOC_PENDENTE", message: `Documento ainda está em status ${status}.`, action: "Concluir a conferência/aprovação antes de enviar ao contador." };
  }
  return null;
}

function collectBaseIssues(document: DocumentRow): FiscalIssue[] {
  const issues: FiscalIssue[] = [];
  if (!document.supplier) issues.push({ severity: "ERRO", code: "FORNECEDOR_AUSENTE", message: "Fornecedor não identificado.", action: "Vincular o fornecedor correto ao documento." });
  if (!document.taxId) issues.push({ severity: "ALERTA", code: "CPF_CNPJ_AUSENTE", message: "Fornecedor sem CNPJ/CPF no cadastro.", action: "Completar o CNPJ/CPF antes da entrega contábil." });
  if (!document.number) issues.push({ severity: "ERRO", code: "NUMERO_AUSENTE", message: "Documento sem número.", action: "Informar o número do documento." });
  if (!document.competence) issues.push({ severity: "ALERTA", code: "COMPETENCIA_AUSENTE", message: "Competência fiscal não identificada.", action: "Revisar a competência do documento." });
  if (!document.project) issues.push({ severity: "ERRO", code: "OBRA_AUSENTE", message: "Obra não identificada.", action: "Vincular o documento à obra correta." });
  if (!document.allocation || normalize(document.allocation).includes("sem-apropriação")) {
    issues.push({ severity: "ERRO", code: "SEM_APROPRIACAO", message: "Há item sem serviço/centro de custo apropriado.", action: "Apropriar o item na obra antes do fechamento." });
  }
  if (document.documentTotal <= 0) issues.push({ severity: "ERRO", code: "VALOR_INVALIDO", message: "Valor do documento é zero ou negativo.", action: "Revisar os valores do documento." });
  const statusIssue = classifyStatus(document.status);
  if (statusIssue) issues.push(statusIssue);
  return issues;
}

function validateManual(document: DocumentRow): FiscalIssue[] {
  const issues: FiscalIssue[] = [];
  const retentions = document.inss + document.iss + document.irrf + document.pisRet + document.cofinsRet + document.csll + document.otherRet;
  const expectedNet = document.documentTotal - retentions;
  if (Math.abs(expectedNet - document.net) > 0.02) {
    issues.push({
      severity: "ERRO",
      code: "LIQUIDO_DIVERGENTE",
      message: `Bruto/descontos/retenções não fecham com o líquido. Diferença: R$ ${Math.abs(expectedNet - document.net).toFixed(2).replace(".", ",")}.`,
      action: "Revisar valor do documento, retenções e líquido do fornecedor.",
    });
  }
  if (normalize(document.type) === "nota de serviço" && retentions <= 0) {
    issues.push({
      severity: "ALERTA",
      code: "RETENCOES_ZERADAS",
      message: "Nota de serviço sem nenhuma retenção informada.",
      action: "Confirmar se o serviço realmente não possui ISS, INSS, IRRF ou retenções federais. Não é erro automático.",
    });
  }
  if (!document.dueDates) {
    issues.push({ severity: "ERRO", code: "VENCIMENTO_AUSENTE", message: "Documento manual sem vencimento do fornecedor.", action: "Gerar ou corrigir as parcelas do contas a pagar." });
  }
  return issues;
}

function validateElectronic(document: DocumentRow): FiscalIssue[] {
  const issues: FiscalIssue[] = [];
  if (!/^\d{44}$/.test(document.accessKey)) {
    issues.push({ severity: "ERRO", code: "CHAVE_NFE_INVALIDA", message: "Chave de acesso da NF-e ausente ou inválida.", action: "Reimportar ou corrigir o XML da NF-e." });
  }
  return issues;
}

function styleHeader(sheet: ExcelJS.Worksheet) {
  const row = sheet.getRow(1);
  row.height = 30;
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF174A45" } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  });
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columnCount } };
}

export async function GET(request: Request) {
  const baseResponse = await exportFiscal(request);
  if (!baseResponse.ok) return baseResponse;

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await baseResponse.arrayBuffer());

  const documents = workbook.getWorksheet("Documentos fiscais");
  if (!documents) return Response.json({ error: "A exportação fiscal não contém a aba Documentos fiscais." }, { status: 500 });

  const headers = headerMap(documents);
  const rows: DocumentRow[] = [];
  for (let rowNumber = 2; rowNumber <= documents.rowCount; rowNumber += 1) {
    const row = documents.getRow(rowNumber);
    if (!row.hasValues) continue;
    rows.push({
      row,
      origin: cellText(row, headers, "Origem"),
      registry: cellText(row, headers, "Registro Elos"),
      competence: cellText(row, headers, "Competência"),
      project: cellText(row, headers, "Obra"),
      taxId: cellText(row, headers, "CNPJ/CPF fornecedor"),
      supplier: cellText(row, headers, "Fornecedor"),
      type: cellText(row, headers, "Tipo"),
      number: cellText(row, headers, "Número"),
      series: cellText(row, headers, "Série"),
      accessKey: cellText(row, headers, "Chave de acesso"),
      documentTotal: cellNumber(row, headers, "Valor do documento"),
      net: cellNumber(row, headers, "Líquido fornecedor"),
      inss: cellNumber(row, headers, "INSS retido"),
      iss: cellNumber(row, headers, "ISS retido"),
      irrf: cellNumber(row, headers, "IRRF retido"),
      pisRet: cellNumber(row, headers, "PIS retido"),
      cofinsRet: cellNumber(row, headers, "COFINS retido"),
      csll: cellNumber(row, headers, "CSLL retido"),
      otherRet: cellNumber(row, headers, "Outras retenções"),
      allocation: cellText(row, headers, "Apropriação obra/fiscal"),
      dueDates: cellText(row, headers, "Vencimentos fornecedor"),
      status: cellText(row, headers, "Situação"),
    });
  }

  const manualCounts = new Map<string, number>();
  const nfeCounts = new Map<string, number>();
  for (const document of rows) {
    if (normalize(document.origin) === "nf-e xml") {
      if (document.accessKey) nfeCounts.set(document.accessKey, (nfeCounts.get(document.accessKey) ?? 0) + 1);
    } else {
      const supplierKey = document.taxId || document.supplier;
      const key = [document.project, supplierKey, document.type, document.number, document.series].map(normalize).join("|");
      manualCounts.set(key, (manualCounts.get(key) ?? 0) + 1);
    }
  }

  documents.getColumn(documents.columnCount + 1).values = ["Validação fiscal"];
  const validationColumn = documents.columnCount;
  documents.getColumn(documents.columnCount + 1).values = ["Pendências"];
  const pendingColumn = documents.columnCount;
  documents.getColumn(validationColumn).width = 18;
  documents.getColumn(pendingColumn).width = 80;

  const pending = workbook.addWorksheet("Pendências fiscais", { properties: { tabColor: { argb: "FFF2A900" } } });
  pending.columns = [
    { header: "Severidade", key: "severity", width: 13 },
    { header: "Código", key: "code", width: 24 },
    { header: "Origem", key: "origin", width: 18 },
    { header: "Registro Elos", key: "registry", width: 18 },
    { header: "Competência", key: "competence", width: 14 },
    { header: "Obra", key: "project", width: 30 },
    { header: "Fornecedor", key: "supplier", width: 36 },
    { header: "Documento", key: "document", width: 24 },
    { header: "Pendência", key: "message", width: 58 },
    { header: "Ação sugerida", key: "action", width: 70 },
  ];

  let errorCount = 0;
  let warningCount = 0;
  let okCount = 0;

  for (const document of rows) {
    const issues = collectBaseIssues(document);
    if (normalize(document.origin) === "nf-e xml") {
      issues.push(...validateElectronic(document));
      if (document.accessKey && (nfeCounts.get(document.accessKey) ?? 0) > 1) {
        issues.push({ severity: "ERRO", code: "NFE_DUPLICADA", message: "A mesma chave de acesso aparece mais de uma vez na exportação.", action: "Revisar duplicidade/importação da NF-e." });
      }
    } else {
      issues.push(...validateManual(document));
      const supplierKey = document.taxId || document.supplier;
      const key = [document.project, supplierKey, document.type, document.number, document.series].map(normalize).join("|");
      if ((manualCounts.get(key) ?? 0) > 1) {
        issues.push({ severity: "ERRO", code: "DOCUMENTO_DUPLICADO", message: "Fornecedor/tipo/número/série aparecem duplicados na mesma obra.", action: "Manter apenas o lançamento fiscal correto e cancelar o duplicado." });
      }
    }

    const uniqueIssues = [...new Map(issues.map((issue) => [`${issue.code}|${issue.message}`, issue])).values()];
    const hasError = uniqueIssues.some((issue) => issue.severity === "ERRO");
    const hasWarning = uniqueIssues.some((issue) => issue.severity === "ALERTA");
    const result = hasError ? "ERRO" : hasWarning ? "REVISAR" : "OK";
    document.row.getCell(validationColumn).value = result;
    document.row.getCell(pendingColumn).value = uniqueIssues.map((issue) => `${issue.severity}: ${issue.message}`).join(" | ");

    if (hasError) errorCount += 1;
    else if (hasWarning) warningCount += 1;
    else okCount += 1;

    for (const issue of uniqueIssues) {
      pending.addRow({
        severity: issue.severity,
        code: issue.code,
        origin: document.origin,
        registry: document.registry,
        competence: document.competence,
        project: document.project,
        supplier: document.supplier,
        document: `${document.number}${document.series ? `/${document.series}` : ""}`,
        message: issue.message,
        action: issue.action,
      });
    }
  }

  if (pending.rowCount === 1) {
    pending.addRow({ severity: "OK", code: "SEM_PENDENCIAS", message: "Nenhuma inconsistência fiscal detectada no período.", action: "Arquivo pronto para conferência final/contabilidade." });
  }
  styleHeader(pending);
  pending.eachRow((row, rowNumber) => {
    if (rowNumber > 1) row.alignment = { vertical: "top", wrapText: true };
  });

  styleHeader(documents);
  const readme = workbook.getWorksheet("Leia-me");
  if (readme) {
    readme.addRow(["Validação automática", `${okCount} documento(s) OK · ${warningCount} para revisar · ${errorCount} com erro impeditivo para o fechamento.`]);
    readme.addRow(["Erros", "Indicam inconsistência objetiva: valor que não fecha, documento duplicado, NF-e sem chave válida, falta de apropriação ou dados essenciais."]);
    readme.addRow(["Alertas", "Pedem conferência humana e não significam erro. Ex.: nota de serviço sem retenções ou fornecedor sem CNPJ/CPF cadastrado."]);
    readme.addRow(["Cancelamentos/substituições", "Documentos cancelados ficam fora da exportação fiscal operacional. O histórico permanece no Elos; o documento substituto deve ser lançado normalmente e será validado como um novo documento."]);
    readme.addRow(["Fechamento mensal", "Use o filtro de período dos Relatórios Financeiros e o botão Exportar fiscal. O mesmo arquivo já entrega documentos, rateio, impostos/guias e esta lista de pendências."]);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const originalDisposition = baseResponse.headers.get("Content-Disposition") || "";
  const match = originalDisposition.match(/filename=\"?([^\";]+)\"?/i);
  const originalName = match?.[1] || "elos-fiscal.xlsx";
  const fileName = originalName.replace(/\.xlsx$/i, "-validado.xlsx");

  return new Response(new Uint8Array(buffer as ArrayBuffer), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}
