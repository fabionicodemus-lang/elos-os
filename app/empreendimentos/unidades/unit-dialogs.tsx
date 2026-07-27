"use client";

import { useRef } from "react";
import { createProjectUnit, importProjectUnits, updateProjectUnit } from "./actions";

export type ProjectUnitData = {
  id: string;
  code: string;
  tower: string | null;
  floor: number | null;
  type: string | null;
  position: string | null;
  floor_location_id: string | null;
  private_area: number | null;
  uncovered_private_area: number | null;
  common_area: number | null;
  total_area: number | null;
  fractional_share: number | null;
  bedrooms: number | null;
  suites: number | null;
  parking_spaces: number | null;
  parking_description: string | null;
  list_price: number | null;
  status: string;
  registry: string | null;
  notes: string | null;
};

export type FloorLocationOption = {
  id: string;
  code: string;
  name: string;
  location_type: string;
};

const statusLabels: Record<string, string> = {
  available: "Disponível",
  reserved: "Reservada",
  sold: "Vendida",
  inactive: "Inativa",
};

function inputValue(value: number | string | null | undefined) {
  return value ?? "";
}

function UnitFields({ unit, locations }: { unit?: ProjectUnitData; locations: FloorLocationOption[] }) {
  return (
    <div className="unit-form-grid">
      <label><span>Código / número</span><input name="code" defaultValue={unit?.code ?? ""} placeholder="801" required autoFocus /></label>
      <label><span>Torre / bloco</span><input name="tower" defaultValue={unit?.tower ?? ""} placeholder="Torre única" /></label>
      <label><span>Pavimento</span><input name="floor" type="number" min="0" defaultValue={inputValue(unit?.floor)} placeholder="8" /></label>
      <label><span>Tipo / planta</span><input name="type" defaultValue={unit?.type ?? ""} placeholder="Tipo 02 · 2 suítes" /></label>
      <label><span>Posição</span><input name="position" defaultValue={unit?.position ?? ""} placeholder="Frente, lateral, fundos..." /></label>
      <label className="unit-span-2"><span>Local / pavimento vinculado</span><select name="floor_location_id" defaultValue={unit?.floor_location_id ?? ""}><option value="">Nenhum vínculo técnico</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.code} · {location.name}</option>)}</select></label>
      <label><span>Situação</span><select name="status" defaultValue={unit?.status ?? "available"}>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>

      <div className="unit-form-section unit-span-full"><strong>Áreas da unidade</strong><span>Valores conforme quadro de áreas e incorporação</span></div>
      <label><span>Área privativa coberta (m²)</span><input name="private_area" inputMode="decimal" defaultValue={inputValue(unit?.private_area)} /></label>
      <label><span>Privativa descoberta (m²)</span><input name="uncovered_private_area" inputMode="decimal" defaultValue={inputValue(unit?.uncovered_private_area)} /></label>
      <label><span>Área comum (m²)</span><input name="common_area" inputMode="decimal" defaultValue={inputValue(unit?.common_area)} /></label>
      <label><span>Área total real (m²)</span><input name="total_area" inputMode="decimal" defaultValue={inputValue(unit?.total_area)} /></label>
      <label><span>Fração ideal</span><input name="fractional_share" inputMode="decimal" defaultValue={inputValue(unit?.fractional_share)} placeholder="0,012345" /></label>

      <div className="unit-form-section unit-span-full"><strong>Configuração e comercialização</strong><span>Tipologia, vagas e preço de referência</span></div>
      <label><span>Dormitórios</span><input name="bedrooms" type="number" min="0" defaultValue={inputValue(unit?.bedrooms)} /></label>
      <label><span>Suítes</span><input name="suites" type="number" min="0" defaultValue={inputValue(unit?.suites)} /></label>
      <label><span>Quantidade de vagas</span><input name="parking_spaces" type="number" min="0" defaultValue={inputValue(unit?.parking_spaces)} /></label>
      <label className="unit-span-2"><span>Identificação das vagas</span><input name="parking_description" defaultValue={unit?.parking_description ?? ""} placeholder="Vagas 35 e 36" /></label>
      <label><span>Preço de tabela (R$)</span><input name="list_price" inputMode="decimal" defaultValue={inputValue(unit?.list_price)} placeholder="950.000,00" /></label>
      <label><span>Matrícula</span><input name="registry" defaultValue={unit?.registry ?? ""} /></label>
      <label className="unit-span-full"><span>Observações</span><textarea name="notes" rows={3} defaultValue={unit?.notes ?? ""} placeholder="Diferenciais, alterações de planta, restrições ou observações internas." /></label>
    </div>
  );
}

