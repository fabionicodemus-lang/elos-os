"use client";

import { useEffect, useRef, useState } from "react";
import { createProject, updateProject } from "./actions";

export type LegalEntityOption = {
  id: string;
  legal_name: string;
  trade_name: string | null;
  cnpj: string | null;
  status: string;
};

export type ProjectRegistryData = {
  id: string;
  name: string;
  code: string | null;
  legal_entity_id: string | null;
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
  cover_image_path: string | null;
  cover_image_url: string | null;
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

function formatCnpj(value: string | null | undefined) {
  const digits = (value ?? "").replace(/\D/g, "");
  if (digits.length !== 14) return value || "CNPJ pendente";
  return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
}

function ProjectCoverField({ project }: { project?: ProjectRegistryData }) {
  const initialPreview = project?.cover_image_url ?? null;
  const [preview, setPreview] = useState<string | null>(initialPreview);
  const [removeImage, setRemoveImage] = useState(false);
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => () => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
  }, []);

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    const file = event.target.files?.[0];
    objectUrlRef.current = file ? URL.createObjectURL(file) : null;
    setPreview(objectUrlRef.current || initialPreview);
    setRemoveImage(false);
  }

  function handleRemoveChange(event: React.ChangeEvent<HTMLInputElement>) {
    const checked = event.target.checked;
    setRemoveImage(checked);
    setPreview(checked ? null : objectUrlRef.current || initialPreview);
  }

  const fallback = (project?.code || project?.name || "OBRA").slice(0, 4).toUpperCase();

  return (
    <div className="project-cover-field project-span-3">
      <div className="project-cover-preview">
        {preview ? <img src={preview} alt={`Imagem de ${project?.name || "novo empreendimento"}`} /> : <span>{fallback}</span>}
      </div>
      <div className="project-cover-controls">
        <strong>Imagem da obra</strong>
        <p>Use uma imagem horizontal da fachada ou uma perspectiva do empreendimento. JPG, PNG ou WebP, até 5 MB.</p>
        <label className="project-cover-upload">
          <input name="cover_image" type="file" accept="image/jpeg,image/png,image/webp" onChange={handleFileChange} />
          <span>Escolher imagem</span>
        </label>
        {initialPreview ? (
          <label className="project-cover-remove">
            <input name="remove_cover_image" type="checkbox" value="true" checked={removeImage} onChange={handleRemoveChange} />
            Remover a imagem atual
          </label>
        ) : null}
      </div>
    </div>
  );
}

