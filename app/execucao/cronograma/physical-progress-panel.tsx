"use client";

import { useMemo, useRef, useState } from "react";
import { saveScheduleServiceWeights } from "./physical-weight-actions";
import type { ExecutionScheduleActivity, ExecutionScheduleMeasurement } from "./progress-dialog";
import type { ExecutionScheduleService } from "./execution-schedule-workbench";

export type PhysicalWeightRecord = {
  service_id: string;
  physical_weight_percent: number | string;
  distribution_method: "quantity" | "cost" | "duration" | "equal";
  source: "manual" | "suggested_budget" | "suggested_duration";
  notes: string | null;
};

type EditorRow = PhysicalWeightRecord & {
  code: string;
  description: string;
  activity_count: number;
  quantity_total: number;
  planned_cost: number;
  suggested_percent: number;
  suggested_source: "suggested_budget" | "suggested_duration";
};

function parseDate(value: string) {
  return new Date(`${value.slice(0, 10)}T12:00:00Z`);
}

function daysBetween(start: Date, finish: Date) {
  return Math.round((finish.getTime() - start.getTime()) / 86_400_000);
}

function plannedProgress(activity: ExecutionScheduleActivity, selectedDate: string) {
  const date = parseDate(selectedDate);
  const start = parseDate(activity.planned_start);
  const finish = parseDate(activity.planned_finish);
  if (date < start) return 0;
  if (date >= finish) return 100;
  const total = Math.max(1, daysBetween(start, finish) + 1);
  const elapsed = Math.max(0, daysBetween(start, date) + 1);
  return Math.min(100, elapsed / total * 100);
}

function numberBR(value: number | string | null | undefined, digits = 1) {
  return new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: digits }).format(Number(value ?? 0));
}

function dateBR(value: string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR").format(parseDate(value));
}

function normalizedPercentages(values: number[]) {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (values.length === 0) return [];
  if (total <= 0) {
    const equal = 100 / values.length;
    const result = values.map(() => Number(equal.toFixed(4)));
    result[result.length - 1] = Number((result[result.length - 1] + 100 - result.reduce((sum, value) => sum + value, 0)).toFixed(4));
    return result;
  }
  const result = values.map((value) => Number((value / total * 100).toFixed(4)));
  result[result.length - 1] = Number((result[result.length - 1] + 100 - result.reduce((sum, value) => sum + value, 0)).toFixed(4));
  return result;
}

function distributionValue(activity: ExecutionScheduleActivity, method: PhysicalWeightRecord["distribution_method"]) {
  if (method === "equal") return 1;
  if (method === "cost") return Math.max(0, Number(activity.planned_cost));
  if (method === "duration") return Math.max(0, Number(activity.duration_days));
  return Math.max(0, Number(activity.quantity_snapshot));
}

function fallbackDistributionValue(activity: ExecutionScheduleActivity) {
  const quantity = Math.max(0, Number(activity.quantity_snapshot));
  if (quantity > 0) return quantity;
  const duration = Math.max(0, Number(activity.duration_days));
  return duration > 0 ? duration : 1;
}

