"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  approveDailyLog,
  cancelDailyLog,
  createDailyLog,
  removeDailyLogPhoto,
  reopenDailyLog,
  returnDailyLog,
  saveDailyLog,
  submitDailyLog,
} from "./actions";

export type DailyLogRecord = {
  id: string; log_date: string; shift: string; diary_type: string; log_number: string; version: number;
  status: string; work_start: string | null; work_end: string | null; general_notes: string | null;
  no_occurrences: boolean; no_safety_events: boolean; confirmed_by_filler: boolean; completion_percent: number;
  responsible_name: string; approved_at: string | null; approval_notes: string | null; reopened_reason: string | null;
};
export type WeatherRow = { id?: string; period: string; condition: string; temperature_c: number | null; rain_mm: number; stopped_hours: number; notes: string | null };
export type WorkforceRow = { id?: string; supplier_id: string | null; company_name: string; role_name: string; worker_count: number; work_start: string | null; work_end: string | null; break_hours: number; notes: string | null };
export type ServiceRow = { id?: string; schedule_activity_id: string | null; service_id: string | null; location_id: string | null; service_code: string; service_name: string; location_name: string | null; unit_snapshot: string | null; planned_quantity: number | null; executed_quantity: number | null; progress_percent: number | null; notes: string | null; source: string };
export type OccurrenceRow = { id?: string; occurrence_type: string; impact: string; title: string; description: string; action_taken: string | null; status: string; affects_schedule: boolean; is_safety_event: boolean; is_critical: boolean; occurred_at: string | null };
export type PhotoRow = { id: string; file_name: string; caption: string | null; signed_url: string | null };
export type SupplierOption = { id: string; legal_name: string; trade_name: string | null };
export type ActivityOption = { id: string; service_id: string | null; location_id: string | null; code: string; name: string; unit_snapshot: string | null; quantity_snapshot: number; planned_start: string; planned_finish: string };
export type LocationOption = { id: string; code: string; name: string };

const periodLabels: Record<string, string> = { morning: "Manhã", afternoon: "Tarde", night: "Noite" };
const weatherLabels: Record<string, string> = { sunny: "Sol", partly_cloudy: "Parcialmente nublado", cloudy: "Nublado", rain: "Chuva", storm: "Temporal", windy: "Vento forte", fog: "Neblina" };
const occurrenceLabels: Record<string, string> = { general: "Ocorrência geral", delay: "Atraso", interference: "Interferência", inspection: "Fiscalização", visit: "Visita", material: "Material", equipment: "Equipamento", quality: "Qualidade", incident: "Incidente", accident: "Acidente", stoppage: "Paralisação" };
const statusLabels: Record<string, string> = { pending: "Pendente", in_progress: "Em preenchimento", awaiting_approval: "Aguardando aprovação", approved: "Aprovado", approved_with_reservations: "Aprovado com ressalvas", reopened: "Reaberto", cancelled: "Cancelado" };

function localToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function numeric(value: string, fallback = 0) { const result = Number(value); return Number.isFinite(result) ? result : fallback; }

