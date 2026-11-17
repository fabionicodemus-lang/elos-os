const CATEGORIES = new Set(["entry", "monthly", "reinforcement", "keys", "post_keys", "other"]);
const MAX_INSTALLMENTS = 240;

function record(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} inválido.`);
  return value;
}

function text(value, label, required = false, maximum = 4000) {
  if (value == null && !required) return null;
  if (typeof value !== "string") throw new Error(`${label} deve ser informado como texto.`);
  const result = value.trim();
  if (required && !result) throw new Error(`Informe ${label.toLowerCase()}.`);
  if (result.length > maximum) throw new Error(`${label} excede o limite de ${maximum} caracteres.`);
  return result || null;
}

export function validCommercialDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function normalizeCommercialTaxId(value) {
  return typeof value === "string" ? value.replace(/[.\/\-\s]/g, "").toUpperCase() : "";
}

function date(value, label, required = true) {
  const result = text(value, label, required, 10);
  if (result && !validCommercialDate(result)) throw new Error(`${label} deve conter uma data válida (AAAA-MM-DD).`);
  return result;
}

function cents(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 1_000_000_000_000) {
    throw new Error(`${label} deve ser positivo e estar dentro do limite permitido.`);
  }
  const rounded = Math.round(value * 100);
  if (!Number.isSafeInteger(rounded) || Math.abs(value * 100 - rounded) > 0.0001) {
    throw new Error(`${label} deve ter no máximo duas casas decimais.`);
  }
  return rounded;
}

function integer(value, label, min, max) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${label} deve ser um inteiro entre ${min} e ${max}.`);
  }
  return value;
}

function percentage(value, label) {
  if (value == null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100 || Math.abs(value * 10000 - Math.round(value * 10000)) > 0.000001) {
    throw new Error(`${label} deve estar entre 0 e 100, com até quatro casas decimais.`);
  }
  return value;
}

