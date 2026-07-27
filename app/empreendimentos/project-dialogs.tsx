"use client";

import { useRef } from "react";
import { createProject, updateProject } from "./actions";

export type ProjectRegistryData = {
  id: string;
  name: string;
  code: string | null;
  project_type: string;
  status: string;
  description: string | null;
  postal_code: string | null;
  street: string | null;
  address_number: string | null;
  complement: string | null;
  district: string | null;
  city: string | null;
  state: string | null;
  land_area_m2: number;
  built_area_m2: number;
  private_area_m2: number;
  common_area_m2: number;
  total_units: number;
  total_towers: number;
  total_floors: number;
  parking_spaces: number;
  launch_date: string | null;
  construction_start_date: string | null;
  delivery_date: string | null;
  registration_number: string | null;
  notes: string | null;
};

const projectTypeLabels: Record<string, string> = {
  residential: "Residencial",
  commercial: "Comercial",
  mixed: "Misto",
  land: "Loteamento",
  industrial: "Industrial",
  other: "Outro",
};

const statusLabels: Record<string, string> = {
  planning: "Planejamento",
  active: "Em construção",
  paused: "Pausado",
  completed: "Concluído",
  archived: "Arquivado",
};

function iso(value: string | null | undefined) {
  return value ? value.slice(0, 10) : "";
}

function ProjectFields({ project }: { project?: ProjectRegistryData }) {
  return (
    <div className="project-form-grid">
      <label className="project-span-2"><span>Nome do empreendimento</span><input name="name" defaultValue={project?.name ?? ""} required autoFocus /></label>
      <label><span>Código</span><input name="code" defaultValue={project?.code ?? ""} placeholder="FLOW" /></label>
      <label><span>Tipo</span><select name="project_type" defaultValue={project?.project_type ?? "residential"}>{Object.entries(projectTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label><span>Status</span><select name="status" defaultValue={project?.status ?? "planning"}>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label><span>Matrícula / incorporação</span><input name="registration_number" defaultValue={project?.registration_number ?? ""} /></label>
      <label className="project-span-2"><span>Descrição</span><textarea name="description" rows={3} defaultValue={project?.description ?? ""} placeholder="Conceito, padrão e características principais do empreendimento." /></label>

      <div className="project-form-section project-span-2"><strong>Endereço</strong><span>Localização oficial do empreendimento</span></div>
      <label><span>CEP</span><input name="postal_code" defaultValue={project?.postal_code ?? ""} /></label>
      <label className="project-span-2"><span>Logradouro</span><input name="street" defaultValue={project?.street ?? ""} /></label>
      <label><span>Número</span><input name="address_number" defaultValue={project?.address_number ?? ""} /></label>
      <label><span>Complemento</span><input name="complement" defaultValue={project?.complement ?? ""} /></label>
      <label><span>Bairro</span><input name="district" defaultValue={project?.district ?? ""} /></label>
      <label><span>Cidade</span><input name="city" defaultValue={project?.city ?? ""} /></label>
      <label><span>UF</span><input name="state" maxLength={2} defaultValue={project?.state ?? "SC"} /></label>

      <div className="project-form-section project-span-2"><strong>Dimensões e produto</strong><span>Áreas, pavimentos, unidades e vagas</span></div>
      <label><span>Área do terreno (m²)</span><input name="land_area_m2" inputMode="decimal" defaultValue={project?.land_area_m2 ?? 0} /></label>
      <label><span>Área construída (m²)</span><input name="built_area_m2" inputMode="decimal" defaultValue={project?.built_area_m2 ?? 0} /></label>
      <label><span>Área privativa total (m²)</span><input name="private_area_m2" inputMode="decimal" defaultValue={project?.private_area_m2 ?? 0} /></label>
      <label><span>Área comum total (m²)</span><input name="common_area_m2" inputMode="decimal" defaultValue={project?.common_area_m2 ?? 0} /></label>
      <label><span>Unidades privativas</span><input name="total_units" type="number" min="0" defaultValue={project?.total_units ?? 0} /></label>
      <label><span>Torres</span><input name="total_towers" type="number" min="0" defaultValue={project?.total_towers ?? 1} /></label>
      <label><span>Pavimentos</span><input name="total_floors" type="number" min="0" defaultValue={project?.total_floors ?? 0} /></label>
      <label><span>Vagas de garagem</span><input name="parking_spaces" type="number" min="0" defaultValue={project?.parking_spaces ?? 0} /></label>

      <div className="project-form-section project-span-2"><strong>Datas principais</strong><span>Lançamento, início da obra e entrega</span></div>
      <label><span>Lançamento</span><input name="launch_date" type="date" defaultValue={iso(project?.launch_date)} /></label>
      <label><span>Início da construção</span><input name="construction_start_date" type="date" defaultValue={iso(project?.construction_start_date)} /></label>
      <label><span>Entrega prevista / realizada</span><input name="delivery_date" type="date" defaultValue={iso(project?.delivery_date)} /></label>
      <label className="project-span-2"><span>Observações internas</span><textarea name="notes" rows={3} defaultValue={project?.notes ?? ""} /></label>
    </div>
  );
}

export function ProjectCreateDialog() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button className="elos-button budget-primary-button" type="button" onClick={() => dialogRef.current?.showModal()}>+ Novo empreendimento</button>
      <dialog ref={dialogRef} className="budget-modal project-modal">
        <form action={createProject} className="budget-modal-form">
          <header className="budget-modal-head"><div><span>Empreendimentos</span><h2>Novo empreendimento</h2></div><button type="button" className="budget-modal-close" onClick={() => dialogRef.current?.close()} aria-label="Fechar">×</button></header>
          <div className="budget-modal-body"><ProjectFields /></div>
          <footer className="budget-modal-foot"><button type="button" className="budget-secondary-button" onClick={() => dialogRef.current?.close()}>Cancelar</button><button type="submit" className="budget-primary-button">Cadastrar empreendimento</button></footer>
        </form>
      </dialog>
    </>
  );
}

export function ProjectEditDialog({ project }: { project: ProjectRegistryData }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button className="project-card-action" type="button" onClick={() => dialogRef.current?.showModal()}>Editar cadastro</button>
      <dialog ref={dialogRef} className="budget-modal project-modal">
        <form action={updateProject} className="budget-modal-form">
          <input type="hidden" name="project_id" value={project.id} />
          <header className="budget-modal-head"><div><span>{project.code || "Empreendimento"}</span><h2>Editar {project.name}</h2></div><button type="button" className="budget-modal-close" onClick={() => dialogRef.current?.close()} aria-label="Fechar">×</button></header>
          <div className="budget-modal-body"><ProjectFields project={project} /></div>
          <footer className="budget-modal-foot"><button type="button" className="budget-secondary-button" onClick={() => dialogRef.current?.close()}>Cancelar</button><button type="submit" className="budget-primary-button">Salvar alterações</button></footer>
        </form>
      </dialog>
    </>
  );
}