function PhysicalWeightsDialog({ baselineId, selectedDate, rows }: { baselineId: string; selectedDate: string; rows: EditorRow[] }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [values, setValues] = useState(rows);
  const total = values.reduce((sum, row) => sum + Number(row.physical_weight_percent || 0), 0);
  const valid = Math.abs(total - 100) <= 0.01;

  function applySuggestion() {
    setValues((current) => current.map((row) => ({
      ...row,
      physical_weight_percent: row.suggested_percent,
      distribution_method: "quantity",
      source: row.suggested_source,
    })));
  }

  function applyEqual() {
    const equal = normalizedPercentages(values.map(() => 1));
    setValues((current) => current.map((row, index) => ({ ...row, physical_weight_percent: equal[index], source: "manual" })));
  }

  return (
    <>
      <button className="physical-weight-open" type="button" onClick={() => dialogRef.current?.showModal()}>Definir pesos físicos</button>
      <dialog ref={dialogRef} className="budget-modal physical-weight-modal">
        <form action={saveScheduleServiceWeights} className="budget-modal-form">
          <input type="hidden" name="baseline_id" value={baselineId} />
          <input type="hidden" name="selected_date" value={selectedDate} />
          <input type="hidden" name="weights_json" value={JSON.stringify(values.map(({ code: _code, description: _description, activity_count: _activityCount, quantity_total: _quantityTotal, planned_cost: _plannedCost, suggested_percent: _suggestedPercent, suggested_source: _suggestedSource, ...row }) => row))} />
          <header className="budget-modal-head">
            <div><span>Andamento físico</span><h2>Pesos por serviço</h2></div>
            <button type="button" className="budget-modal-close" onClick={() => dialogRef.current?.close()} aria-label="Fechar">×</button>
          </header>
          <div className="budget-modal-body">
            <div className="physical-weight-help">
              <div><strong>O total deve fechar 100%</strong><p>A sugestão usa o orçamento. Dentro de cada serviço, o peso é distribuído pelos pavimentos conforme as quantidades.</p></div>
              <div className={valid ? "valid" : "invalid"}><span>Total</span><strong>{numberBR(total, 2)}%</strong></div>
            </div>
            <div className="physical-weight-tools"><button type="button" onClick={applySuggestion}>Aplicar sugestão do orçamento</button><button type="button" onClick={applyEqual}>Dividir igualmente</button></div>
            <div className="physical-weight-table-wrap">
              <table className="physical-weight-table">
                <thead><tr><th>Serviço</th><th>Atividades</th><th>Custo planejado</th><th>Sugestão</th><th>Peso físico</th><th>Distribuir nos pavimentos por</th></tr></thead>
                <tbody>{values.map((row, index) => (
                  <tr key={row.service_id}>
                    <td><strong>{row.code}</strong><span>{row.description}</span></td>
                    <td>{row.activity_count}</td>
                    <td>{new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(row.planned_cost)}</td>
                    <td>{numberBR(row.suggested_percent, 2)}%</td>
                    <td><div className="physical-weight-input"><input type="number" min="0" max="100" step="0.01" value={Number(row.physical_weight_percent)} onChange={(event) => setValues((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, physical_weight_percent: Number(event.target.value), source: "manual" } : item))} /><b>%</b></div></td>
                    <td><select value={row.distribution_method} onChange={(event) => setValues((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, distribution_method: event.target.value as PhysicalWeightRecord["distribution_method"], source: "manual" } : item))}><option value="quantity">Quantidade prevista</option><option value="cost">Custo planejado</option><option value="duration">Duração</option><option value="equal">Igualmente</option></select></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>
          <footer className="budget-modal-foot"><button type="button" className="budget-secondary-button" onClick={() => dialogRef.current?.close()}>Cancelar</button><button type="submit" className="budget-primary-button" disabled={!valid}>Salvar pesos físicos</button></footer>
        </form>
      </dialog>
    </>
  );
}

export function PhysicalProgressPanel({
  baselineId,
  selectedDate,
  activities,
  measurements,
  services,
  weights,
  canManage,
}: {
  baselineId: string;
  selectedDate: string;
  activities: ExecutionScheduleActivity[];
  measurements: ExecutionScheduleMeasurement[];
  services: ExecutionScheduleService[];
  weights: PhysicalWeightRecord[];
  canManage: boolean;
}) {
  const activeActivities = useMemo(() => activities.filter((activity) => activity.record_status === "active"), [activities]);
  const selectedMeasurements = useMemo(() => {
    const map = new Map<string, ExecutionScheduleMeasurement>();
    measurements
      .filter((measurement) => measurement.measurement_date <= selectedDate)
      .sort((a, b) => a.measurement_date.localeCompare(b.measurement_date) || a.created_at.localeCompare(b.created_at))
      .forEach((measurement) => map.set(measurement.activity_id, measurement));
    return map;
  }, [measurements, selectedDate]);

  const serviceRows = useMemo(() => {
    const usedServices = services.filter((service) => activeActivities.some((activity) => activity.service_id === service.id));
    const costs = usedServices.map((service) => activeActivities.filter((activity) => activity.service_id === service.id).reduce((sum, activity) => sum + Math.max(0, Number(activity.planned_cost)), 0));
    const durations = usedServices.map((service) => activeActivities.filter((activity) => activity.service_id === service.id).reduce((sum, activity) => sum + Math.max(1, Number(activity.duration_days)), 0));
    const useBudget = costs.reduce((sum, value) => sum + value, 0) > 0;
    const suggestions = normalizedPercentages(useBudget ? costs : durations);
    const configured = new Map(weights.map((weight) => [weight.service_id, weight]));
    const configuredValid = weights.length === usedServices.length && Math.abs(weights.reduce((sum, weight) => sum + Number(weight.physical_weight_percent), 0) - 100) <= 0.01;

    return usedServices.map((service, index): EditorRow => {
      const serviceActivities = activeActivities.filter((activity) => activity.service_id === service.id);
      const current = configuredValid ? configured.get(service.id) : null;
      return {
        service_id: service.id,
        code: service.code,
        description: service.description,
        activity_count: serviceActivities.length,
        quantity_total: serviceActivities.reduce((sum, activity) => sum + Math.max(0, Number(activity.quantity_snapshot)), 0),
        planned_cost: costs[index],
        suggested_percent: suggestions[index],
        suggested_source: useBudget ? "suggested_budget" : "suggested_duration",
        physical_weight_percent: current?.physical_weight_percent ?? suggestions[index],
        distribution_method: current?.distribution_method ?? "quantity",
        source: current?.source ?? (useBudget ? "suggested_budget" : "suggested_duration"),
        notes: current?.notes ?? null,
      };
    });
  }, [activeActivities, services, weights]);

  const configured = weights.length === serviceRows.length && weights.length > 0 && Math.abs(weights.reduce((sum, weight) => sum + Number(weight.physical_weight_percent), 0) - 100) <= 0.01;
  const activityWeights = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of serviceRows) {
      const serviceActivities = activeActivities.filter((activity) => activity.service_id === row.service_id);
      let values = serviceActivities.map((activity) => distributionValue(activity, row.distribution_method));
      if (values.reduce((sum, value) => sum + value, 0) <= 0) values = serviceActivities.map(fallbackDistributionValue);
      const total = values.reduce((sum, value) => sum + value, 0) || serviceActivities.length || 1;
      serviceActivities.forEach((activity, index) => map.set(activity.id, Number(row.physical_weight_percent) * values[index] / total));
    }
    return map;
  }, [activeActivities, serviceRows]);

  const planned = activeActivities.reduce((sum, activity) => sum + plannedProgress(activity, selectedDate) * (activityWeights.get(activity.id) ?? 0), 0) / 100;
  const actual = activeActivities.reduce((sum, activity) => sum + Number(selectedMeasurements.get(activity.id)?.progress_percent ?? 0) * (activityWeights.get(activity.id) ?? 0), 0) / 100;
  const delayed = activeActivities.filter((activity) => Number(selectedMeasurements.get(activity.id)?.progress_percent ?? 0) + 0.5 < plannedProgress(activity, selectedDate)).length;
  const forecastFinish = activeActivities.reduce((latest, activity) => {
    const finish = selectedMeasurements.get(activity.id)?.current_finish ?? activity.planned_finish;
    return !latest || finish > latest ? finish : latest;
  }, "");

  return (
    <section className="physical-progress-panel">
      <header><div><span>Critério do andamento físico</span><strong>Pesos por serviço · distribuição por quantidade</strong><small>{configured ? "Pesos aprovados e salvos para esta linha de base." : "Usando sugestão automática do orçamento até os pesos serem aprovados."}</small></div><div className="physical-progress-actions"><em className={configured ? "configured" : "suggested"}>{configured ? "Pesos configurados" : "Sugestão automática"}</em>{canManage ? <PhysicalWeightsDialog baselineId={baselineId} selectedDate={selectedDate} rows={serviceRows} /> : null}</div></header>
      <div className="physical-progress-kpis">
        <article><span>Avanço físico previsto</span><strong>{numberBR(planned, 1)}%</strong><small>até {dateBR(selectedDate)}</small></article>
        <article><span>Avanço físico realizado</span><strong>{numberBR(actual, 1)}%</strong><small>{actual - planned >= 0 ? "+" : ""}{numberBR(actual - planned, 1)} p.p. de desvio</small></article>
        <article><span>Atividades atrasadas</span><strong>{delayed}</strong><small>abaixo do previsto na data</small></article>
        <article><span>Conclusão atual</span><strong>{dateBR(forecastFinish)}</strong><small>última data reprogramada</small></article>
      </div>
    </section>
  );
}