export function addCommercialMonths(value, months) {
  if (!validCommercialDate(value)) throw new Error("Data inválida para gerar parcelas.");
  const [year, month, day] = value.split("-").map(Number);
  const target = month - 1 + months;
  const targetYear = year + Math.floor(target / 12);
  const targetMonth = ((target % 12) + 12) % 12;
  if (targetYear < 1900 || targetYear > 9999) throw new Error("Vencimento fora do intervalo permitido.");
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return `${targetYear}-${String(targetMonth + 1).padStart(2, "0")}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
}

export function normalizeCommercialDocumentInput(raw, today) {
  const input = record(raw, "Dados da venda");
  if (!validCommercialDate(today)) throw new Error("Data de referência inválida.");
  if (input.moeda !== "BRL") throw new Error("Esta importação aceita contratos em reais (BRL).");
  const saleDate = date(input.data_venda, "Data da venda");
  if (saleDate > today || saleDate < "1900-01-01") throw new Error("A data da venda deve ser válida e não pode estar no futuro.");
  const totalCents = cents(input.valor_total, "Valor total da venda");
  const client = record(input.cliente, "Cliente");
  const personType = text(client.tipo_pessoa, "Tipo de pessoa", true, 2);
  if (!["PF", "PJ"].includes(personType)) throw new Error("Informe PF ou PJ para o comprador.");
  const taxId = normalizeCommercialTaxId(text(client.cpf_cnpj, "CPF/CNPJ do comprador", true, 24));
  if (personType === "PF" ? !/^\d{11}$/.test(taxId) : !/^[A-Z0-9]{12}\d{2}$/.test(taxId)) {
    throw new Error("Confira o formato do CPF/CNPJ do comprador antes de preparar a venda.");
  }
  const birthDate = date(client.data_nascimento, "Data de nascimento", false);
  if (birthDate && birthDate > today) throw new Error("A data de nascimento não pode estar no futuro.");
  const clientData = {
    name: text(client.nome, "Nome do comprador", true, 250), personType, taxId,
    identityDocument: text(client.documento_identidade, "Documento de identidade", false, 100),
    birthDate, maritalStatus: text(client.estado_civil, "Estado civil", false, 100),
    profession: text(client.profissao, "Profissão", false, 150),
    email: text(client.email, "E-mail", false, 254), phone: text(client.telefone, "Telefone", false, 50),
    secondaryPhone: text(client.telefone_secundario, "Telefone secundário", false, 50),
    address: text(client.endereco, "Endereço", false, 1000), postalCode: text(client.cep, "CEP", false, 20),
    city: text(client.cidade, "Cidade", false, 150), state: text(client.estado, "Estado", false, 100),
    nationality: text(client.nacionalidade, "Nacionalidade", false, 100),
  };
  const clauses = [];
  if (!Array.isArray(input.clausulas_pendentes) || input.clausulas_pendentes.length > 30) throw new Error("Informe as cláusulas pendentes como lista de até 30 itens.");
  for (const clause of input.clausulas_pendentes) clauses.push(text(clause, "Cláusula pendente", true, 1000));
  const flags = [
    ["tem_permuta", "O contrato contém permuta/dação, que precisa ser registrada no fluxo de incorporação."],
    ["tem_multiplos_compradores", "O contrato contém mais de um comprador/participante e exige revisão dos vínculos contratuais."],
    ["tem_vencimento_por_evento", "Existem vencimentos condicionados a eventos sem data definitiva."],
    ["tem_troca_indice_por_evento", "Existe troca de índice ou regra financeira condicionada a evento."],
    ["tem_pagamento_ja_realizado", "O documento declara pagamentos já realizados. Concilie os valores antes de importar todos os títulos em aberto."],
  ];
  for (const [key, message] of flags) {
    if (typeof input[key] !== "boolean") throw new Error(`A leitura do documento precisa esclarecer ${key}.`);
    if (input[key]) clauses.push(message);
  }
  if (typeof input.regras_financeiras_completas !== "boolean") throw new Error("Confirme se todas as regras financeiras foram identificadas.");
  if (!input.regras_financeiras_completas) clauses.push("A leitura ainda não identificou todas as condições financeiras do contrato.");
  if (!Array.isArray(input.condicoes_pagamento) || !input.condicoes_pagamento.length || input.condicoes_pagamento.length > 24) {
    throw new Error("Informe entre 1 e 24 séries de pagamento.");
  }
  let plannedCents = 0;
  let totalInstallments = 0;
  let hasCorrection = false;
  const paymentItems = input.condicoes_pagamento.map((value, index) => {
    const row = record(value, `Condição ${index + 1}`);
    if (!CATEGORIES.has(row.categoria)) throw new Error(`Categoria inválida na condição ${index + 1}.`);
    const installmentCount = integer(row.quantidade, `Quantidade da condição ${index + 1}`, 1, MAX_INSTALLMENTS);
    const intervalMonths = integer(row.intervalo_meses, `Intervalo da condição ${index + 1}`, 0, 120);
    if (installmentCount > 1 && intervalMonths === 0) throw new Error(`A condição ${index + 1} tem várias parcelas sem intervalo. Informe cada vencimento em uma série separada.`);
    const amountCents = cents(row.valor_parcela, `Valor da parcela da condição ${index + 1}`);
    const correctionIndexLabel = text(row.indice_correcao, `Índice da condição ${index + 1}`, false, 100);
    hasCorrection ||= Boolean(correctionIndexLabel);
    const interestRateMonthly = percentage(row.juros_mensais, `Juros da condição ${index + 1}`);
    if ((interestRateMonthly ?? 0) > 0) clauses.push(`A condição ${index + 1} possui juros mensais de ${interestRateMonthly}%. O motor atual não aplica essa taxa automaticamente neste fluxo.`);
    const paymentMethod = text(row.forma_pagamento, `Forma de pagamento da condição ${index + 1}`, false, 120);
    const originalNotes = text(row.observacoes, `Observações da condição ${index + 1}`);
    const notes = [originalNotes, paymentMethod ? `Forma de pagamento: ${paymentMethod}.` : null].filter(Boolean).join("\n") || null;
    totalInstallments += installmentCount;
    plannedCents += amountCents * installmentCount;
    return {
      category: row.categoria, description: text(row.descricao, `Descrição da condição ${index + 1}`, true, 250),
      installmentCount, firstDueDate: date(row.primeiro_vencimento, `Primeiro vencimento da condição ${index + 1}`),
      intervalMonths, amountPerInstallment: amountCents / 100, correctionIndexLabel,
      interestRateMonthly, paymentMethod, notes, total: (amountCents * installmentCount) / 100,
    };
  });
  if (totalInstallments > MAX_INSTALLMENTS) throw new Error(`O plano deve conter no máximo ${MAX_INSTALLMENTS} parcelas no total.`);
  if (!Number.isSafeInteger(plannedCents) || plannedCents !== totalCents) {
    throw new Error(`As condições somam R$ ${(plannedCents / 100).toFixed(2)} e o contrato informa R$ ${(totalCents / 100).toFixed(2)}. Corrija a diferença antes de preparar.`);
  }
  const correctionStartMonth = input.inicio_correcao_meses == null ? null : integer(input.inicio_correcao_meses, "Início da correção em meses após a venda", 0, 60);
  if (hasCorrection && correctionStartMonth == null) clauses.push("Informe o início contratual da correção em meses após a venda; o padrão do sistema não será presumido.");
  const installments = paymentItems.flatMap((item) => Array.from({ length: item.installmentCount }, (_, index) => ({
    category: item.category, description: item.description, sequenceNumber: index + 1, sequenceTotal: item.installmentCount,
    dueDate: addCommercialMonths(item.firstDueDate, item.intervalMonths * index), amount: item.amountPerInstallment,
    correctionIndexLabel: item.correctionIndexLabel, interestRateMonthly: item.interestRateMonthly, paymentMethod: item.paymentMethod,
  })));
  return {
    saleDate, contractNumber: text(input.numero_contrato, "Número/identificação do contrato", true, 150),
    totalAmount: totalCents / 100, commissionPct: percentage(input.comissao_percentual, "Comissão") ?? 0,
    brokerName: text(input.corretor, "Corretor", false, 250), correctionStartMonth,
    clientData, paymentItems, installments, unsupportedClauses: [...new Set(clauses)],
    notes: text(input.observacoes, "Observações da venda"),
  };
}
