"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { saveManualRetentionRule } from "./actions";

export type ManualTaxAuthorityOption = {
  id: string;
  legal_name: string;
  trade_name: string | null;
  tax_id: string | null;
};

export type ManualRetentionRuleOption = {
  id: string;
  project_id: string | null;
  retention_key: string;
  code: string;
  name: string;
  authority_supplier_id: string;
  fiscal_class: string | null;
  payment_method: string | null;
  document_prefix: string | null;
  due_trigger: "" | "issue_date" | "competence_date" | "first_installment_due_date";
  due_rule: "manual" | "fixed_day" | "days_after_event";
  due_day: number | null;
  due_month_offset: number;
  due_days_after_event: number;
  business_day_adjustment: "none" | "previous_weekday" | "next_weekday";
  authority_name?: string | null;
};

const retentionLabels: Record<string, string> = {
  inss: "INSS retido",
  iss: "ISS retido",
  irrf: "IRRF retido",
  pis: "PIS retido",
  cofins: "COFINS retida",
  csll: "CSLL retida",
  other: "Outro imposto retido",
};

const defaults: Record<string, Omit<ManualRetentionRuleOption, "id" | "project_id" | "authority_supplier_id">> = {
  inss: { retention_key: "inss", code: "INSS-RET", name: "INSS Retido", fiscal_class: "Contribuição previdenciária retida", payment_method: "DARF / DCTFWeb", document_prefix: "INSS", due_trigger: "issue_date", due_rule: "fixed_day", due_day: 20, due_month_offset: 1, due_days_after_event: 0, business_day_adjustment: "previous_weekday" },
  iss: { retention_key: "iss", code: "ISS-RET", name: "ISS Retido", fiscal_class: "Tributo municipal retido", payment_method: "Guia municipal", document_prefix: "ISS", due_trigger: "", due_rule: "manual", due_day: null, due_month_offset: 0, due_days_after_event: 0, business_day_adjustment: "none" },
  irrf: { retention_key: "irrf", code: "IRRF-RET", name: "IRRF Retido", fiscal_class: "Imposto de renda retido", payment_method: "DARF", document_prefix: "IRRF", due_trigger: "", due_rule: "manual", due_day: null, due_month_offset: 0, due_days_after_event: 0, business_day_adjustment: "none" },
  pis: { retention_key: "pis", code: "PIS-RET", name: "PIS Retido", fiscal_class: "Contribuição federal retida", payment_method: "DARF", document_prefix: "PIS", due_trigger: "", due_rule: "manual", due_day: null, due_month_offset: 0, due_days_after_event: 0, business_day_adjustment: "none" },
  cofins: { retention_key: "cofins", code: "COFINS-RET", name: "COFINS Retida", fiscal_class: "Contribuição federal retida", payment_method: "DARF", document_prefix: "COFINS", due_trigger: "", due_rule: "manual", due_day: null, due_month_offset: 0, due_days_after_event: 0, business_day_adjustment: "none" },
  csll: { retention_key: "csll", code: "CSLL-RET", name: "CSLL Retida", fiscal_class: "Contribuição federal retida", payment_method: "DARF", document_prefix: "CSLL", due_trigger: "", due_rule: "manual", due_day: null, due_month_offset: 0, due_days_after_event: 0, business_day_adjustment: "none" },
  other: { retention_key: "other", code: "OUTRA-RET", name: "Outro Imposto Retido", fiscal_class: "Outro tributo retido", payment_method: "Guia", document_prefix: "RET", due_trigger: "", due_rule: "manual", due_day: null, due_month_offset: 0, due_days_after_event: 0, business_day_adjustment: "none" },
};

function authorityName(authority: ManualTaxAuthorityOption) {
  return authority.trade_name || authority.legal_name;
}

