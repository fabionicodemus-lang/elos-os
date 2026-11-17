import type { ReactNode } from "react";

type Preview = Record<string, unknown>;
type DocumentActionKind = "commercial_sale_create" | "procurement_quotation_create" | "execution_contract_create";
type Field = readonly [label: string, value: string];

const EMPTY = "Não informado";
const ACTION_LABELS: Record<DocumentActionKind, string> = {
  commercial_sale_create: "Confirmar e criar venda",
  procurement_quotation_create: "Confirmar e registrar cotação",
  execution_contract_create: "Confirmar e criar contrato",
};
const PAYMENT_CATEGORIES: Record<string, string> = {
  entry: "Entrada", monthly: "Mensais", reinforcement: "Reforço", keys: "Chaves", post_keys: "Pós-chaves", other: "Outros",
};
const PAYMENT_METHODS: Record<string, string> = {
  pix: "Pix", boleto: "Boleto", bank_slip: "Boleto", cash: "Dinheiro", transfer: "Transferência",
  bank_transfer: "Transferência bancária", credit_card: "Cartão de crédito", debit_card: "Cartão de débito", check: "Cheque", cheque: "Cheque", other: "Outro",
};
const STATUS_LABELS: Record<string, string> = {
  available: "Disponível", reserved: "Reservada", sold: "Vendida", draft: "Em elaboração", sent: "Enviada", negotiation: "Em negociação", approved: "Aprovada", rejected: "Rejeitada", cancelled: "Cancelada",
};

export function isDocumentAction(kind: string): kind is DocumentActionKind {
  return Object.prototype.hasOwnProperty.call(ACTION_LABELS, kind);
}

export function documentActionLabel(kind: string) {
  return isDocumentAction(kind) ? ACTION_LABELS[kind] : "Revisado · lançar no Elos";
}

function record(value: unknown): Preview {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Preview : {};
}

function rows(value: unknown): Preview[] {
  return Array.isArray(value) ? value.filter((item) => item !== null && typeof item === "object" && !Array.isArray(item)).map(record) : [];
}

function text(value: unknown, fallback = EMPTY): string {
  if (typeof value === "string") return value.trim() || fallback;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

function messages(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function numeric(value: unknown): number | null {
  if ((typeof value !== "string" && typeof value !== "number") || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function number(value: unknown, digits = 6): string {
  const parsed = numeric(value);
  return parsed === null ? EMPTY : parsed.toLocaleString("pt-BR", { maximumFractionDigits: digits });
}

function money(value: unknown, digits = 2): string {
  const parsed = numeric(value);
  return parsed === null ? EMPTY : parsed.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: digits });
}

function percent(value: unknown): string {
  return numeric(value) === null ? EMPTY : `${number(value)}%`;
}

function date(value: unknown): string {
  if (typeof value !== "string") return EMPTY;
  const parts = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(value);
  return parts ? `${parts[3]}/${parts[2]}/${parts[1]}` : text(value);
}

function dateTime(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return date(value);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? EMPTY : new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo",
  }).format(parsed);
}

function label(value: unknown, labels: Record<string, string>): string {
  const raw = text(value);
  return Object.prototype.hasOwnProperty.call(labels, raw) ? labels[raw] : raw;
}

function duration(value: unknown, singular: string, plural: string): string {
  const parsed = numeric(value);
  return parsed === null ? EMPTY : `${number(parsed)} ${parsed === 1 ? singular : plural}`;
}

function Metadata({ fields }: { fields: Field[] }) {
  return <div className="elos-ia-action-meta">{fields.map(([name, value]) => (
    <div key={name}><span>{name}</span><strong>{value}</strong></div>
  ))}</div>;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section aria-label={title}><h4 className="elos-ia-action-note">{title}</h4>{children}</section>;
}

function ReviewTable({ title, headers, children }: { title: string; headers: string[]; children: ReactNode }) {
  return <div className="elos-ia-action-table" role="region" aria-label={title} tabIndex={0}>
    <table aria-label={title}><thead><tr>{headers.map((header) => <th key={header} scope="col">{header}</th>)}</tr></thead><tbody>{children}</tbody></table>
  </div>;
}

function Note({ title, value }: { title: string; value: unknown }) {
  return <p className="elos-ia-action-note" style={{ whiteSpace: "pre-wrap" }}><strong>{title}: </strong>{text(value)}</p>;
}

function MessageList({ title, values }: { title: string; values: string[] }) {
  return values.length ? <section className="elos-ia-action-note" aria-label={title}>
    <strong>{title}</strong><ul>{values.map((value, index) => <li key={`${index}-${value}`}>{value}</li>)}</ul>
  </section> : null;
}