export function DailyLogCreateDialog({ defaultDate, defaultShift = "day", allowComplementary = false, autoOpen = false, buttonLabel = "+ Criar novo diário" }: {
  defaultDate?: string; defaultShift?: string; allowComplementary?: boolean; autoOpen?: boolean; buttonLabel?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (autoOpen) ref.current?.showModal(); }, [autoOpen]);
  return <>
    <button className="elos-button" type="button" onClick={() => ref.current?.showModal()}>{buttonLabel}</button>
    <dialog className="daily-log-create-dialog" ref={ref}>
      <form action={createDailyLog}>
        <div className="daily-log-dialog-head"><div><span>Execução · Diário de Obras</span><h2>Criar diário</h2></div><button type="button" onClick={() => ref.current?.close()}>×</button></div>
        <div className="daily-log-dialog-body">
          <label>Data<input name="log_date" type="date" defaultValue={defaultDate || localToday()} required /></label>
          <label>Turno<select name="shift" defaultValue={defaultShift}><option value="day">Diurno</option><option value="night">Noturno</option></select></label>
          <label>Tipo<select name="diary_type" defaultValue="principal"><option value="principal">Diário principal</option>{allowComplementary ? <option value="complementary">Diário complementar</option> : null}</select></label>
          <label className="daily-log-check"><input name="copy_previous" type="checkbox" /> Copiar empresas, funções e serviços do último dia útil</label>
          <p>Fotos, acidentes e ocorrências encerradas nunca são copiados automaticamente.</p>
        </div>
        <div className="daily-log-dialog-foot"><button type="button" onClick={() => ref.current?.close()}>Cancelar</button><button className="primary" type="submit">Criar e preencher</button></div>
      </form>
    </dialog>
  </>;
}

function emptyWeather(period: string): WeatherRow { return { period, condition: "", temperature_c: null, rain_mm: 0, stopped_hours: 0, notes: null }; }
function emptyWorkforce(): WorkforceRow { return { supplier_id: null, company_name: "", role_name: "", worker_count: 1, work_start: "07:00", work_end: "17:00", break_hours: 1, notes: null }; }
function emptyService(): ServiceRow { return { schedule_activity_id: null, service_id: null, location_id: null, service_code: "", service_name: "", location_name: null, unit_snapshot: null, planned_quantity: null, executed_quantity: null, progress_percent: null, notes: null, source: "manual" }; }
function emptyOccurrence(safety = false): OccurrenceRow { return { occurrence_type: safety ? "incident" : "general", impact: "low", title: "", description: "", action_taken: null, status: "open", affects_schedule: false, is_safety_event: safety, is_critical: false, occurred_at: null }; }

