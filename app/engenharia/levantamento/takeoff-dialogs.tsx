"use client";

import { useMemo, useRef, useState } from "react";
import {
  createEngineeringTakeoff,
  createEngineeringTakeoffLocation,
  updateEngineeringTakeoff,
  updateEngineeringTakeoffLocation,
} from "./actions";

export type TakeoffBudgetOption = {
  id: string;
  code: string;
  name: string;
  version: string;
  status: string;
};

export type TakeoffLocationOption = {
  id: string;
  code: string;
  name: string;
  location_type: string;
  parent_id: string | null;
  repetitions: number;
  sort_order: number;
  notes: string | null;
  status: "active" | "inactive";
};

export type TakeoffServiceOption = {
  id: string;
  code: string;
  description: string;
  unit: string;
  group_code: string | null;
  default_method: string;
  takeoff_rule: string | null;
};

export type TakeoffDialogData = {
  id: string;
  budget_id: string;
  location_id: string | null;
  service_id: string;
  method: string;
  element_count: number;
  dimension_a: number | null;
  dimension_b: number | null;
  dimension_c: number | null;
  adjustment: number;
  location_repetitions_snapshot: number;
  repetition_override: number | null;
  repetition_reason: string | null;
  quantity_per_location: number;
  total_quantity: number;
  formula: string;
  unit_snapshot: string;
  source_reference: string | null;
  project_revision: string | null;
  description: string | null;
  status: "draft" | "in_review" | "approved";
  record_status: "active" | "inactive";
};

const methodOptions = [
  ["unit", "Valor global / unidade"],
  ["count", "Contagem"],
  ["length", "Comprimento"],
  ["area", "Área"],
  ["volume", "Volume"],
  ["weight", "Peso"],
  ["custom", "Quantidade direta"],
] as const;

const locationTypes = [
  ["enterprise", "Empreendimento"],
  ["tower", "Torre / bloco"],
  ["floor", "Pavimento"],
  ["unit", "Unidade"],
  ["room", "Ambiente"],
  ["sector", "Setor"],
  ["external", "Área externa"],
  ["other", "Outro"],
] as const;

const statusLabels: Record<string, string> = {
  draft: "Rascunho",
  in_review: "Em conferência",
  approved: "Aprovado",
};

function numeric(value: string | number | null | undefined, fallback = 0) {
  const number = Number(value ?? fallback);
  return Number.isFinite(number) ? number : fallback;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  }).format(value);
}

function calculate(method: string, elementCount: number, a: number, b: number, c: number, adjustment: number, repetitions: number) {
  let perLocation = 0;
  let inside = "";

  if (method === "area") {
    perLocation = elementCount * a * b + adjustment;
    inside = `${formatNumber(elementCount)} × ${formatNumber(a)} × ${formatNumber(b)}`;
  } else if (method === "volume") {
    perLocation = elementCount * a * b * c + adjustment;
    inside = `${formatNumber(elementCount)} × ${formatNumber(a)} × ${formatNumber(b)} × ${formatNumber(c)}`;
  } else if (method === "length" || method === "weight") {
    perLocation = elementCount * a + adjustment;
    inside = `${formatNumber(elementCount)} × ${formatNumber(a)}`;
  } else if (method === "custom") {
    perLocation = a + adjustment;
    inside = formatNumber(a);
  } else {
    perLocation = elementCount + adjustment;
    inside = formatNumber(elementCount);
  }

  if (adjustment) inside += ` ${adjustment > 0 ? "+" : "−"} ${formatNumber(Math.abs(adjustment))}`;
  const safePerLocation = Math.max(0, perLocation);
  return {
    perLocation: safePerLocation,
    total: safePerLocation * repetitions,
    formula: `${formatNumber(repetitions)} × (${inside})`,
  };
}