function ProjectFields({ project, legalEntities }: { project?: ProjectRegistryData; legalEntities: LegalEntityOption[] }) {
  const options = legalEntities.filter((entity) => entity.status === "active" || entity.id === project?.legal_entity_id);
  return (
    <div className="project-form-grid">
      <ProjectCoverField project={project} />
      <label className="project-span-2"><span>Nome do empreendimento</span><input name="name" defaultValue={project?.name ?? ""} required autoFocus /></label>
      <label><span>Código</span><input name="code" defaultValue={project?.code ?? ""} placeholder="FLOW" /></label>
      <label className="project-span-2"><span>Empresa / SPE responsável</span><select name="legal_entity_id" defaultValue={project?.legal_entity_id ?? ""} required><option value="">Selecione a empresa fiscal…</option>{options.map((entity) => <option key={entity.id} value={entity.id}>{entity.trade_name || entity.legal_name} · {formatCnpj(entity.cnpj)}{entity.status === "inactive" ? " · INATIVA" : ""}</option>)}</select><small className="project-field-help">O CNPJ da empresa selecionada será a referência fiscal oficial da obra.</small></label>
      <label><span>Tipo</span><select name="project_type" defaultValue={project?.project_type ?? "residential"}>{Object.entries(projectTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label><span>Status</span><select name="status" defaultValue={project?.status ?? "planning"}>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label><span>Matrícula / incorporação</span><input name="registration_number" defaultValue={project?.registration_number ?? ""} /></label>
      <label className="project-span-2"><span>Descrição</span><textarea name="description" rows={3} defaultValue={project?.description ?? ""} placeholder="Conceito, padrão e características principais do empreendimento." /></label>

      <div className="project-form-section project-span-3"><strong>Endereço</strong><span>Localização oficial do empreendimento</span></div>
      <label><span>CEP</span><input name="postal_code" defaultValue={project?.postal_code ?? ""} /></label>
      <label className="project-span-2"><span>Logradouro</span><input name="street" defaultValue={project?.street ?? ""} /></label>
      <label><span>Número</span><input name="address_number" defaultValue={project?.address_number ?? ""} /></label>
      <label><span>Complemento</span><input name="complement" defaultValue={project?.complement ?? ""} /></label>
      <label><span>Bairro</span><input name="district" defaultValue={project?.district ?? ""} /></label>
      <label><span>Cidade</span><input name="city" defaultValue={project?.city ?? ""} /></label>
      <label><span>UF</span><input name="state" maxLength={2} defaultValue={project?.state ?? "SC"} /></label>

      <div className="project-form-section project-span-3"><strong>Dimensões e produto</strong><span>Áreas, pavimentos, unidades e vagas</span></div>
      <label><span>Área do terreno (m²)</span><input name="land_area_m2" inputMode="decimal" defaultValue={project?.land_area_m2 ?? 0} /></label>
      <label><span>Área construída (m²)</span><input name="built_area_m2" inputMode="decimal" defaultValue={project?.built_area_m2 ?? 0} /></label>
      <label><span>Área privativa total (m²)</span><input name="private_area_m2" inputMode="decimal" defaultValue={project?.private_area_m2 ?? 0} /></label>
      <label><span>Área comum total (m²)</span><input name="common_area_m2" inputMode="decimal" defaultValue={project?.common_area_m2 ?? 0} /></label>
      <label><span>Unidades privativas</span><input name="total_units" type="number" min="0" defaultValue={project?.total_units ?? 0} /></label>
      <label><span>Torres</span><input name="total_towers" type="number" min="0" defaultValue={project?.total_towers ?? 1} /></label>
      <label><span>Pavimentos</span><input name="total_floors" type="number" min="0" defaultValue={project?.total_floors ?? 0} /></label>
      <label><span>Vagas de garagem</span><input name="parking_spaces" type="number" min="0" defaultValue={project?.parking_spaces ?? 0} /></label>

      <div className="project-form-section project-span-3"><strong>Datas principais</strong><span>Lançamento, início da obra e entrega</span></div>
      <label><span>Lançamento</span><input name="launch_date" type="date" defaultValue={iso(project?.launch_date)} /></label>
      <label><span>Início da construção</span><input name="construction_start_date" type="date" defaultValue={iso(project?.construction_start_date)} /></label>
      <label><span>Entrega prevista / realizada</span><input name="delivery_date" type="date" defaultValue={iso(project?.delivery_date)} /></label>
      <label className="project-span-3"><span>Observações internas</span><textarea name="notes" rows={3} defaultValue={project?.notes ?? ""} /></label>
    </div>
  );
}

export function ProjectCreateDialog({ legalEntities }: { legalEntities: LegalEntityOption[] }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button className="project-toolbar-new" type="button" onClick={() => dialogRef.current?.showModal()}>+ Novo empreendimento</button>
      <dialog ref={dialogRef} className="budget-modal project-modal">
        <form action={createProject} className="budget-modal-form">
          <header className="budget-modal-head"><div><span>Empreendimentos</span><h2>Novo empreendimento</h2></div><button type="button" className="budget-modal-close" onClick={() => dialogRef.current?.close()} aria-label="Fechar">×</button></header>
          <div className="budget-modal-body"><ProjectFields legalEntities={legalEntities} /></div>
          <footer className="budget-modal-foot"><button type="button" className="budget-secondary-button" onClick={() => dialogRef.current?.close()}>Cancelar</button><button type="submit" className="budget-primary-button">Salvar obra</button></footer>
        </form>
      </dialog>
    </>
  );
}

export function ProjectEditDialog({
  project,
  legalEntities,
  buttonLabel = "Editar",
  buttonClassName = "project-table-action",
}: {
  project: ProjectRegistryData;
  legalEntities: LegalEntityOption[];
  buttonLabel?: string;
  buttonClassName?: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button className={buttonClassName} type="button" onClick={() => dialogRef.current?.showModal()}>{buttonLabel}</button>
      <dialog ref={dialogRef} className="budget-modal project-modal">
        <form action={updateProject} className="budget-modal-form">
          <input type="hidden" name="project_id" value={project.id} />
          <header className="budget-modal-head"><div><span>{project.code || "Empreendimento"}</span><h2>Editar {project.name}</h2></div><button type="button" className="budget-modal-close" onClick={() => dialogRef.current?.close()} aria-label="Fechar">×</button></header>
          <div className="budget-modal-body"><ProjectFields project={project} legalEntities={legalEntities} /></div>
          <footer className="budget-modal-foot"><button type="button" className="budget-secondary-button" onClick={() => dialogRef.current?.close()}>Cancelar</button><button type="submit" className="budget-primary-button">Salvar alterações</button></footer>
        </form>
      </dialog>
    </>
  );
}