export function ManualRetentionRuleDialog({
  projectId,
  projectLabel,
  suppliers,
  rules,
}: {
  projectId: string;
  projectLabel: string;
  suppliers: ManualTaxAuthorityOption[];
  rules: ManualRetentionRuleOption[];
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const missing = useMemo(() => Object.keys(retentionLabels).find((key) => !rules.some((rule) => rule.retention_key === key && rule.due_rule !== "manual" && rule.due_trigger)), [rules]);
  const [retentionKey, setRetentionKey] = useState(missing ?? "inss");
  const [model, setModel] = useState<ManualRetentionRuleOption>(() => ({
    id: "",
    project_id: projectId,
    authority_supplier_id: "",
    ...defaults[missing ?? "inss"],
  }));

  useEffect(() => {
    const existing = rules.find((rule) => rule.retention_key === retentionKey);
    setModel(existing ?? {
      id: "",
      project_id: projectId,
      authority_supplier_id: "",
      ...defaults[retentionKey],
    });
  }, [projectId, retentionKey, rules]);

  const configured = rules.filter((rule) => rule.due_rule !== "manual" && rule.due_trigger && rule.authority_supplier_id).length;
  const readyToSave = Boolean(model.authority_supplier_id && model.due_trigger && model.due_rule !== "manual");

  return <>
    <button className="elos-button" type="button" onClick={() => ref.current?.showModal()}>
      Configurar retenções · {configured}/7
    </button>
    <dialog className="tax-dialog wide-dialog" ref={ref}>
      <form action={saveManualRetentionRule}>
        <input type="hidden" name="project_id" value={projectId} />
        <input type="hidden" name="retention_key" value={retentionKey} />
        <header>
          <div>
            <span>Notas Manuais · Regras tributárias</span>
            <h2>Configurar imposto retido</h2>
            <p>{projectLabel} · confirme com a área fiscal o órgão, a data-base e o prazo aplicáveis antes do primeiro lançamento.</p>
          </div>
          <button type="button" onClick={() => ref.current?.close()} aria-label="Fechar">×</button>
        </header>
        <div className="tax-dialog-body">
          <div className="tax-form-grid">
            <label className="wide">Retenção
              <select value={retentionKey} onChange={(event) => setRetentionKey(event.target.value)}>
                {Object.entries(retentionLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select>
            </label>
            <label>Código<input name="code" value={model.code} onChange={(event) => setModel((current) => ({ ...current, code: event.target.value }))} required /></label>
            <label className="wide">Nome do lançamento<input name="name" value={model.name} onChange={(event) => setModel((current) => ({ ...current, name: event.target.value }))} required /></label>
            <label className="wide">Órgão / favorecido
              <select name="authority_supplier_id" value={model.authority_supplier_id} onChange={(event) => setModel((current) => ({ ...current, authority_supplier_id: event.target.value }))} required>
                <option value="">Selecione o órgão cadastrado como fornecedor</option>
                {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{authorityName(supplier)}{supplier.tax_id ? ` · ${supplier.tax_id}` : ""}</option>)}
              </select>
              <small>Ex.: Receita Federal, prefeitura ou outro favorecido responsável pela guia.</small>
            </label>
            <label>Classe fiscal<input name="fiscal_class" value={model.fiscal_class ?? ""} onChange={(event) => setModel((current) => ({ ...current, fiscal_class: event.target.value }))} /></label>
            <label>Forma de pagamento<input name="payment_method" value={model.payment_method ?? ""} onChange={(event) => setModel((current) => ({ ...current, payment_method: event.target.value }))} /></label>
            <label>Prefixo do documento<input name="document_prefix" value={model.document_prefix ?? ""} onChange={(event) => setModel((current) => ({ ...current, document_prefix: event.target.value }))} /></label>
            <label>Data-base
              <select name="due_trigger" value={model.due_trigger} onChange={(event) => setModel((current) => ({ ...current, due_trigger: event.target.value as ManualRetentionRuleOption["due_trigger"] }))} required>
                <option value="" disabled>Selecione a data-base</option>
                <option value="issue_date">Emissão da nota</option>
                <option value="competence_date">Competência da nota</option>
                <option value="first_installment_due_date">Primeiro vencimento do fornecedor</option>
              </select>
            </label>
            <label>Regra de vencimento
              <select name="due_rule" value={model.due_rule} onChange={(event) => setModel((current) => ({ ...current, due_rule: event.target.value as ManualRetentionRuleOption["due_rule"] }))} required>
                <option value="manual" disabled>Selecione a regra de vencimento</option>
                <option value="fixed_day">Dia fixo do mês</option>
                <option value="days_after_event">Quantidade de dias após a data-base</option>
              </select>
            </label>
            {model.due_rule === "fixed_day" ? <>
              <label>Dia do vencimento<input name="due_day" type="number" min="1" max="31" value={model.due_day ?? 20} onChange={(event) => setModel((current) => ({ ...current, due_day: Number(event.target.value) }))} required /></label>
              <label>Meses após a data-base<input name="due_month_offset" type="number" min="0" max="24" value={model.due_month_offset} onChange={(event) => setModel((current) => ({ ...current, due_month_offset: Number(event.target.value) }))} required /></label>
              <input type="hidden" name="due_days_after_event" value="0" />
            </> : model.due_rule === "days_after_event" ? <>
              <label>Dias após a data-base<input name="due_days_after_event" type="number" min="0" max="730" value={model.due_days_after_event} onChange={(event) => setModel((current) => ({ ...current, due_days_after_event: Number(event.target.value) }))} required /></label>
              <input type="hidden" name="due_day" value="" />
              <input type="hidden" name="due_month_offset" value="0" />
            </> : <>
              <input type="hidden" name="due_day" value="" />
              <input type="hidden" name="due_month_offset" value="0" />
              <input type="hidden" name="due_days_after_event" value="0" />
              <div className="tax-form-note wide"><strong>Regra ainda não definida</strong><span>Selecione a data-base e o critério de vencimento informados pela contabilidade.</span></div>
            </>}
            <label>Ajuste quando cair no fim de semana
              <select name="business_day_adjustment" value={model.business_day_adjustment} onChange={(event) => setModel((current) => ({ ...current, business_day_adjustment: event.target.value as ManualRetentionRuleOption["business_day_adjustment"] }))}>
                <option value="none">Não ajustar</option>
                <option value="previous_weekday">Antecipar para sexta-feira</option>
                <option value="next_weekday">Prorrogar para segunda-feira</option>
              </select>
            </label>
            <label className="wide">Observações da regra<textarea name="rule_notes" rows={3} placeholder="Código de receita, orientação do contador ou particularidade da obra." /></label>
          </div>
          <div className="tax-form-note">
            <strong>Importante</strong>
            <span>O sistema aplicará exatamente a regra cadastrada. Feriados, mudanças legais e situações excepcionais devem ser conferidos pela área fiscal antes do pagamento.</span>
          </div>
        </div>
        <footer>
          <button type="button" onClick={() => ref.current?.close()}>Cancelar</button>
          <button className="primary" type="submit" disabled={!readyToSave}>Salvar regra de {retentionLabels[retentionKey]}</button>
        </footer>
      </form>
    </dialog>
  </>;
}
