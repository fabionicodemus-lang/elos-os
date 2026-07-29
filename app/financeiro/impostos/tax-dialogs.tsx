"use client";

import { useRef } from "react";
import { saveTaxObligation, saveTaxType } from "./actions";

export type TaxSupplierOption = {
  id: string;
  legal_name: string;
  trade_name: string | null;
  tax_id: string | null;
};

export type TaxProjectOption = {
  id: string;
  name: string;
  code: string | null;
};

export type TaxTypeOption = {
  id: string;
  code: string;
  name: string;
  category: string;
  authority_supplier_id: string;
  fiscal_class: string | null;
  payment_method: string | null;
  document_prefix: string | null;
  notes: string | null;
  status: "active" | "inactive";
};

export type TaxObligationData = {
  id: string;
  project_id: string;
  tax_type_id: string;
  competence_date: string;
  reference: string;
  due_date: string;
  principal_amount: number;
  interest_amount: number;
  penalty_amount: number;
  other_amount: number;
  discount_amount: number;
  document_number: string | null;
  payment_code: string | null;
  barcode: string | null;
  notes: string | null;
};

const categoryLabels: Record<string, string> = {
  federal: "Federal",
  state: "Estadual",
  municipal: "Municipal",
  labor: "Trabalhista",
  social: "Previdenciário / social",
  property: "Patrimonial",
  other: "Outro",
};

function monthNow() {
  return new Date().toISOString().slice(0, 7);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function decimal(value: number | null | undefined) {
  return Number(value ?? 0).toFixed(2).replace(".", ",");
}

export function TaxTypeDialog({ suppliers, initial, label }: {
  suppliers: TaxSupplierOption[];
  initial?: TaxTypeOption | null;
  label?: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  return <>
    <button className={initial ? "table-action" : "elos-button"} type="button" onClick={() => dialogRef.current?.showModal()}>
      {label ?? (initial ? "Editar" : "+ Novo tributo")}
    </button>
    <dialog className="tax-dialog" ref={dialogRef}>
      <form action={saveTaxType}>
        <input type="hidden" name="tax_type_id" value={initial?.id ?? ""} />
        <header>
          <div><span>Financeiro · Impostos</span><h2>{initial ? "Editar tributo" : "Cadastrar tributo"}</h2><p>Defina o tipo de obrigação e o órgão que receberá o pagamento.</p></div>
          <button type="button" onClick={() => dialogRef.current?.close()} aria-label="Fechar">×</button>
        </header>
        <div className="tax-dialog-body">
          <div className="tax-form-grid">
            <label>Código<input name="code" defaultValue={initial?.code ?? ""} placeholder="Ex.: ISS, INSS, IRPJ" required /></label>
            <label className="wide">Nome do tributo<input name="name" defaultValue={initial?.name ?? ""} placeholder="Ex.: Imposto Sobre Serviços" required /></label>
            <label>Categoria<select name="category" defaultValue={initial?.category ?? "other"}>{Object.entries(categoryLabels).map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>
            <label>Status<select name="status" defaultValue={initial?.status ?? "active"}><option value="active">Ativo</option><option value="inactive">Inativo</option></select></label>
            <label className="wide">Órgão / favorecido<select name="authority_supplier_id" defaultValue={initial?.authority_supplier_id ?? ""} required><option value="">Selecione o fornecedor ou órgão</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.trade_name || supplier.legal_name}{supplier.tax_id ? ` · ${supplier.tax_id}` : ""}</option>)}</select><small>O favorecido será usado quando a conta a pagar for gerada.</small></label>
            <label>Classe fiscal<input name="fiscal_class" defaultValue={initial?.fiscal_class ?? ""} placeholder="Ex.: Tributos municipais" /></label>
            <label>Forma de pagamento<input name="payment_method" defaultValue={initial?.payment_method ?? ""} placeholder="Ex.: Guia / PIX" /></label>
            <label>Prefixo do documento<input name="document_prefix" defaultValue={initial?.document_prefix ?? ""} placeholder="Ex.: GUIA" /></label>
            <label className="wide">Observações<textarea name="notes" rows={3} defaultValue={initial?.notes ?? ""} placeholder="Regras internas, responsável ou instruções de conferência." /></label>
          </div>
        </div>
        <footer><button type="button" onClick={() => dialogRef.current?.close()}>Cancelar</button><button className="primary" type="submit">Salvar tributo</button></footer>
      </form>
    </dialog>
  </>;
}