function SalePreview({ preview }: { preview: Preview }) {
  const project = record(preview.project);
  const unit = record(preview.unit);
  const client = record(preview.client);
  const details = record(client.details);
  const paymentItems = rows(preview.paymentItems);
  const installments = rows(preview.installments);
  const competingProposals = rows(preview.competingProposals);
  const correctionMonth = numeric(preview.correctionStartMonth);

  return <>
    <Section title="Venda e unidade">
      <Metadata fields={[
        ["Obra", text(project.label)], ["Unidade", text(unit.code)], ["Torre", text(unit.tower)],
        ["Situação atual da unidade", label(unit.status, STATUS_LABELS)], ["Número do contrato", text(preview.contractNumber)],
        ["Data da venda", date(preview.saleDate)], ["Valor da venda", money(preview.totalAmount)],
        ["Preço de tabela usado", money(preview.listPrice)], ["Desconto sobre a tabela", money(preview.discountAmount)],
        ["Corretor", text(preview.brokerName)], ["Comissão", percent(preview.commissionPct)],
        ["Início da correção", correctionMonth === null ? EMPTY : correctionMonth === 0 ? "Mês da venda (mês 0)" : `Mês ${number(correctionMonth, 0)} após a venda`],
      ]} />
    </Section>
    <Section title="Cliente da venda">
      <Metadata fields={[
        ["Nome / razão social", text(client.name)], ["CPF / CNPJ", text(client.taxId)],
        ["Tipo de pessoa", label(client.personType, { PF: "Pessoa física", PJ: "Pessoa jurídica", OTHER: "Outro" })],
        ["Cadastro do cliente", client.isNew === true ? "Criar novo cliente" : "Usar cliente cadastrado"],
      ]} />
      {client.isNew === true ? <Metadata fields={[
        ["Documento de identidade", text(details.identityDocument)], ["Nascimento", date(details.birthDate)],
        ["Estado civil", text(details.maritalStatus)], ["Profissão", text(details.profession)],
        ["Nacionalidade", text(details.nationality)], ["E-mail", text(details.email)],
        ["Telefone", text(details.phone)], ["Telefone adicional", text(details.secondaryPhone)],
        ["Endereço", text(details.address)], ["CEP", text(details.postalCode)], ["Cidade", text(details.city)], ["UF", text(details.state)],
      ]} /> : null}
    </Section>
    <Section title={`Séries do pagamento (${paymentItems.length})`}>
      {paymentItems.length ? <ReviewTable title="Todas as séries do pagamento" headers={["Série e descrição", "Parcelas", "Primeiro vencimento", "Intervalo", "Valor por parcela", "Total", "Correção e juros", "Forma e observações"]}>
        {paymentItems.map((item, index) => <tr key={index}>
          <td><strong>{label(item.category, PAYMENT_CATEGORIES)}</strong><div>{text(item.description)}</div></td>
          <td>{number(item.installmentCount, 0)}</td><td>{date(item.firstDueDate)}</td><td>{duration(item.intervalMonths, "mês", "meses")}</td>
          <td>{money(item.amountPerInstallment)}</td><td>{money(item.total)}</td>
          <td>{text(item.correctionIndexLabel, item.correctionIndexId ? "Índice sem descrição" : "Sem índice")}<small>Juros ao mês: {percent(item.interestRateMonthly)}</small></td>
          <td>{label(item.paymentMethod, PAYMENT_METHODS)}<small>{text(item.notes, "Sem observações adicionais")}</small></td>
        </tr>)}
      </ReviewTable> : <p className="elos-ia-action-note">Nenhuma série de pagamento informada.</p>}
    </Section>
    <Section title={`Parcelas previstas (${installments.length})`}>
      {installments.length ? <ReviewTable title="Todas as parcelas previstas da venda" headers={["Série e descrição", "Parcela", "Vencimento", "Valor", "Índice", "Juros ao mês", "Forma"]}>
        {installments.map((item, index) => <tr key={index}>
          <td><strong>{label(item.category, PAYMENT_CATEGORIES)}</strong><div>{text(item.description)}</div></td>
          <td>{number(item.sequenceNumber, 0)} / {number(item.sequenceTotal, 0)}</td><td>{date(item.dueDate)}</td><td>{money(item.amount)}</td>
          <td>{text(item.correctionIndexLabel, "Sem índice")}</td><td>{percent(item.interestRateMonthly)}</td><td>{label(item.paymentMethod, PAYMENT_METHODS)}</td>
        </tr>)}
      </ReviewTable> : <p className="elos-ia-action-note">Nenhuma parcela prevista informada.</p>}
    </Section>
    <Note title="Observações da venda" value={preview.notes} />
    {competingProposals.length ? <Section title="Outras propostas da unidade">
      <ReviewTable title="Propostas concorrentes para conferir" headers={["Proposta", "Situação", "Última atualização"]}>
        {competingProposals.map((proposal, index) => <tr key={text(proposal.id, String(index))}>
          <td>{text(proposal.number)}</td><td>{label(proposal.status, STATUS_LABELS)}</td><td>{dateTime(proposal.updatedAt)}</td>
        </tr>)}
      </ReviewTable>
    </Section> : null}
  </>;
}

