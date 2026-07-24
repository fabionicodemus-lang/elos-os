"use client";

import { useRef } from "react";
import { createEngineeringService, updateEngineeringService } from "./actions";

export type EngineeringServiceDialogData = {
  id: string;
  code: string;
  description: string;
  unit: string;
  group_code: string | null;
  default_method: string;
  takeoff_rule: string | null;
  measurement_rule: string | null;
  notes: string | null;
  status: "active" | "inactive";
};

const methods = [
  ["unit", "Valor global / unidade"],
  ["count", "Contagem"],
  ["length", "Comprimento"],
  ["area", "Área"],
  ["volume", "Volume"],
  ["weight", "Peso"],
  ["custom", "Fórmula personalizada"],
] as const;

function ServiceFields({ service, groups, listId }: {
  service?: EngineeringServiceDialogData;
  groups: string[];
  listId: string;
}) {
  return (
    <div className="service-modal-body service-modal-grid">
      <label>
        <span>Código</span>
        <input name="code" defaultValue={service?.code ?? ""} placeholder="Ex.: 04.03" required autoFocus />
      </label>
      <label>
        <span>Unidade</span>
        <input name="unit" defaultValue={service?.unit ?? "un"} placeholder="m², m³, kg, vb..." required />
      </label>
      <label className="service-modal-wide">
        <span>Nome / descrição do serviço</span>
        <input name="description" defaultValue={service?.description ?? ""} placeholder="Ex.: Alvenaria de vedação em bloco celular" required />
      </label>
      <label>
        <span>Grupo</span>
        <input name="group_code" list={listId} defaultValue={service?.group_code ?? ""} placeholder="Ex.: 04 · Alvenaria" />
        <datalist id={listId}>{groups.map((group) => <option key={group} value={group} />)}</datalist>
      </label>
      <label>
        <span>Método padrão</span>
        <select name="default_method" defaultValue={service?.default_method ?? "area"}>
          {methods.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label className="service-modal-wide">
        <span>Critério de levantamento</span>
        <textarea
          name="takeoff_rule"
          rows={3}
          defaultValue={service?.takeoff_rule ?? ""}
          placeholder="Explique como a quantidade deve ser levantada nos projetos e memórias de cálculo."
        />
      </label>
      <label className="service-modal-wide">
        <span>Critério de medição da mão de obra</span>
        <textarea
          name="measurement_rule"
          rows={3}
          defaultValue={service?.measurement_rule ?? ""}
          placeholder="Defina o que deve estar concluído e aceito para a medição do serviço."
        />
      </label>
      <label className="service-modal-wide">
        <span>Observações técnicas</span>
        <textarea name="notes" rows={3} defaultValue={service?.notes ?? ""} placeholder="Premissas, exclusões, normas ou referências." />
      </label>
      {service ? (
        <label>
          <span>Status</span>
          <select name="status" defaultValue={service.status}>
            <option value="active">Ativo</option>
            <option value="inactive">Inativo</option>
          </select>
        </label>
      ) : null}
    </div>
  );
}

export function ServiceCreateDialog({ groups }: { groups: string[] }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button className="elos-button service-primary-button" type="button" onClick={() => dialogRef.current?.showModal()}>
        + Novo serviço
      </button>
      <dialog ref={dialogRef} className="service-modal">
        <form action={createEngineeringService} className="service-modal-form">
          <header className="service-modal-head">
            <div><span>Engenharia · Catálogo técnico</span><h2>Novo serviço</h2></div>
            <button type="button" className="service-modal-close" onClick={() => dialogRef.current?.close()} aria-label="Fechar">×</button>
          </header>
          <ServiceFields groups={groups} listId="service-groups-create" />
          <footer className="service-modal-foot">
            <button type="button" className="service-secondary-button" onClick={() => dialogRef.current?.close()}>Cancelar</button>
            <button type="submit" className="service-primary-button">Salvar serviço</button>
          </footer>
        </form>
      </dialog>
    </>
  );
}

export function ServiceEditDialog({ service, groups }: { service: EngineeringServiceDialogData; groups: string[] }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button className="table-action service-edit-trigger" type="button" onClick={() => dialogRef.current?.showModal()}>Editar</button>
      <dialog ref={dialogRef} className="service-modal">
        <form action={updateEngineeringService} className="service-modal-form">
          <input type="hidden" name="service_id" value={service.id} />
          <header className="service-modal-head">
            <div><span>{service.code}</span><h2>Editar serviço técnico</h2></div>
            <button type="button" className="service-modal-close" onClick={() => dialogRef.current?.close()} aria-label="Fechar">×</button>
          </header>
          <ServiceFields service={service} groups={groups} listId={`service-groups-${service.id}`} />
          <footer className="service-modal-foot">
            <button type="button" className="service-secondary-button" onClick={() => dialogRef.current?.close()}>Cancelar</button>
            <button type="submit" className="service-primary-button">Salvar alterações</button>
          </footer>
        </form>
      </dialog>
    </>
  );
}