export function DailyLogEditor({ diary, initialWeather, initialWorkforce, initialServices, initialOccurrences, photos, suppliers, activities, locations, canManage, canSubmit, canApprove, canReopen }: {
  diary: DailyLogRecord; initialWeather: WeatherRow[]; initialWorkforce: WorkforceRow[]; initialServices: ServiceRow[]; initialOccurrences: OccurrenceRow[]; photos: PhotoRow[];
  suppliers: SupplierOption[]; activities: ActivityOption[]; locations: LocationOption[]; canManage: boolean; canSubmit: boolean; canApprove: boolean; canReopen: boolean;
}) {
  const [weather, setWeather] = useState<WeatherRow[]>(["morning", "afternoon", "night"].map((period) => initialWeather.find((item) => item.period === period) ?? emptyWeather(period)));
  const [workforce, setWorkforce] = useState<WorkforceRow[]>(initialWorkforce.length ? initialWorkforce : [emptyWorkforce()]);
  const [services, setServices] = useState<ServiceRow[]>(initialServices.length ? initialServices : [emptyService()]);
  const [occurrences, setOccurrences] = useState<OccurrenceRow[]>(initialOccurrences);
  const locked = !canManage || !["pending", "in_progress", "reopened"].includes(diary.status);
  const totalWorkers = workforce.reduce((sum, item) => sum + Number(item.worker_count || 0), 0);
  const companies = new Set(workforce.map((item) => item.supplier_id || item.company_name.trim()).filter(Boolean)).size;
  const manHours = workforce.reduce((sum, item) => {
    const start = item.work_start?.split(":").map(Number); const end = item.work_end?.split(":").map(Number);
    if (!start || !end) return sum;
    const hours = Math.max(0, (end[0] + end[1] / 60) - (start[0] + start[1] / 60) - Number(item.break_hours || 0));
    return sum + hours * Number(item.worker_count || 0);
  }, 0);
  const activityMap = useMemo(() => new Map(activities.map((item) => [item.id, item])), [activities]);
  const locationMap = useMemo(() => new Map(locations.map((item) => [item.id, item])), [locations]);

  function updateWeather(index: number, patch: Partial<WeatherRow>) { setWeather((rows) => rows.map((row, i) => i === index ? { ...row, ...patch } : row)); }
  function updateWorkforce(index: number, patch: Partial<WorkforceRow>) { setWorkforce((rows) => rows.map((row, i) => i === index ? { ...row, ...patch } : row)); }
  function updateService(index: number, patch: Partial<ServiceRow>) { setServices((rows) => rows.map((row, i) => i === index ? { ...row, ...patch } : row)); }
  function updateOccurrence(index: number, patch: Partial<OccurrenceRow>) { setOccurrences((rows) => rows.map((row, i) => i === index ? { ...row, ...patch } : row)); }

  return <section className="daily-log-editor">
    <div className="daily-log-editor-head">
      <div><span>{diary.log_number} · versão {diary.version}</span><h2>{new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", dateStyle: "full" }).format(new Date(`${diary.log_date}T12:00:00Z`))}</h2><p>{diary.shift === "night" ? "Turno noturno" : "Turno diurno"} · {diary.diary_type === "principal" ? "Diário principal" : "Complementar"} · Responsável: {diary.responsible_name}</p></div>
      <div className="daily-log-editor-status"><span className={`daily-log-status ${diary.status}`}>{statusLabels[diary.status] ?? diary.status}</span><strong>{Number(diary.completion_percent).toFixed(0)}%</strong></div>
    </div>
    <div className="daily-log-progress"><i style={{ width: `${Number(diary.completion_percent)}%` }} /></div>
    {locked ? <div className="daily-log-locked">Esta versão está bloqueada. O histórico aprovado é preservado e não pode ser sobrescrito.</div> : null}

    <form action={saveDailyLog} encType="multipart/form-data">
      <input type="hidden" name="daily_log_id" value={diary.id} /><input type="hidden" name="log_date" value={diary.log_date} />
      <input type="hidden" name="weather_json" value={JSON.stringify(weather.filter((item) => item.condition))} />
      <input type="hidden" name="workforce_json" value={JSON.stringify(workforce.filter((item) => Number(item.worker_count) > 0))} />
      <input type="hidden" name="services_json" value={JSON.stringify(services.filter((item) => item.schedule_activity_id || item.service_name.trim()))} />
      <input type="hidden" name="occurrences_json" value={JSON.stringify(occurrences.filter((item) => item.title.trim() && item.description.trim()))} />
      <fieldset disabled={locked}>
        <details className="daily-log-section" open><summary><span>1</span><div><strong>Informações básicas</strong><small>Jornada, observações e confirmação do responsável</small></div></summary><div className="daily-log-section-body daily-log-basic-grid">
          <label>Início da jornada<input name="work_start" type="time" defaultValue={diary.work_start?.slice(0, 5) ?? "07:00"} /></label>
          <label>Fim da jornada<input name="work_end" type="time" defaultValue={diary.work_end?.slice(0, 5) ?? "18:00"} /></label>
          <label className="span2">Resumo geral do dia<textarea name="general_notes" rows={4} defaultValue={diary.general_notes ?? ""} placeholder="Produção, condições gerais, decisões e fatos relevantes do dia." /></label>
          <label className="daily-log-check span2"><input name="confirmed_by_filler" type="checkbox" defaultChecked={diary.confirmed_by_filler} /> Confirmo que as informações registradas representam o ocorrido na obra.</label>
        </div></details>

        <details className="daily-log-section" open><summary><span>2</span><div><strong>Clima por período</strong><small>Condição, chuva e horas paralisadas</small></div></summary><div className="daily-log-section-body daily-log-weather-grid">
          {weather.map((item, index) => <article key={item.period}><h3>{periodLabels[item.period]}</h3><label>Condição<select value={item.condition} onChange={(event) => updateWeather(index, { condition: event.target.value })}><option value="">Selecione</option>{Object.entries(weatherLabels).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></label><div><label>Temperatura<input type="number" step="0.1" value={item.temperature_c ?? ""} onChange={(event) => updateWeather(index, { temperature_c: event.target.value ? numeric(event.target.value) : null })} /></label><label>Chuva (mm)<input type="number" min="0" step="0.1" value={item.rain_mm} onChange={(event) => updateWeather(index, { rain_mm: numeric(event.target.value) })} /></label><label>Paralisação (h)<input type="number" min="0" step="0.25" value={item.stopped_hours} onChange={(event) => updateWeather(index, { stopped_hours: numeric(event.target.value) })} /></label></div><label>Observação<input value={item.notes ?? ""} onChange={(event) => updateWeather(index, { notes: event.target.value })} /></label></article>)}
        </div></details>

        <details className="daily-log-section" open><summary><span>3</span><div><strong>Empresas e mão de obra</strong><small>{totalWorkers} trabalhadores · {companies} empresas · {Math.round(manHours)} homem-hora</small></div></summary><div className="daily-log-section-body">
          <div className="daily-log-table-wrap"><table className="daily-log-edit-table"><thead><tr><th>Empresa</th><th>Função / equipe</th><th>Qtd.</th><th>Entrada</th><th>Saída</th><th>Intervalo</th><th></th></tr></thead><tbody>{workforce.map((item,index) => <tr key={index}><td><select value={item.supplier_id ?? ""} onChange={(event) => updateWorkforce(index, { supplier_id: event.target.value || null })}><option value="">Equipe interna / outra</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.trade_name || supplier.legal_name}</option>)}</select>{!item.supplier_id ? <input value={item.company_name} placeholder="Nome da empresa" onChange={(event) => updateWorkforce(index, { company_name: event.target.value })} /> : null}</td><td><input value={item.role_name} placeholder="Pedreiro, eletricista..." onChange={(event) => updateWorkforce(index, { role_name: event.target.value })} /></td><td><input type="number" min="1" value={item.worker_count} onChange={(event) => updateWorkforce(index, { worker_count: numeric(event.target.value, 1) })} /></td><td><input type="time" value={item.work_start?.slice(0,5) ?? ""} onChange={(event) => updateWorkforce(index, { work_start: event.target.value })} /></td><td><input type="time" value={item.work_end?.slice(0,5) ?? ""} onChange={(event) => updateWorkforce(index, { work_end: event.target.value })} /></td><td><input type="number" min="0" step="0.25" value={item.break_hours} onChange={(event) => updateWorkforce(index, { break_hours: numeric(event.target.value) })} /></td><td><button type="button" onClick={() => setWorkforce((rows) => rows.filter((_,i) => i !== index))}>×</button></td></tr>)}</tbody></table></div>
          <button className="daily-log-add" type="button" onClick={() => setWorkforce((rows) => [...rows, emptyWorkforce()])}>+ Adicionar empresa ou função</button>
        </div></details>

        <details className="daily-log-section" open><summary><span>4</span><div><strong>Serviços em execução</strong><small>Vínculo com atividades e locais do cronograma</small></div></summary><div className="daily-log-section-body">
          {services.map((item,index) => <article className="daily-log-service-row" key={index}><label>Atividade do cronograma<select value={item.schedule_activity_id ?? ""} onChange={(event) => { const activity = activityMap.get(event.target.value); updateService(index, activity ? { schedule_activity_id: activity.id, service_id: activity.service_id, location_id: activity.location_id, service_code: activity.code, service_name: activity.name, unit_snapshot: activity.unit_snapshot, planned_quantity: Number(activity.quantity_snapshot), source: "schedule" } : { ...emptyService() }); }}><option value="">Serviço manual</option>{activities.map((activity) => <option key={activity.id} value={activity.id}>{activity.code} · {activity.name} · {activity.planned_start.slice(8,10)}/{activity.planned_start.slice(5,7)} a {activity.planned_finish.slice(8,10)}/{activity.planned_finish.slice(5,7)}</option>)}</select></label>{!item.schedule_activity_id ? <><label>Código<input value={item.service_code} onChange={(event) => updateService(index, { service_code: event.target.value })} /></label><label>Serviço<input value={item.service_name} onChange={(event) => updateService(index, { service_name: event.target.value })} /></label><label>Local<select value={item.location_id ?? ""} onChange={(event) => { const location = locationMap.get(event.target.value); updateService(index, { location_id: event.target.value || null, location_name: location ? `${location.code} · ${location.name}` : null }); }}><option value="">Não definido</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.code} · {location.name}</option>)}</select></label></> : null}<label>Quantidade executada<input type="number" min="0" step="0.0001" value={item.executed_quantity ?? ""} onChange={(event) => updateService(index, { executed_quantity: event.target.value ? numeric(event.target.value) : null })} /></label><label>Avanço da atividade (%)<input type="number" min="0" max="100" step="0.1" value={item.progress_percent ?? ""} onChange={(event) => updateService(index, { progress_percent: event.target.value ? numeric(event.target.value) : null })} /></label><label className="grow">Observação<input value={item.notes ?? ""} onChange={(event) => updateService(index, { notes: event.target.value })} /></label><button type="button" onClick={() => setServices((rows) => rows.filter((_,i) => i !== index))}>Remover</button></article>)}
          <button className="daily-log-add" type="button" onClick={() => setServices((rows) => [...rows, emptyService()])}>+ Adicionar serviço</button>
        </div></details>

        <details className="daily-log-section" open><summary><span>5</span><div><strong>Ocorrências e segurança</strong><small>Interferências, atrasos, incidentes, acidentes e paralisações</small></div></summary><div className="daily-log-section-body">
          <div className="daily-log-occurrence-checks"><label className="daily-log-check"><input name="no_occurrences" type="checkbox" defaultChecked={diary.no_occurrences} /> Não houve ocorrência operacional</label><label className="daily-log-check"><input name="no_safety_events" type="checkbox" defaultChecked={diary.no_safety_events} /> Não houve acidente ou incidente de segurança</label></div>
          {occurrences.map((item,index) => <article className={`daily-log-occurrence ${item.is_critical ? "critical" : ""}`} key={item.id ?? index}><div><label>Tipo<select value={item.occurrence_type} onChange={(event) => updateOccurrence(index, { occurrence_type: event.target.value, is_safety_event: ["incident","accident","stoppage"].includes(event.target.value) })}>{Object.entries(occurrenceLabels).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></label><label>Impacto<select value={item.impact} onChange={(event) => updateOccurrence(index, { impact: event.target.value })}><option value="low">Baixo</option><option value="medium">Médio</option><option value="high">Alto</option><option value="critical">Crítico</option></select></label><label>Status<select value={item.status} onChange={(event) => updateOccurrence(index, { status: event.target.value })}><option value="open">Aberta</option><option value="monitoring">Em acompanhamento</option><option value="resolved">Resolvida</option></select></label></div><label>Título<input value={item.title} onChange={(event) => updateOccurrence(index, { title: event.target.value })} /></label><label>Descrição<textarea rows={2} value={item.description} onChange={(event) => updateOccurrence(index, { description: event.target.value })} /></label><label>Ação tomada<textarea rows={2} value={item.action_taken ?? ""} onChange={(event) => updateOccurrence(index, { action_taken: event.target.value })} /></label><label className="daily-log-check"><input type="checkbox" checked={item.affects_schedule} onChange={(event) => updateOccurrence(index, { affects_schedule: event.target.checked })} /> Afeta prazo ou cronograma</label>{item.is_critical ? <small>Registro crítico protegido contra exclusão.</small> : <button type="button" onClick={() => setOccurrences((rows) => rows.filter((_,i) => i !== index))}>Remover ocorrência</button>}</article>)}
          <div className="daily-log-inline-actions"><button className="daily-log-add" type="button" onClick={() => setOccurrences((rows) => [...rows, emptyOccurrence(false)])}>+ Ocorrência</button><button className="daily-log-add danger" type="button" onClick={() => setOccurrences((rows) => [...rows, emptyOccurrence(true)])}>+ Incidente / acidente</button></div>
        </div></details>

        <details className="daily-log-section" open><summary><span>6</span><div><strong>Fotos e evidências</strong><small>{photos.length} foto(s) já registrada(s)</small></div></summary><div className="daily-log-section-body daily-log-photo-upload"><label>Adicionar fotos<input name="photos" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" multiple /></label><label>Legenda das novas fotos<input name="photo_caption" placeholder="Ex.: concretagem da laje do 12º pavimento" /></label><p>Máximo de 15 MB por imagem. As fotos ficam em armazenamento privado da empresa.</p></div></details>
      </fieldset>
      {!locked ? <div className="daily-log-save-bar"><span>O diário permanece em preenchimento até todas as seções obrigatórias alcançarem 100%.</span><button className="elos-button" type="submit">Salvar diário</button></div> : null}
    </form>

    {photos.length ? <section className="daily-log-gallery">{photos.map((photo) => <figure key={photo.id}>{photo.signed_url ? <img src={photo.signed_url} alt={photo.caption || photo.file_name} /> : <div>Imagem indisponível</div>}<figcaption><strong>{photo.caption || photo.file_name}</strong>{!locked ? <form action={removeDailyLogPhoto}><input type="hidden" name="photo_id" value={photo.id} /><input type="hidden" name="daily_log_id" value={diary.id} /><input type="hidden" name="log_date" value={diary.log_date} /><button type="submit">Remover</button></form> : null}</figcaption></figure>)}</section> : null}

    <section className="daily-log-workflow-actions">
      {canSubmit && !locked && Number(diary.completion_percent) >= 100 ? <form action={submitDailyLog}><input type="hidden" name="daily_log_id" value={diary.id} /><input type="hidden" name="log_date" value={diary.log_date} /><button className="elos-button" type="submit">Enviar para aprovação</button></form> : null}
      {canApprove && diary.status === "awaiting_approval" ? <><form action={approveDailyLog} className="daily-log-action-form"><input type="hidden" name="daily_log_id" value={diary.id} /><input type="hidden" name="log_date" value={diary.log_date} /><textarea name="approval_notes" placeholder="Observações da aprovação" /><label className="daily-log-check"><input name="with_reservations" type="checkbox" /> Aprovar com ressalvas</label><button className="elos-button" type="submit">Aprovar e bloquear</button></form><form action={returnDailyLog} className="daily-log-action-form"><input type="hidden" name="daily_log_id" value={diary.id} /><input type="hidden" name="log_date" value={diary.log_date} /><input name="reason" required placeholder="Motivo da devolução" /><button type="submit">Devolver para correção</button></form></> : null}
      {canReopen && ["approved", "approved_with_reservations"].includes(diary.status) ? <form action={reopenDailyLog} className="daily-log-action-form"><input type="hidden" name="daily_log_id" value={diary.id} /><input type="hidden" name="log_date" value={diary.log_date} /><input name="reason" required placeholder="Justificativa obrigatória da reabertura" /><button type="submit">Reabrir em nova versão</button></form> : null}
      {canApprove && !["approved", "approved_with_reservations", "cancelled"].includes(diary.status) ? <form action={cancelDailyLog} className="daily-log-action-form"><input type="hidden" name="daily_log_id" value={diary.id} /><input type="hidden" name="log_date" value={diary.log_date} /><input name="reason" required placeholder="Motivo obrigatório do cancelamento" /><button className="danger" type="submit">Cancelar diário</button></form> : null}
    </section>
  </section>;
}