function QuotationPreview({ preview }: { preview: Preview }) {
  const project = record(preview.project);
  const request = record(preview.request);
  const supplier = record(preview.supplier);
  const items = rows(preview.items);

  return <>
    <Section title="Cotação e fornecedor">
      <Metadata fields={[
        ["Obra", text(project.label)], ["Solicitação de materiais", text(request.number)], ["Título da cotação", text(preview.title)],
        ["Fornecedor", text(supplier.name)], ["CPF / CNPJ", text(supplier.taxId)], ["Proposta do fornecedor", text(preview.proposalNumber)],
        ["Data da proposta", date(preview.proposalDate)], ["Validade da proposta", date(preview.validityDate)],
        ["Fechamento", label(preview.awardMode, { item: "Por item", lot: "Por lote" })], ["Prazo de resposta", date(preview.responseDeadline)],
        ["Entrega desejada", date(preview.desiredDeliveryDate)], ["Prazo de entrega", duration(preview.deliveryDays, "dia", "dias")],
        ["Frete total", money(preview.freightTotal)], ["Outros custos totais", money(preview.otherTotal)], ["Total da proposta", money(preview.total)],
      ]} />
      <Note title="Condições de pagamento" value={preview.paymentTerms} />
      <Note title="Endereço de entrega" value={preview.deliveryAddress} />
      <Note title="Condições de frete" value={preview.freightTerms} />
      <Note title="Garantia" value={preview.warrantyTerms} />
    </Section>
    <Section title={`Itens e valores da proposta (${items.length})`}>
      {items.length ? <ReviewTable title="Todos os itens e valores da proposta" headers={["Material", "Quantidade", "Preço unitário", "Desconto", "Impostos", "Frete", "Outros custos", "Total"]}>
        {items.map((item, index) => <tr key={index}>
          <td><strong>{text(item.code)}</strong><div>{text(item.name)}</div><small>Centro de custo: {text(item.costCenter)}</small></td>
          <td>{number(item.quantity)} {text(item.unit, "")}</td><td>{money(item.unitPrice, 6)}</td>
          <td>{percent(item.discountPercent)}</td><td>{percent(item.taxPercent)}</td><td>{money(item.freight)}</td><td>{money(item.otherCost)}</td><td>{money(item.total)}</td>
        </tr>)}
      </ReviewTable> : <p className="elos-ia-action-note">Nenhum item informado.</p>}
    </Section>
    {items.length ? <Section title="Especificações e condições por material">
      <ReviewTable title="Especificações e condições de todos os materiais" headers={["Material", "Marca", "Fabricante", "Prazo de entrega", "Atendimento à especificação", "Observações técnicas"]}>
        {items.map((item, index) => <tr key={index}>
          <td><strong>{text(item.code)}</strong><div>{text(item.name)}</div></td><td>{text(item.brand)}</td><td>{text(item.manufacturer)}</td>
          <td>{duration(item.deliveryDays, "dia", "dias")}</td>
          <td>{item.specificationConfirmed !== true ? "Sem aceite técnico · não confirmado" : item.meetsSpecification === true ? "Atende" : "Não atende"}</td>
          <td>{text(item.technicalNotes)}</td>
        </tr>)}
      </ReviewTable>
    </Section> : null}
    <Note title="Observações da cotação" value={preview.notes} />
  </>;
}

