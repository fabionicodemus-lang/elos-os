"use client";

import { useRef, useState } from "react";
import { createLegalEntity, updateLegalEntity } from "./actions";

export type LegalEntityData = {
  id: string;
  parent_entity_id: string | null;
  entity_type: string;
  legal_name: string;
  trade_name: string | null;
  cnpj: string | null;
  state_registration: string | null;
  municipal_registration: string | null;
  email: string | null;
  phone: string | null;
  postal_code: string | null;
  street: string | null;
  address_number: string | null;
  complement: string | null;
  district: string | null;
  city: string | null;
  state: string | null;
  notes: string | null;
  status: string;
  is_primary: boolean;
};

const typeLabels: Record<string, string> = {
  incorporator: "Incorporadora / matriz",
  spe: "SPE",
  holding: "Holding",
  other: "Outra empresa",
};

function digits(value: string) {
  return value.replace(/\D/g, "").slice(0, 14);
}

export function formatCnpj(value: string | null | undefined) {
  const raw = digits(value ?? "");
  if (!raw) return "";
  return raw
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");
}

function validCnpj(value: string) {
  const cnpj = digits(value);
  if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false;
  const calculate = (base: string, weights: number[]) => {
    const sum = base.split("").reduce((total, digit, index) => total + Number(digit) * weights[index], 0);
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };
  const first = calculate(cnpj.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = calculate(`${cnpj.slice(0, 12)}${first}`, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return cnpj.endsWith(`${first}${second}`);
}

function LegalEntityFields({
  entity,
  entities,
}: {
  entity?: LegalEntityData;
  entities: LegalEntityData[];
}) {
  const [cnpj, setCnpj] = useState(formatCnpj(entity?.cnpj));
  const cnpjIsValid = validCnpj(cnpj);
  const parentOptions = entities.filter((item) => item.id !== entity?.id && (item.status === "active" || item.id === entity?.parent_entity_id));

  return (
    <div className="legal-entity-form-grid">
      <label><span>Tipo</span><select name="entity_type" defaultValue={entity?.entity_type ?? "spe"}>{Object.entries(typeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label><span>Status</span><select name="status" defaultValue={entity?.status ?? "active"}><option value="active">Ativa</option><option value="inactive">Inativa</option></select></label>
      <label className="legal-entity-span-2"><span>Empresa controladora</span><select name="parent_entity_id" defaultValue={entity?.parent_entity_id ?? ""}><option value="">Sem controladora</option>{parentOptions.map((item) => <option key={item.id} value={item.id}>{item.trade_name || item.legal_name} · {formatCnpj(item.cnpj) || "CNPJ pendente"}</option>)}</select></label>

      <label className="legal-entity-span-2"><span>Razão social</span><input name="legal_name" defaultValue={entity?.legal_name ?? ""} required autoFocus /></label>
      <label className="legal-entity-span-2"><span>Nome fantasia</span><input name="trade_name" defaultValue={entity?.trade_name ?? ""} /></label>
      <label className="legal-entity-span-2"><span>CNPJ</span><input name="cnpj" inputMode="numeric" value={cnpj} onChange={(event) => setCnpj(formatCnpj(event.target.value))} placeholder="00.000.000/0000-00" required /></label>
      <label><span>Inscrição estadual</span><input name="state_registration" defaultValue={entity?.state_registration ?? ""} /></label>
      <label><span>Inscrição municipal</span><input name="municipal_registration" defaultValue={entity?.municipal_registration ?? ""} /></label>

      <div className={`legal-entity-cnpj-feedback legal-entity-span-full ${cnpjIsValid ? "is-valid" : "is-invalid"}`}>
        <div><strong>{cnpjIsValid ? "CNPJ válido" : "Informe um CNPJ válido"}</strong><span>{cnpjIsValid ? "Será usado para validar documentos fiscais e identificar a empresa responsável pela obra." : "Empresas sem CNPJ válido não podem ser vinculadas a novos empreendimentos."}</span></div>
        <b>{cnpj || "—"}</b>
      </div>

      <div className="legal-entity-form-section legal-entity-span-full"><strong>Contato e endereço</strong><span>Dados utilizados em contratos, compras e documentos</span></div>
      <label><span>E-mail</span><input name="email" type="email" defaultValue={entity?.email ?? ""} /></label>
      <label><span>Telefone</span><input name="phone" defaultValue={entity?.phone ?? ""} /></label>
      <label><span>CEP</span><input name="postal_code" defaultValue={entity?.postal_code ?? ""} /></label>
      <label><span>UF</span><input name="state" maxLength={2} defaultValue={entity?.state ?? "SC"} /></label>
      <label className="legal-entity-span-2"><span>Logradouro</span><input name="street" defaultValue={entity?.street ?? ""} /></label>
      <label><span>Número</span><input name="address_number" defaultValue={entity?.address_number ?? ""} /></label>
      <label><span>Complemento</span><input name="complement" defaultValue={entity?.complement ?? ""} /></label>
      <label className="legal-entity-span-2"><span>Bairro</span><input name="district" defaultValue={entity?.district ?? ""} /></label>
      <label className="legal-entity-span-2"><span>Cidade</span><input name="city" defaultValue={entity?.city ?? ""} /></label>
      <label className="legal-entity-span-full"><span>Observações</span><textarea name="notes" rows={3} defaultValue={entity?.notes ?? ""} placeholder="Informações fiscais, societárias ou operacionais relevantes." /></label>

      <div className="legal-entity-security-note legal-entity-span-full"><b>Segurança fiscal:</b> o CNPJ desta empresa será a referência do empreendimento para contratos, compras, contas a pagar, notas manuais e futura validação dos XMLs.</div>
    </div>
  );
}

export function LegalEntityCreateDialog({ entities }: { entities: LegalEntityData[] }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button className="legal-entity-primary-button" type="button" onClick={() => dialogRef.current?.showModal()}>+ Nova empresa</button>
      <dialog ref={dialogRef} className="budget-modal legal-entity-modal">
        <form action={createLegalEntity} className="budget-modal-form">
          <header className="budget-modal-head"><div><span>Empreendimentos</span><h2>Nova empresa / SPE</h2></div><button type="button" className="budget-modal-close" onClick={() => dialogRef.current?.close()} aria-label="Fechar">×</button></header>
          <div className="budget-modal-body"><LegalEntityFields entities={entities} /></div>
          <footer className="budget-modal-foot"><button type="button" className="budget-secondary-button" onClick={() => dialogRef.current?.close()}>Cancelar</button><button type="submit" className="budget-primary-button">Salvar empresa</button></footer>
        </form>
      </dialog>
    </>
  );
}

export function LegalEntityEditDialog({ entity, entities }: { entity: LegalEntityData; entities: LegalEntityData[] }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button className="legal-entity-table-button" type="button" onClick={() => dialogRef.current?.showModal()}>Editar</button>
      <dialog ref={dialogRef} className="budget-modal legal-entity-modal">
        <form action={updateLegalEntity} className="budget-modal-form">
          <input type="hidden" name="entity_id" value={entity.id} />
          <header className="budget-modal-head"><div><span>{entity.trade_name || entity.legal_name}</span><h2>Editar empresa / SPE</h2></div><button type="button" className="budget-modal-close" onClick={() => dialogRef.current?.close()} aria-label="Fechar">×</button></header>
          <div className="budget-modal-body"><LegalEntityFields entity={entity} entities={entities} /></div>
          <footer className="budget-modal-foot"><button type="button" className="budget-secondary-button" onClick={() => dialogRef.current?.close()}>Cancelar</button><button type="submit" className="budget-primary-button">Salvar alterações</button></footer>
        </form>
      </dialog>
    </>
  );
}