function LocationFields({
  location,
  locations,
  budgetId,
}: {
  location?: TakeoffLocationOption;
  locations: TakeoffLocationOption[];
  budgetId: string;
}) {
  return (
    <div className="takeoff-modal-grid">
      <input type="hidden" name="budget_id" value={budgetId} />
      <label>
        <span>Código</span>
        <input name="code" defaultValue={location?.code ?? ""} placeholder="Ex.: PAV-05" required autoFocus />
      </label>
      <label>
        <span>Tipo</span>
        <select name="location_type" defaultValue={location?.location_type ?? "floor"}>
          {locationTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label className="takeoff-modal-wide">
        <span>Nome do local</span>
        <input name="name" defaultValue={location?.name ?? ""} placeholder="Ex.: 5º pavimento tipo" required />
      </label>
      <label>
        <span>Local superior</span>
        <select name="parent_id" defaultValue={location?.parent_id ?? ""}>
          <option value="">Sem local superior</option>
          {locations.filter((item) => item.id !== location?.id).map((item) => (
            <option key={item.id} value={item.id}>{item.code} · {item.name}</option>
          ))}
        </select>
      </label>
      <label>
        <span>Repetições oficiais</span>
        <input name="repetitions" type="number" min="0.000001" step="0.0001" defaultValue={location?.repetitions ?? 1} required />
      </label>
      <label>
        <span>Ordem</span>
        <input name="sort_order" type="number" step="1" defaultValue={location?.sort_order ?? 0} />
      </label>
      {location ? (
        <label>
          <span>Status</span>
          <select name="status" defaultValue={location.status}>
            <option value="active">Ativo</option>
            <option value="inactive">Inativo</option>
          </select>
        </label>
      ) : null}
      <label className="takeoff-modal-wide">
        <span>Observações</span>
        <textarea name="notes" rows={3} defaultValue={location?.notes ?? ""} placeholder="Uso, abrangência, exceções ou identificação no projeto." />
      </label>
    </div>
  );
}

export function TakeoffLocationCreateDialog({ locations, budgetId }: { locations: TakeoffLocationOption[]; budgetId: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button className="takeoff-secondary-button" type="button" onClick={() => dialogRef.current?.showModal()}>+ Novo local</button>
      <dialog ref={dialogRef} className="takeoff-modal">
        <form action={createEngineeringTakeoffLocation} className="takeoff-modal-form">
          <header className="takeoff-modal-head">
            <div><span>Estrutura da obra</span><h2>Novo local ou pavimento</h2></div>
            <button type="button" onClick={() => dialogRef.current?.close()} aria-label="Fechar">×</button>
          </header>
          <LocationFields locations={locations} budgetId={budgetId} />
          <footer className="takeoff-modal-foot">
            <button type="button" className="takeoff-secondary-button" onClick={() => dialogRef.current?.close()}>Cancelar</button>
            <button type="submit" className="takeoff-primary-button">Salvar local</button>
          </footer>
        </form>
      </dialog>
    </>
  );
}

export function TakeoffLocationEditDialog({ location, locations, budgetId }: { location: TakeoffLocationOption; locations: TakeoffLocationOption[]; budgetId: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button className="table-action" type="button" onClick={() => dialogRef.current?.showModal()}>Editar</button>
      <dialog ref={dialogRef} className="takeoff-modal">
        <form action={updateEngineeringTakeoffLocation} className="takeoff-modal-form">
          <input type="hidden" name="location_id" value={location.id} />
          <header className="takeoff-modal-head">
            <div><span>{location.code}</span><h2>Editar local</h2></div>
            <button type="button" onClick={() => dialogRef.current?.close()} aria-label="Fechar">×</button>
          </header>
          <LocationFields location={location} locations={locations} budgetId={budgetId} />
          <footer className="takeoff-modal-foot">
            <button type="button" className="takeoff-secondary-button" onClick={() => dialogRef.current?.close()}>Cancelar</button>
            <button type="submit" className="takeoff-primary-button">Salvar alterações</button>
          </footer>
        </form>
      </dialog>
    </>
  );
}

function TakeoffFields({
  budget,
  locations,
  services,
  takeoff,
}: {
  budget: TakeoffBudgetOption;
  locations: TakeoffLocationOption[];
  services: TakeoffServiceOption[];
  takeoff?: TakeoffDialogData;
}) {
  const initialService = services.find((service) => service.id === takeoff?.service_id) ?? services[0];
  const initialLocation = locations.find((location) => location.id === takeoff?.location_id) ?? locations[0];
  const [serviceId, setServiceId] = useState(initialService?.id ?? "");
  const [locationId, setLocationId] = useState(initialLocation?.id ?? "");
  const [method, setMethod] = useState(takeoff?.method ?? initialService?.default_method ?? "area");
  const [elementCount, setElementCount] = useState(String(takeoff?.element_count ?? 1));
  const [dimensionA, setDimensionA] = useState(takeoff?.dimension_a == null ? "" : String(takeoff.dimension_a));
  const [dimensionB, setDimensionB] = useState(takeoff?.dimension_b == null ? "" : String(takeoff.dimension_b));
  const [dimensionC, setDimensionC] = useState(takeoff?.dimension_c == null ? "" : String(takeoff.dimension_c));
  const [adjustment, setAdjustment] = useState(String(takeoff?.adjustment ?? 0));
  const [override, setOverride] = useState(takeoff?.repetition_override == null ? "" : String(takeoff.repetition_override));

  const service = services.find((item) => item.id === serviceId) ?? initialService;
  const location = locations.find((item) => item.id === locationId) ?? initialLocation;
  const officialRepetitions = numeric(location?.repetitions, 1);
  const repetitions = override ? numeric(override, officialRepetitions) : officialRepetitions;
  const result = useMemo(() => calculate(
    method,
    numeric(elementCount, 1),
    numeric(dimensionA),
    numeric(dimensionB),
    numeric(dimensionC),
    numeric(adjustment),
    repetitions,
  ), [method, elementCount, dimensionA, dimensionB, dimensionC, adjustment, repetitions]);

  function changeService(nextServiceId: string) {
    setServiceId(nextServiceId);
    const nextService = services.find((item) => item.id === nextServiceId);
    if (nextService) setMethod(nextService.default_method || "area");
  }

  return (
    <div className="takeoff-editor-layout">
      <div className="takeoff-modal-grid">
        <input type="hidden" name="budget_id" value={budget.id} />
        <label>
          <span>Local / pavimento</span>
          <select name="location_id" value={locationId} onChange={(event) => setLocationId(event.target.value)} required>
            {locations.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name} × {formatNumber(Number(item.repetitions))}</option>)}
          </select>
        </label>
        <label className="takeoff-modal-wide">
          <span>Serviço</span>
          <select name="service_id" value={serviceId} onChange={(event) => changeService(event.target.value)} required>
            {services.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.description}</option>)}
          </select>
        </label>
        <label>
          <span>Método</span>
          <select name="method" value={method} onChange={(event) => setMethod(event.target.value)}>
            {methodOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label>
          <span>Qtd. de elementos</span>
          <input name="element_count" type="number" min="0" step="0.0001" value={elementCount} onChange={(event) => setElementCount(event.target.value)} />
        </label>
        <label>
          <span>{method === "custom" ? "Quantidade base" : "Dimensão A"}</span>
          <input name="dimension_a" type="number" step="0.0001" value={dimensionA} onChange={(event) => setDimensionA(event.target.value)} />
        </label>
        <label>
          <span>Dimensão B</span>
          <input name="dimension_b" type="number" step="0.0001" value={dimensionB} onChange={(event) => setDimensionB(event.target.value)} disabled={!['area', 'volume'].includes(method)} />
        </label>
        <label>
          <span>Dimensão C</span>
          <input name="dimension_c" type="number" step="0.0001" value={dimensionC} onChange={(event) => setDimensionC(event.target.value)} disabled={method !== "volume"} />
        </label>
        <label>
          <span>Ajuste (+ / −)</span>
          <input name="adjustment" type="number" step="0.0001" value={adjustment} onChange={(event) => setAdjustment(event.target.value)} />
          <small>Use valor negativo para descontos.</small>
        </label>
        <label>
          <span>Repetições oficiais</span>
          <input value={officialRepetitions} readOnly disabled />
        </label>
        <label>
          <span>Override de repetição</span>
          <input name="repetition_override" type="number" min="0.000001" step="0.0001" value={override} onChange={(event) => setOverride(event.target.value)} placeholder="Opcional" />
        </label>
        <label>
          <span>Justificativa do override</span>
          <input name="repetition_reason" defaultValue={takeoff?.repetition_reason ?? ""} required={Boolean(override)} />
        </label>
        <label className="takeoff-modal-wide">
          <span>Origem / projeto / prancha</span>
          <input name="source_reference" defaultValue={takeoff?.source_reference ?? ""} placeholder="Ex.: ARQ-12 R03 · Prancha G3" />
        </label>
        <label>
          <span>Revisão do projeto</span>
          <input name="project_revision" defaultValue={takeoff?.project_revision ?? ""} placeholder="Ex.: R03" />
        </label>
        <label className="takeoff-modal-wide">
          <span>Descrição da memória</span>
          <input name="description" defaultValue={takeoff?.description ?? ""} placeholder="Ex.: paredes internas dos apartamentos" />
        </label>
        {takeoff ? (
          <label>
            <span>Status</span>
            <select name="status" defaultValue={takeoff.status}>
              {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
        ) : <input type="hidden" name="status" value="draft" />}
      </div>

      <aside className="takeoff-context-card">
        <span>Contexto da memória</span>
        <dl>
          <dt>Revisão</dt><dd>{budget.code} · {budget.version}</dd>
          <dt>Serviço</dt><dd>{service ? `${service.code} · ${service.description}` : "—"}</dd>
          <dt>Unidade</dt><dd>{service?.unit ?? "—"}</dd>
          <dt>Local</dt><dd>{location ? `${location.code} · ${location.name}` : "—"}</dd>
          <dt>Critério</dt><dd>{service?.takeoff_rule || "Sem critério técnico cadastrado."}</dd>
        </dl>
        <div className="takeoff-formula-box">
          <small>Expressão armazenada</small>
          <strong>{result.formula}</strong>
        </div>
        <div className="takeoff-result-box">
          <small>Quantidade total</small>
          <strong>{formatNumber(result.total)} {service?.unit ?? ""}</strong>
          <span>{formatNumber(result.perLocation)} {service?.unit ?? ""} por local × {formatNumber(repetitions)} repetição(ões)</span>
        </div>
      </aside>
    </div>
  );
}

