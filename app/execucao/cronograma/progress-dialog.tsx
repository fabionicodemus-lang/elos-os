"use client";

import { useRef, useState } from "react";
import { recordScheduleProgress } from "./actions";

export type ExecutionScheduleActivity = {
  id: string;
  baseline_id: string;
  service_id: string | null;
  location_id: string | null;
  code: string;
  name: string;
  unit_snapshot: string;
  quantity_snapshot: number | string;
  team_count: number | string;
  duration_days: number;
  planned_start: string;
  planned_finish: string;
  planned_cost: number | string;
  sort_order: number;
  record_status: string;
};

export type ExecutionScheduleMeasurement = {
  id: string;
  activity_id: string;
  measurement_date: string;
  progress_percent: number | string;
  actual_quantity: number | string;
  actual_cost: number | string;
  team_count: number | string | null;
  current_start: string;
  current_finish: string;
  actual_start: string | null;
  actual_finish: string | null;
  notes: string | null;
  created_at: string;
};

function numberBR(value: number | string | null | undefined, digits = 2) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: digits }).format(Number(value ?? 0));
}

export function ScheduleProgressDialog({
  baselineId,
  activity,
  measurement,
  selectedDate,
}: {
  baselineId: string;
  activity: ExecutionScheduleActivity;
  measurement: ExecutionScheduleMeasurement | null;
  selectedDate: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const initialProgress = Number(measurement?.progress_percent ?? 0);
  const [progress, setProgress] = useState(initialProgress);
  const suggestedQuantity = measurement?.actual_quantity ?? (Number(activity.quantity_snapshot) * initialProgress / 100);

  return (
    <>
      <button className="execution-measure-button" type="button" onClick={() => dialogRef.current?.showModal()}>
        {measurement ? "Atualizar" : "Medir avanço"}
      </button>
      <dialog ref={dialogRef} className="budget-modal execution-progress-modal">
        <form action={recordScheduleProgress} className="budget-modal-form">
          <input type="hidden" name="baseline_id" value={baselineId} />
          <input type="hidden" name="activity_id" value={activity.id} />
          <header className="budget-modal-head">
            <div><span>{activity.code}</span><h2>{activity.name}</h2></div>
            <button type="button" className="budget-modal-close" onClick={() => dialogRef.current?.close()} aria-label="Fechar">×</button>
          </header>
          <div className="budget-modal-body">
            <div className="execution-progress-summary">
              <div><span>Quantidade prevista</span><strong>{numberBR(activity.quantity_snapshot, 4)} {activity.unit_snapshot}</strong></div>
              <div><span>Período da linha de base</span><strong>{activity.planned_start.slice(8, 10)}/{activity.planned_start.slice(5, 7)} a {activity.planned_finish.slice(8, 10)}/{activity.planned_finish.slice(5, 7)}</strong></div>
              <div><span>Equipes planejadas</span><strong>{numberBR(activity.team_count)} equipe(s)</strong></div>
            </div>

            <div className="execution-progress-form-grid">
              <label><span>Data da medição</span><input name="measurement_date" type="date" defaultValue={selectedDate} required /></label>
              <label className="execution-progress-main"><span>Avanço físico</span><div className="execution-progress-input"><input name="progress_percent" type="range" min="0" max="100" step="0.1" value={progress} onChange={(event) => setProgress(Number(event.target.value))} /><input type="number" min="0" max="100" step="0.1" value={progress} onChange={(event) => setProgress(Number(event.target.value))} /><b>%</b></div></label>
              <label><span>Quantidade realizada acumulada</span><input name="actual_quantity" inputMode="decimal" defaultValue={numberBR(suggestedQuantity, 4)} /></label>
              <label><span>Equipes atuais</span><input name="team_count" inputMode="decimal" defaultValue={measurement?.team_count ?? activity.team_count} /></label>
              <label><span>Início atual reprogramado</span><input name="current_start" type="date" defaultValue={measurement?.current_start ?? activity.planned_start} required /></label>
              <label><span>Término atual reprogramado</span><input name="current_finish" type="date" defaultValue={measurement?.current_finish ?? activity.planned_finish} required /></label>
              <label><span>Início realizado</span><input name="actual_start" type="date" defaultValue={measurement?.actual_start ?? ""} /></label>
              <label><span>Término realizado</span><input name="actual_finish" type="date" defaultValue={measurement?.actual_finish ?? ""} /></label>
              <label><span>Custo realizado acumulado</span><input name="actual_cost" inputMode="decimal" defaultValue={measurement?.actual_cost ?? 0} /></label>
              <label className="execution-progress-notes"><span>Observações da medição</span><textarea name="notes" rows={4} defaultValue={measurement?.notes ?? ""} placeholder="Desvios, restrições, decisões e justificativa da reprogramação." /></label>
            </div>
          </div>
          <footer className="budget-modal-foot">
            <button type="button" className="budget-secondary-button" onClick={() => dialogRef.current?.close()}>Cancelar</button>
            <button type="submit" className="budget-primary-button">Salvar medição</button>
          </footer>
        </form>
      </dialog>
    </>
  );
}
