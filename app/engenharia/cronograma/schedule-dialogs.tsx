"use client";

import { useRef } from "react";
import { useFormStatus } from "react-dom";
import {
  createScheduleActivity,
  createScheduleBaseline,
  updateScheduleActivity,
} from "./actions";

export type ScheduleBudgetOption = {
  id: string;
  code: string;
  name: string;
  version: string;
};

export type ScheduleServiceOption = {
  id: string;
  code: string;
  description: string;
  unit: string;
};

export type ScheduleLocationOption = {
  id: string;
  code: string;
  name: string;
};

export type ScheduleActivityData = {
  id: string;
  service_id: string | null;
  location_id: string | null;
  code: string;
  name: string;
  unit_snapshot: string;
  quantity_snapshot: number;
  productivity_per_team_day: number;
  team_count: number;
  duration_days: number;
  planned_start: string;
  planned_finish: string;
  planned_cost: number;
  sort_order: number;
  planning_status: "draft" | "reviewed" | "approved";
  source?: "manual" | "takeoff";
  notes: string | null;
  record_status: "active" | "inactive";
};

export type ScheduleDependencyData = {
  predecessor_id: string;
  successor_id: string;
  relation_type: "FS" | "SS" | "FF" | "SF";
  lag_days: number;
};

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button className="budget-primary-button" type="submit" disabled={pending}>
      {pending ? "Salvando..." : label}
    </button>
  );
}

function DialogHeader({ eyebrow, title, onClose }: { eyebrow: string; title: string; onClose: () => void }) {
  return (
    <header className="budget-modal-head">
      <div><span>{eyebrow}</span><h2>{title}</h2></div>
      <button type="button" className="budget-modal-close" onClick={onClose} aria-label="Fechar">×</button>
    </header>
  );
}

export function ScheduleBaselineCreateDialog({ budgets }: { budgets: ScheduleBudgetOption[] }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <button className="elos-button" type="button" onClick={() => dialogRef.current?.showModal()}>+ Nova linha de base</button>
      <dialog ref={dialogRef} className="budget-modal schedule-modal">
        <form action={createScheduleBaseline} className="budget-modal-form">
          <DialogHeader eyebrow="Planejamento · Cronograma físico" title="Criar linha de base" onClose={() => dialogRef.current?.close()} />
          <div className="budget-modal-body schedule-form-grid">
            <label><span>Código</span><input name="code" placeholder="CRONO-001" required /></label>
            <label><span>Versão</span><input name="version" defaultValue="LB-00" required /></label>
            <label className="schedule-span-2"><span>Nome</span><input name="name" placeholder="Linha de base contratual da obra" required /></label>
            <label className="schedule-span-2"><span>Revisão do orçamento</span>
              <select name="budget_id" required defaultValue="">
                <option value="" disabled>Selecione a revisão</option>
                {budgets.map((budget) => <option key={budget.id} value={budget.id}>{budget.code} · {budget.version} · {budget.name}</option>)}
              </select>
            </label>
            <label><span>Início planejado</span><input name="start_date" type="date" defaultValue={today} required /></label>
            <label className="schedule-check"><input name="work_on_saturday" type="checkbox" /><span>Considerar sábado como dia útil</span></label>
            <label className="schedule-span-2"><span>Premissas</span><textarea name="notes" rows={3} placeholder="Calendário, restrições, metas e critérios desta linha de base." /></label>
          </div>
          <footer className="budget-modal-foot">
            <button className="budget-secondary-button" type="button" onClick={() => dialogRef.current?.close()}>Cancelar</button>
            <SubmitButton label="Criar linha de base" />
          </footer>
        </form>
      </dialog>
    </>
  );
}