function ContractPreview({ preview }: { preview: Preview }) {
  const project = record(preview.project);
  const competition = record(preview.competition);
  const supplier = record(preview.supplier);
  const items = rows(preview.items);

  return <>
    <Section title="Contrato e empreiteiro">
      <Metadata fields={[
        ["Obra", text(project.label)], ["Título do contrato", text(preview.title)], ["Concorrência aprovada", text(competition.number)],
        ["Título da concorrência", text(competition.title)], ["Empreiteiro", text(supplier.name)], ["CPF / CNPJ", text(supplier.taxId)],
        ["Data da assinatura", date(preview.signedDate)], ["Início", date(preview.startDate)], ["Término", date(preview.endDate)],
        ["Valor contratado", money(preview.total)], ["Retenção contratual", percent(preview.retentionPercent)], ["Retenção de garantia", percent(preview.guaranteePercent)],
        ["Prazo de garantia", duration(preview.guaranteeMonths, "mês", "meses")], ["Pagamento após a medição", duration(preview.paymentDays, "dia", "dias")],
        ["Índice de reajuste", text(preview.adjustmentIndex)], ["Data-base do reajuste", date(preview.adjustmentBaseDate)],
        ["Contato", text(preview.contactName)], ["Telefone do contato", text(preview.contactPhone)], ["E-mail do contato", text(preview.contactEmail)],
      ]} />
      <Note title="Escopo contratado" value={preview.scopeSummary} />
    </Section>
    <Section title={`Serviços do contrato (${items.length})`}>
      {items.length ? <ReviewTable title="Todos os serviços do contrato" headers={["Serviço", "Local", "Quantidade", "Preço unitário", "Total"]}>
        {items.map((item, index) => <tr key={index}>
          <td><strong>{text(item.code)}</strong><div>{text(item.name)}</div>
            {item.scopeNotes ? <small>Escopo do serviço: {text(item.scopeNotes)}</small> : null}
            {item.measurementNotes ? <small>Critérios de medição: {text(item.measurementNotes)}</small> : null}
          </td><td>{text(item.location)}</td>
          <td>{number(item.quantity)} {text(item.unit, "")}</td><td>{money(item.unitPrice, 6)}</td><td>{money(item.total)}</td>
        </tr>)}
      </ReviewTable> : <p className="elos-ia-action-note">Nenhum serviço informado.</p>}
    </Section>
    <Section title="Etapas de medição por serviço">
      {items.some((item) => rows(item.stages).length > 0) ? <ReviewTable title="Todas as etapas e pesos de medição" headers={["Serviço", "Etapa", "Descrição", "Modo de medição", "Peso"]}>
        {items.flatMap((item, itemIndex) => rows(item.stages).map((stage, stageIndex) => <tr key={`${itemIndex}-${stageIndex}`}>
          <td><strong>{text(item.code)}</strong><div>{text(item.name)}</div><small>{text(item.location)}</small></td>
          <td>{stageIndex + 1}. {text(stage.name)}</td><td>{text(stage.description)}</td>
          <td>{label(stage.measurementMode, { quantity: "Por quantidade", percent: "Por percentual" })}</td><td>{percent(stage.weightPercent)}</td>
        </tr>))}
      </ReviewTable> : <p className="elos-ia-action-note">Nenhuma etapa de medição informada.</p>}
    </Section>
    <Note title="Observações do contrato" value={preview.notes} />
  </>;
}

function SourceEvidence({ preview }: { preview: Preview }) {
  const evidence = rows(preview.sourceEvidence);
  if (!evidence.length) return null;
  return <Section title="Trechos de origem dos dados">
    <ReviewTable title="Referências ao documento de origem" headers={["Campo", "Documento", "Página", "Trecho"]}>
      {evidence.map((item, index) => <tr key={index}>
        <td>{text(item.field)}</td><td>{text(item.sourceFile, text(preview.sourceFile))}</td><td>{number(item.page, 0)}</td><td>{text(item.excerpt)}</td>
      </tr>)}
    </ReviewTable>
  </Section>;
}

export function ElosIaDocumentPreview({ preview, kind }: { preview: Preview; kind: string }) {
  if (!isDocumentAction(kind)) return null;
  const pending = [...messages(preview.unsupportedClauses), ...messages(preview.pendingFields)];
  if (preview.blocked === true && typeof preview.blockReason === "string" && preview.blockReason.trim()) pending.unshift(preview.blockReason);

  return <div className="elos-ia-action-body">
    <Metadata fields={[["Documento de origem", text(preview.sourceFile)]]} />
    {kind === "commercial_sale_create" ? <SalePreview preview={preview} /> : null}
    {kind === "procurement_quotation_create" ? <QuotationPreview preview={preview} /> : null}
    {kind === "execution_contract_create" ? <ContractPreview preview={preview} /> : null}
    <SourceEvidence preview={preview} />
    <MessageList title="Pendências para resolver" values={[...new Set(pending)]} />
    <MessageList title="Pontos para conferir" values={messages(preview.warnings)} />
    <MessageList title="O que a confirmação gera" values={messages(preview.effects)} />
    <p className="elos-ia-action-note">Confira todos os dados, valores e condições desta revisão. Para corrigir, descarte esta ação e informe o ajuste na conversa; o Elos preparará uma nova revisão antes da confirmação.</p>
  </div>;
}