export function UnitCreateDialog({ locations }: { locations: FloorLocationOption[] }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button className="unit-primary-button" type="button" onClick={() => dialogRef.current?.showModal()}>+ Nova unidade</button>
      <dialog ref={dialogRef} className="budget-modal unit-modal">
        <form action={createProjectUnit} className="budget-modal-form">
          <header className="budget-modal-head"><div><span>Empreendimentos</span><h2>Nova unidade privativa</h2></div><button type="button" className="budget-modal-close" onClick={() => dialogRef.current?.close()} aria-label="Fechar">×</button></header>
          <div className="budget-modal-body"><UnitFields locations={locations} /></div>
          <footer className="budget-modal-foot"><button type="button" className="budget-secondary-button" onClick={() => dialogRef.current?.close()}>Cancelar</button><button type="submit" className="budget-primary-button">Cadastrar unidade</button></footer>
        </form>
      </dialog>
    </>
  );
}

export function UnitEditDialog({ unit, locations }: { unit: ProjectUnitData; locations: FloorLocationOption[] }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button className="unit-table-button" type="button" onClick={() => dialogRef.current?.showModal()}>Editar</button>
      <dialog ref={dialogRef} className="budget-modal unit-modal">
        <form action={updateProjectUnit} className="budget-modal-form">
          <input type="hidden" name="unit_id" value={unit.id} />
          <header className="budget-modal-head"><div><span>Unidade {unit.code}</span><h2>Editar unidade privativa</h2></div><button type="button" className="budget-modal-close" onClick={() => dialogRef.current?.close()} aria-label="Fechar">×</button></header>
          <div className="budget-modal-body"><UnitFields unit={unit} locations={locations} /></div>
          <footer className="budget-modal-foot"><button type="button" className="budget-secondary-button" onClick={() => dialogRef.current?.close()}>Cancelar</button><button type="submit" className="budget-primary-button">Salvar alterações</button></footer>
        </form>
      </dialog>
    </>
  );
}

export function UnitImportDialog() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const example = [
    "Código;Torre;Pavimento;Tipo;Posição;Código local;Área privativa;Privativa descoberta;Área comum;Área total;Fração ideal;Dormitórios;Suítes;Vagas;Descrição vagas;Preço tabela;Status;Matrícula;Observações",
    "801;;8;Tipo 01;Frente;TIP;73,20;0;26,80;100,00;0,0125;2;1;1;Vaga 21;950000;Disponível;;",
    "802;;8;Tipo 02;Lateral;TIP;62,40;0;23,60;86,00;0,0108;2;1;1;Vaga 22;890000;Disponível;;",
  ].join("\n");

  return (
    <>
      <button className="unit-secondary-button" type="button" onClick={() => dialogRef.current?.showModal()}>⇩ Importar unidades</button>
      <dialog ref={dialogRef} className="budget-modal unit-import-modal">
        <form action={importProjectUnits} className="budget-modal-form">
          <header className="budget-modal-head"><div><span>Empreendimentos</span><h2>Importar unidades privativas</h2></div><button type="button" className="budget-modal-close" onClick={() => dialogRef.current?.close()} aria-label="Fechar">×</button></header>
          <div className="budget-modal-body">
            <div className="unit-import-help"><strong>Cole as linhas do Excel</strong><p>Use a sequência exibida no modelo abaixo. Unidades com o mesmo código serão atualizadas; vendas ativas continuarão mantendo o status Vendida.</p></div>
            <textarea className="unit-import-textarea" name="units_text" rows={14} defaultValue={example} required />
            <p className="unit-import-note">Situações aceitas: Disponível, Reservada, Vendida e Inativa. O código do local deve existir em Locais / Pavimentos.</p>
          </div>
          <footer className="budget-modal-foot"><button type="button" className="budget-secondary-button" onClick={() => dialogRef.current?.close()}>Cancelar</button><button type="submit" className="budget-primary-button">Importar unidades</button></footer>
        </form>
      </dialog>
    </>
  );
}
