"use client";

import { useRef } from "react";
import { createProjectLocation, importProjectLocations, updateProjectLocation } from "./actions";

export type ProjectLocationData = {
  id: string;
  parent_id: string | null;
  code: string;
  name: string;
  location_type: string;
  repetitions: number | string;
  sort_order: number;
  notes: string | null;
  status: string;
};

const typeLabels: Record<string, string> = {
  enterprise: "Empreendimento",
  tower: "Torre / bloco",
  floor: "Pavimento / local",
  unit: "Unidade",
  room: "Ambiente",
  sector: "Setor / trecho",
  external: "Área externa",
  other: "Outro",
};

function LocationFields({
  location,
  locations,
  nextOrder,
}: {
  location?: ProjectLocationData;
  locations: ProjectLocationData[];
  nextOrder: number;
}) {
  const parentOptions = locations.filter((item) => item.id !== location?.id && item.status === "active");

  return (
    <div className="location-form-grid">
      <label><span>Ordem</span><input name="sort_order" type="number" defaultValue={location?.sort_order ?? nextOrder} /></label>
      <label><span>Código</span><input name="code" defaultValue={location?.code ?? ""} placeholder="TIP" required /></label>
      <label className="location-span-2"><span>Local / pavimento</span><input name="name" defaultValue={location?.name ?? ""} placeholder="Pavimento tipo" required autoFocus /></label>
      <label><span>Tipo</span><select name="location_type" defaultValue={location?.location_type ?? "floor"}>{Object.entries(typeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label><span>Repetições</span><input name="repetitions" inputMode="decimal" defaultValue={location?.repetitions ?? 1} required /></label>
      <label className="location-span-2"><span>Local superior</span><select name="parent_id" defaultValue={location?.parent_id ?? ""}><option value="">Nenhum · nível principal</option>{parentOptions.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></label>
      {location ? <label><span>Status</span><select name="status" defaultValue={location.status}><option value="active">Ativo</option><option value="inactive">Excluído</option></select></label> : null}
      <label className="location-span-full"><span>Observações</span><textarea name="notes" rows={3} defaultValue={location?.notes ?? ""} placeholder="Descrição complementar, limites ou particularidades deste local." /></label>
    </div>
  );
}

export function LocationCreateDialog({ locations, nextOrder }: { locations: ProjectLocationData[]; nextOrder: number }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button className="location-primary-button" type="button" onClick={() => dialogRef.current?.showModal()}>+ Novo local</button>
      <dialog ref={dialogRef} className="budget-modal location-modal">
        <form action={createProjectLocation} className="budget-modal-form">
          <header className="budget-modal-head"><div><span>Empreendimentos</span><h2>Novo local ou pavimento</h2></div><button type="button" className="budget-modal-close" onClick={() => dialogRef.current?.close()} aria-label="Fechar">×</button></header>
          <div className="budget-modal-body"><LocationFields locations={locations} nextOrder={nextOrder} /></div>
          <footer className="budget-modal-foot"><button type="button" className="budget-secondary-button" onClick={() => dialogRef.current?.close()}>Cancelar</button><button type="submit" className="budget-primary-button">Adicionar local</button></footer>
        </form>
      </dialog>
    </>
  );
}

export function LocationEditDialog({ location, locations, nextOrder }: { location: ProjectLocationData; locations: ProjectLocationData[]; nextOrder: number }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button className="location-table-button" type="button" onClick={() => dialogRef.current?.showModal()}>Editar</button>
      <dialog ref={dialogRef} className="budget-modal location-modal">
        <form action={updateProjectLocation} className="budget-modal-form">
          <input type="hidden" name="location_id" value={location.id} />
          <header className="budget-modal-head"><div><span>{location.code}</span><h2>Editar {location.name}</h2></div><button type="button" className="budget-modal-close" onClick={() => dialogRef.current?.close()} aria-label="Fechar">×</button></header>
          <div className="budget-modal-body"><LocationFields location={location} locations={locations} nextOrder={nextOrder} /></div>
          <footer className="budget-modal-foot"><button type="button" className="budget-secondary-button" onClick={() => dialogRef.current?.close()}>Cancelar</button><button type="submit" className="budget-primary-button">Salvar alterações</button></footer>
        </form>
      </dialog>
    </>
  );
}

export function LocationImportDialog() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const example = [
    "Ordem;Código;Nome;Tipo;Repetições;Código superior;Observações",
    "10;TER;Térreo;pavimento;1;;Acesso e áreas comuns",
    "20;G2;Garagem 2;pavimento;1;;",
    "30;TIP;Pavimento tipo;pavimento;19;;Pavimentos repetitivos",
    "40;ROO;Rooftop;pavimento;1;;Área de lazer superior",
  ].join("\n");

  return (
    <>
      <button className="location-secondary-button" type="button" onClick={() => dialogRef.current?.showModal()}>⇩ Importar estrutura</button>
      <dialog ref={dialogRef} className="budget-modal location-import-modal">
        <form action={importProjectLocations} className="budget-modal-form">
          <header className="budget-modal-head"><div><span>Empreendimentos</span><h2>Importar estrutura da obra</h2></div><button type="button" className="budget-modal-close" onClick={() => dialogRef.current?.close()} aria-label="Fechar">×</button></header>
          <div className="budget-modal-body">
            <div className="location-import-help">
              <strong>Cole uma linha por local</strong>
              <p>Use ponto e vírgula ou cole diretamente do Excel. A ordem das colunas é: ordem, código, nome, tipo, repetições, código do local superior e observações.</p>
            </div>
            <textarea className="location-import-textarea" name="structure_text" rows={14} defaultValue={example} required />
            <p className="location-import-note">Tipos aceitos: empreendimento, torre, pavimento, unidade, ambiente, setor, externa e outro. Códigos já existentes serão atualizados.</p>
          </div>
          <footer className="budget-modal-foot"><button type="button" className="budget-secondary-button" onClick={() => dialogRef.current?.close()}>Cancelar</button><button type="submit" className="budget-primary-button">Importar estrutura</button></footer>
        </form>
      </dialog>
    </>
  );
}