function ActivityFields({
  baselineId,
  activity,
  services,
  locations,
  activities,
  dependency,
}: {
  baselineId: string;
  activity?: ScheduleActivityData;
  services: ScheduleServiceOption[];
  locations: ScheduleLocationOption[];
  activities: ScheduleActivityData[];
  dependency?: ScheduleDependencyData | null;
}) {
  const selectedService = services.find((service) => service.id === activity?.service_id);
  return (
    <div className="budget-modal-body schedule-form-grid">
      <input type="hidden" name="baseline_id" value={baselineId} />
      {activity ? <input type="hidden" name="activity_id" value={activity.id} /> : null}
      <label><span>Código</span><input name="code" defaultValue={activity?.code ?? ""} placeholder="ALV-PAV-05" required /></label>
      <label><span>Ordem</span><input name="sort_order" type="number" defaultValue={activity?.sort_order ?? activities.length + 1} /></label>
      <label className="schedule-span-2"><span>Nome da atividade</span><input name="name" defaultValue={activity?.name ?? ""} required /></label>
      <label className="schedule-span-2"><span>Serviço do orçamento</span>
        <select name="service_id" defaultValue={activity?.service_id ?? ""}>
          <option value="">Atividade sem serviço vinculado</option>
          {services.map((service) => <option key={service.id} value={service.id}>{service.code} · {service.description} · {service.unit}</option>)}
        </select>
      </label>
      <label className="schedule-span-2"><span>Local / pavimento</span>
        <select name="location_id" defaultValue={activity?.location_id ?? ""}>
          <option value="">Geral da obra</option>
          {locations.map((location) => <option key={location.id} value={location.id}>{location.code} · {location.name}</option>)}
        </select>
      </label>
      <label><span>Quantidade</span><input name="quantity" inputMode="decimal" defaultValue={activity?.quantity_snapshot ?? 0} required /></label>
      <label><span>Unidade</span><input name="unit" defaultValue={activity?.unit_snapshot ?? selectedService?.unit ?? "un"} required /></label>
      <label><span>Produtividade por equipe/dia</span><input name="productivity" inputMode="decimal" defaultValue={activity?.productivity_per_team_day ?? 1} required /></label>
      <label><span>Número de equipes</span><input name="team_count" inputMode="decimal" defaultValue={activity?.team_count ?? 1} required /></label>
      <label><span>Início planejado</span><input name="planned_start" type="date" defaultValue={activity?.planned_start ?? new Date().toISOString().slice(0, 10)} required /></label>
      <label><span>Custo planejado</span><input name="planned_cost" inputMode="decimal" defaultValue={activity?.planned_cost ?? 0} /></label>
      <label><span>Situação da atividade</span>
        <select name="planning_status" defaultValue={activity?.planning_status ?? "draft"}>
          <option value="draft">Premissa a revisar</option>
          <option value="reviewed">Revisada</option>
          <option value="approved">Aprovada</option>
        </select>
      </label>
      {activity ? (
        <label><span>Registro</span>
          <select name="record_status" defaultValue={activity.record_status}>
            <option value="active">Ativo</option>
            <option value="inactive">Retirado</option>
          </select>
        </label>
      ) : null}
      <label className="schedule-span-2"><span>Predecessora principal</span>
        <select name="predecessor_id" defaultValue={dependency?.predecessor_id ?? ""}>
          <option value="">Sem predecessora</option>
          {activities.filter((item) => item.id !== activity?.id && item.record_status === "active").map((item) => (
            <option key={item.id} value={item.id}>{item.code} · {item.name}</option>
          ))}
        </select>
      </label>
      <label><span>Relação</span>
        <select name="relation_type" defaultValue={dependency?.relation_type ?? "FS"}>
          <option value="FS">Término → início</option>
          <option value="SS">Início → início</option>
          <option value="FF">Término → término</option>
          <option value="SF">Início → término</option>
        </select>
      </label>
      <label><span>Defasagem em dias</span><input name="lag_days" type="number" defaultValue={dependency?.lag_days ?? 0} /></label>
      <label className="schedule-span-2"><span>Observações</span><textarea name="notes" rows={3} defaultValue={activity?.notes ?? ""} /></label>
      {activity ? <p className="schedule-calculation-note schedule-span-2">Duração atual: <strong>{activity.duration_days} dia(s) útil(eis)</strong>. O sistema recalcula pela quantidade ÷ produtividade ÷ equipes.</p> : null}
    </div>
  );
}

export function ScheduleActivityCreateDialog({ baselineId, services, locations, activities }: {
  baselineId: string;
  services: ScheduleServiceOption[];
  locations: ScheduleLocationOption[];
  activities: ScheduleActivityData[];
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button className="elos-button" type="button" onClick={() => dialogRef.current?.showModal()}>+ Nova atividade</button>
      <dialog ref={dialogRef} className="budget-modal schedule-modal schedule-activity-modal">
        <form action={createScheduleActivity} className="budget-modal-form">
          <DialogHeader eyebrow="Planejamento · Linha de base" title="Adicionar atividade" onClose={() => dialogRef.current?.close()} />
          <ActivityFields baselineId={baselineId} services={services} locations={locations} activities={activities} />
          <footer className="budget-modal-foot">
            <button className="budget-secondary-button" type="button" onClick={() => dialogRef.current?.close()}>Cancelar</button>
            <SubmitButton label="Adicionar atividade" />
          </footer>
        </form>
      </dialog>
    </>
  );
}

export function ScheduleActivityEditDialog({ baselineId, activity, services, locations, activities, dependency }: {
  baselineId: string;
  activity: ScheduleActivityData;
  services: ScheduleServiceOption[];
  locations: ScheduleLocationOption[];
  activities: ScheduleActivityData[];
  dependency?: ScheduleDependencyData | null;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button className="schedule-edit-button" type="button" onClick={() => dialogRef.current?.showModal()}>Editar</button>
      <dialog ref={dialogRef} className="budget-modal schedule-modal schedule-activity-modal">
        <form action={updateScheduleActivity} className="budget-modal-form">
          <DialogHeader eyebrow="Planejamento · Linha de base" title={`Editar ${activity.code}`} onClose={() => dialogRef.current?.close()} />
          <ActivityFields baselineId={baselineId} activity={activity} services={services} locations={locations} activities={activities} dependency={dependency} />
          <footer className="budget-modal-foot">
            <button className="budget-secondary-button" type="button" onClick={() => dialogRef.current?.close()}>Cancelar</button>
            <SubmitButton label="Salvar atividade" />
          </footer>
        </form>
      </dialog>
    </>
  );
}
