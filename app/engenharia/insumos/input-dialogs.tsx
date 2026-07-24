"use client";

import { useRef } from "react";
import { createEngineeringInput, updateEngineeringInput } from "./actions";

export type EngineeringInputDialogData = {
  id: string;
  code: string;
  description: string;
  unit: string;
  category: string;
  family_code: string | null;
  family_label: string | null;
  brand_reference: string | null;
  technical_specification: string | null;
  source_system: string;
  source_code: string | null;
  notes: string | null;
  status: "active" | "inactive";
};

const categoryOptions = [
  ["material", "Material"],
  ["labor", "Mão de obra"],
  ["equipment", "Equipamento"],
  ["service", "Serviço terceirizado"],
  ["freight", "Frete"],
  ["other", "Outro custo"],
];

function InputFields({ input, families }: { input?: EngineeringInputDialogData; families: string[] }) {
  return (
    <div className="input-modal-grid">
      <label><span>Código</span><input name="code" defaultValue={input?.code ?? ""} placeholder="Ex.: IE.CAB.001" required autoFocus /></label>
      <label><span>Unidade</span><input name="unit" defaultValue={input?.unit ?? "un"} placeholder="un, m, m², kg..." required /></label>
      <label className="input-modal-wide"><span>Descrição</span><input name="description" defaultValue={input?.description ?? ""} placeholder="Descrição técnica padronizada" required /></label>
      <label><span>Natureza</span><select name="category" defaultValue={input?.category ?? "material"}>{categoryOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label><span>Código da família</span><input name="family_code" defaultValue={input?.family_code ?? ""} list="input-family-codes" placeholder="Ex.: IE.CAB" /><datalist id="input-family-codes">{families.map((family) => <option key={family} value={family} />)}</datalist></label>
      <label className="input-modal-wide"><span>Nome da família</span><input name="family_label" defaultValue={input?.family_label ?? ""} placeholder="Ex.: Elétrica · Cabos e fios" /></label>
      <label className="input-modal-wide"><span>Marca ou referência</span><input name="brand_reference" defaultValue={input?.brand_reference ?? ""} placeholder="Marca, modelo, referência ou desempenho mínimo" /></label>
      <label className="input-modal-wide"><span>Especificação técnica</span><textarea name="technical_specification" rows={3} defaultValue={input?.technical_specification ?? ""} placeholder="Dimensões, classe, resistência, acabamento e critérios de aceitação." /></label>
      <label><span>Sistema de origem</span><input name="source_system" defaultValue={input?.source_system ?? "elos_os"} placeholder="Elos OS, Koper, SINAPI..." /></label>
      <label><span>Código de origem</span><input name="source_code" defaultValue={input?.source_code ?? ""} placeholder="Código legado ou externo" /></label>
      <label className="input-modal-wide"><span>Observações</span><textarea name="notes" rows={3} defaultValue={input?.notes ?? ""} placeholder="Fornecedor de referência, restrições de uso e observações internas." /></label>
      {input ? <label><span>Status</span><select name="status" defaultValue={input.status}><option value="active">Ativo</option><option value="inactive">Inativo</option></select></label> : null}
    </div>
  );
}

export function InputCreateDialog({ families }: { families: string[] }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button className="elos-button budget-primary-button" type="button" onClick={() => dialogRef.current?.showModal()}>+ Novo insumo</button>
      <dialog ref={dialogRef} className="budget-modal input-modal">
        <form action={createEngineeringInput} className="budget-modal-form">
          <header className="budget-modal-head"><div><span>Engenharia · Orçamento de Obras</span><h2>Novo insumo técnico</h2></div><button type="button" className="budget-modal-close" onClick={() => dialogRef.current?.close()} aria-label="Fechar">×</button></header>
          <div className="budget-modal-body"><InputFields families={families} /></div>
          <footer className="budget-modal-foot"><button type="button" className="budget-secondary-button" onClick={() => dialogRef.current?.close()}>Cancelar</button><button type="submit" className="budget-primary-button">Criar insumo</button></footer>
        </form>
      </dialog>
    </>
  );
}

export function InputEditDialog({ input, families }: { input: EngineeringInputDialogData; families: string[] }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button className="table-action" type="button" onClick={() => dialogRef.current?.showModal()}>Editar</button>
      <dialog ref={dialogRef} className="budget-modal input-modal">
        <form action={updateEngineeringInput} className="budget-modal-form">
          <input type="hidden" name="input_id" value={input.id} />
          <header className="budget-modal-head"><div><span>{input.code}</span><h2>Editar insumo técnico</h2></div><button type="button" className="budget-modal-close" onClick={() => dialogRef.current?.close()} aria-label="Fechar">×</button></header>
          <div className="budget-modal-body"><InputFields input={input} families={families} /></div>
          <footer className="budget-modal-foot"><button type="button" className="budget-secondary-button" onClick={() => dialogRef.current?.close()}>Cancelar</button><button type="submit" className="budget-primary-button">Salvar alterações</button></footer>
        </form>
      </dialog>
    </>
  );
}
