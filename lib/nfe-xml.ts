export type NfeParty = {
  taxId: string;
  name: string;
  tradeName: string;
  stateRegistration: string;
  email: string;
  phone: string;
  city: string;
  state: string;
};

export type NfeItem = {
  lineNumber: number;
  supplierCode: string;
  ean: string;
  description: string;
  ncm: string;
  cfop: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  grossAmount: number;
  discountAmount: number;
  freightAmount: number;
  otherAmount: number;
  totalAmount: number;
  icmsAmount: number;
  ipiAmount: number;
  pisAmount: number;
  cofinsAmount: number;
};

export type NfeInstallment = {
  number: string;
  dueDate: string;
  amount: number;
  paymentMethod: string;
};

export type ParsedNfe = {
  accessKey: string;
  model: string;
  series: string;
  number: string;
  issueDate: string;
  issueDateTime: string;
  natureOperation: string;
  issuer: NfeParty;
  recipient: NfeParty;
  totals: {
    products: number;
    freight: number;
    insurance: number;
    discount: number;
    importTax: number;
    ipi: number;
    pis: number;
    cofins: number;
    icms: number;
    other: number;
    invoice: number;
  };
  items: NfeItem[];
  installments: NfeInstallment[];
};

type XmlBlock = { attributes: string; content: string };

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decodeXml(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

function blocks(xml: string, tag: string): XmlBlock[] {
  const safeTag = escapeRegExp(tag);
  const pattern = new RegExp(`<(?:(?:[\\w.-]+):)?${safeTag}\\b([^>]*)>([\\s\\S]*?)<\\/(?:(?:[\\w.-]+):)?${safeTag}>`, "gi");
  return Array.from(xml.matchAll(pattern), (match) => ({ attributes: match[1] ?? "", content: match[2] ?? "" }));
}

function firstBlock(xml: string, tag: string) {
  return blocks(xml, tag)[0]?.content ?? "";
}

function text(xml: string, tag: string) {
  const value = firstBlock(xml, tag);
  return value ? decodeXml(value.replace(/<[^>]+>/g, "")) : "";
}

function attribute(attributes: string, name: string) {
  const match = attributes.match(new RegExp(`${escapeRegExp(name)}\\s*=\\s*["']([^"']*)["']`, "i"));
  return decodeXml(match?.[1] ?? "");
}

function numeric(xml: string, tag: string) {
  const value = Number(text(xml, tag).replace(",", "."));
  return Number.isFinite(value) ? value : 0;
}

function digits(value: string) {
  return value.replace(/\D/g, "");
}

function party(xml: string): NfeParty {
  const address = firstBlock(xml, "enderEmit") || firstBlock(xml, "enderDest");
  return {
    taxId: digits(text(xml, "CNPJ") || text(xml, "CPF")),
    name: text(xml, "xNome"),
    tradeName: text(xml, "xFant"),
    stateRegistration: text(xml, "IE"),
    email: text(xml, "email"),
    phone: text(address, "fone"),
    city: text(address, "xMun"),
    state: text(address, "UF"),
  };
}

const PAYMENT_METHODS: Record<string, string> = {
  "01": "Dinheiro",
  "02": "Cheque",
  "03": "Cartão de crédito",
  "04": "Cartão de débito",
  "05": "Crédito loja",
  "10": "Vale alimentação",
  "11": "Vale refeição",
  "12": "Vale presente",
  "13": "Vale combustível",
  "14": "Duplicata mercantil",
  "15": "Boleto bancário",
  "16": "Depósito bancário",
  "17": "PIX",
  "18": "Transferência bancária",
  "19": "Programa de fidelidade",
  "90": "Sem pagamento",
  "99": "Outros",
};

export function normalizeTaxId(value: string | null | undefined) {
  return digits(String(value ?? ""));
}

export function normalizeMatchText(value: string | null | undefined) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

export function parseNfeXml(rawXml: string): ParsedNfe {
  const xml = rawXml.replace(/^\uFEFF/, "").trim();
  if (!xml || !/<(?:(?:[\w.-]+):)?(?:nfeProc|NFe)\b/i.test(xml)) {
    throw new Error("O arquivo não contém uma NF-e válida.");
  }

  const infNfe = blocks(xml, "infNFe")[0];
  if (!infNfe) throw new Error("A NF-e não possui o bloco infNFe.");

  const ide = firstBlock(infNfe.content, "ide");
  const issuerBlock = firstBlock(infNfe.content, "emit");
  const recipientBlock = firstBlock(infNfe.content, "dest");
  const totalsBlock = firstBlock(firstBlock(infNfe.content, "total"), "ICMSTot");
  const issueDateTime = text(ide, "dhEmi") || text(ide, "dEmi");
  const idAccessKey = digits(attribute(infNfe.attributes, "Id").replace(/^NFe/i, ""));
  const protocolAccessKey = digits(text(xml, "chNFe"));
  const accessKey = protocolAccessKey || idAccessKey;

  if (accessKey.length !== 44) throw new Error("A chave de acesso da NF-e não foi identificada corretamente.");

  const parsedItems = blocks(infNfe.content, "det").map((det, index): NfeItem => {
    const product = firstBlock(det.content, "prod");
    const tax = firstBlock(det.content, "imposto");
    const quantity = numeric(product, "qCom");
    const unitPrice = numeric(product, "vUnCom");
    const grossAmount = numeric(product, "vProd") || quantity * unitPrice;
    const discountAmount = numeric(product, "vDesc");
    const freightAmount = numeric(product, "vFrete");
    const otherAmount = numeric(product, "vOutro") + numeric(product, "vSeg");
    return {
      lineNumber: Number(attribute(det.attributes, "nItem")) || index + 1,
      supplierCode: text(product, "cProd"),
      ean: text(product, "cEAN") || text(product, "cEANTrib"),
      description: text(product, "xProd"),
      ncm: text(product, "NCM"),
      cfop: text(product, "CFOP"),
      unit: text(product, "uCom") || text(product, "uTrib"),
      quantity,
      unitPrice,
      grossAmount,
      discountAmount,
      freightAmount,
      otherAmount,
      totalAmount: grossAmount - discountAmount + freightAmount + otherAmount,
      icmsAmount: numeric(tax, "vICMS"),
      ipiAmount: numeric(tax, "vIPI"),
      pisAmount: numeric(tax, "vPIS"),
      cofinsAmount: numeric(tax, "vCOFINS"),
    };
  });

  if (!parsedItems.length) throw new Error("A NF-e não possui produtos para importação.");

  const paymentMethodCode = text(firstBlock(firstBlock(infNfe.content, "pag"), "detPag"), "tPag");
  let parsedInstallments = blocks(firstBlock(infNfe.content, "cobr"), "dup").map((dup, index): NfeInstallment => ({
    number: text(dup.content, "nDup") || String(index + 1),
    dueDate: text(dup.content, "dVenc") || issueDateTime.slice(0, 10),
    amount: numeric(dup.content, "vDup"),
    paymentMethod: PAYMENT_METHODS[paymentMethodCode] || paymentMethodCode || "Não informado",
  })).filter((installment) => installment.amount > 0);

  const invoiceTotal = numeric(totalsBlock, "vNF");
  if (!parsedInstallments.length) {
    const paymentAmount = numeric(firstBlock(firstBlock(infNfe.content, "pag"), "detPag"), "vPag") || invoiceTotal;
    parsedInstallments = [{
      number: "1",
      dueDate: issueDateTime.slice(0, 10),
      amount: paymentAmount,
      paymentMethod: PAYMENT_METHODS[paymentMethodCode] || paymentMethodCode || "Não informado",
    }];
  }

  return {
    accessKey,
    model: text(ide, "mod"),
    series: text(ide, "serie"),
    number: text(ide, "nNF"),
    issueDate: issueDateTime.slice(0, 10),
    issueDateTime,
    natureOperation: text(ide, "natOp"),
    issuer: party(issuerBlock),
    recipient: party(recipientBlock),
    totals: {
      products: numeric(totalsBlock, "vProd"),
      freight: numeric(totalsBlock, "vFrete"),
      insurance: numeric(totalsBlock, "vSeg"),
      discount: numeric(totalsBlock, "vDesc"),
      importTax: numeric(totalsBlock, "vII"),
      ipi: numeric(totalsBlock, "vIPI"),
      pis: numeric(totalsBlock, "vPIS"),
      cofins: numeric(totalsBlock, "vCOFINS"),
      icms: numeric(totalsBlock, "vICMS"),
      other: numeric(totalsBlock, "vOutro"),
      invoice: invoiceTotal,
    },
    items: parsedItems,
    installments: parsedInstallments,
  };
}