export function TaxObligationDialog({ projects, taxTypes, activeProjectId, initial, label }: {
  projects: TaxProjectOption[];
  taxTypes: TaxTypeOption[];
  activeProjectId: string | null;
  initial?: TaxObligationData | null;
  label?: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const activeTypes = taxTypes.filter((item) => item.status === "active" || item.id === initial?.tax_type_id);

  return <>
    <button className={initial ? "table-action" : "elos-button"} type="button" disabled={!projects.length || !activeTypes.length} onClick={() => dialogRef.current?.showModal()}>
      {label ?? (initial ? "Editar" : "+ Nova obrigação")}
    </button>
    <dialog className="tax-dialog wide-dialog" ref={dialogRef}>
      <form action={saveTaxObligation}>
        <input type="hidden" name="obligation_id" value={initial?.id ?? ""} />
        <header>
          <div><span>Financeiro · Agenda fiscal</span><h2>{initial ? "Editar obrigação fiscal" : "Nova obrigação fiscal"}</h2><p>Informe a competência, o vencimento real e os valores da guia.</p></div>
          <button type="button" onClick={() => dialogRef.current?.close()} aria-label="Fechar">×</button>
        </header>
        <div className="tax-dialog-body">
          <div className="tax-form-grid">
            <label className="wide">Empreendimento<select name="project_id" defaultValue={initial?.project_id ?? activeProjectId ?? ""} required><option value="">Selecione o empreendimento</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.code ? `${project.code} · ` : ""}{project.name}</option>)}</select></label>
            <label className="wide">Tributo<select name="tax_type_id" defaultValue={initial?.tax_type_id ?? ""} required><option value="">Selecione o tributo</option>{activeTypes.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></label>
            <label>Competência<input name="competence_date" type="month" defaultValue={initial?.competence_date.slice(0, 7) ?? monthNow()} required /></label>
            <label>Vencimento<input name="due_date" type="date" defaultValue={initial?.due_date ?? today()} required /><small>Data livre e editável; o sistema não presume calendário legal.</small></label>
            <label className="wide">Referência complementar<input name="reference" defaultValue={initial?.reference ?? ""} placeholder="Ex.: Retenção NF 1234, folha mensal ou parcela 1/2" /></label>
            <label>Valor principal<input name="principal_amount" inputMode="decimal" defaultValue={decimal(initial?.principal_amount)} required /></label>
            <label>Juros<input name="interest_amount" inputMode="decimal" defaultValue={decimal(initial?.interest_amount)} /></label>
            <label>Multa<input name="penalty_amount" inputMode="decimal" defaultValue={decimal(initial?.penalty_amount)} /></label>
            <label>Outros acréscimos<input name="other_amount" inputMode="decimal" defaultValue={decimal(initial?.other_amount)} /></label>
            <label>Desconto<input name="discount_amount" inputMode="decimal" defaultValue={decimal(initial?.discount_amount)} /></label>
            <label>Número do documento<input name="document_number" defaultValue={initial?.document_number ?? ""} /></label>
            <label className="wide">Código de pagamento<input name="payment_code" defaultValue={initial?.payment_code ?? ""} placeholder="Código da receita, identificador ou referência da guia" /></label>
            <label className="wide">Linha digitável / código de barras<input name="barcode" defaultValue={initial?.barcode ?? ""} /></label>
            <label className="wide">Observações<textarea name="notes" rows={3} defaultValue={initial?.notes ?? ""} /></label>
          </div>
          <div className="tax-form-note"><strong>Fluxo da obrigação</strong><span>Agenda fiscal → Conta a Pagar → Baixa em conta bancária → Obrigação marcada como paga.</span></div>
        </div>
        <footer><button type="button" onClick={() => dialogRef.current?.close()}>Cancelar</button><button className="primary" type="submit">Salvar obrigação</button></footer>
      </form>
    </dialog>
  </>;
}