export function TakeoffCreateDialog({ budget, locations, services }: { budget: TakeoffBudgetOption; locations: TakeoffLocationOption[]; services: TakeoffServiceOption[] }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button className="takeoff-primary-button" type="button" onClick={() => dialogRef.current?.showModal()}>+ Nova memória</button>
      <dialog ref={dialogRef} className="takeoff-modal takeoff-editor-modal">
        <form action={createEngineeringTakeoff} className="takeoff-modal-form">
          <header className="takeoff-modal-head">
            <div><span>Levantamento · {budget.version}</span><h2>Nova memória de cálculo</h2></div>
            <button type="button" onClick={() => dialogRef.current?.close()} aria-label="Fechar">×</button>
          </header>
          <TakeoffFields budget={budget} locations={locations} services={services} />
          <footer className="takeoff-modal-foot">
            <button type="button" className="takeoff-secondary-button" onClick={() => dialogRef.current?.close()}>Cancelar</button>
            <button type="submit" className="takeoff-primary-button">Adicionar memória</button>
          </footer>
        </form>
      </dialog>
    </>
  );
}

export function TakeoffEditDialog({ budget, locations, services, takeoff }: { budget: TakeoffBudgetOption; locations: TakeoffLocationOption[]; services: TakeoffServiceOption[]; takeoff: TakeoffDialogData }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button className="table-action" type="button" onClick={() => dialogRef.current?.showModal()}>Editar</button>
      <dialog ref={dialogRef} className="takeoff-modal takeoff-editor-modal">
        <form action={updateEngineeringTakeoff} className="takeoff-modal-form">
          <input type="hidden" name="takeoff_id" value={takeoff.id} />
          <header className="takeoff-modal-head">
            <div><span>{takeoff.formula}</span><h2>Editar memória de cálculo</h2></div>
            <button type="button" onClick={() => dialogRef.current?.close()} aria-label="Fechar">×</button>
          </header>
          <TakeoffFields budget={budget} locations={locations} services={services} takeoff={takeoff} />
          <footer className="takeoff-modal-foot">
            <button type="button" className="takeoff-secondary-button" onClick={() => dialogRef.current?.close()}>Cancelar</button>
            <button type="submit" className="takeoff-primary-button">Salvar alterações</button>
          </footer>
        </form>
      </dialog>
    </>
  );
}
