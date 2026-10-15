"use client";

import { useState } from "react";
import {
  copyPreviousFeasibilitySalesPhaseTerms,
  initializeFeasibilitySalesPlan,
  updateFeasibilitySalesPhase,
} from "../sales-plan-actions";
import type { FeasibilitySalesVelocity } from "./managed-assumptions";

type SalesPhase = FeasibilitySalesVelocity & {
  phase_key?: string | null;
  target_units?: number | null;
  target_units_pct?: number | null;
  price_appreciation_pct?: number | null;
  entry_pct?: number | null;
  monthly_pct?: number | null;
  keys_pct?: number | null;
  monthly_installments?: number | null;
};

const PHASE_LABELS: Record<string,string> = {
  prelaunch:"Pré-lançamento",
  launch:"Lançamento",
  construction_start:"Início das obras",
  mid_construction:"Meio das obras",
  ready:"Pronto",
};

function number(value: unknown, digits = 1) {
  return Number(value ?? 0).toLocaleString("pt-BR", { maximumFractionDigits:digits });
}
function offsetLabel(value: number) {
  if (value === 0) return "início da obra";
  if (value < 0) return `${Math.abs(value)} mês(es) antes da obra`;
  return `${value} mês(es) após o início da obra`;
}
function periodLabel(start: number, nextStart: number | null) {
  const startText = offsetLabel(start);
  if (nextStart == null) return `${startText} → fim das vendas`;
  const duration = Math.max(0, nextStart - start);
  return `${startText} → ${offsetLabel(nextStart)} · ${duration} mês(es)`;
}

function PhaseTargetUnitsField({ initialValue, availableUnits }: { initialValue:number; availableUnits:number }) {
  const [value, setValue] = useState(String(Math.max(0, Math.round(initialValue))));
  const parsed = Number(value.replace(",", "."));
  const pct = availableUnits > 0 && Number.isFinite(parsed) ? parsed / availableUnits * 100 : 0;
  return <label>
    Meta de vendas (unidades)
    <input
      name="target_units"
      type="number"
      min="0"
      max={Math.max(0, Math.round(availableUnits))}
      step="1"
      value={value}
      onChange={event => setValue(event.target.value)}
      required
    />
    <small style={{fontWeight:600,color:"var(--muted)"}}>{Number.isFinite(parsed) ? `${number(parsed,0)} un. = ${number(pct,1)}% do estoque` : "Informe a quantidade de unidades."}</small>
  </label>;
}

function deriveTargets(phases: SalesPhase[], availableUnits: number) {
  const hasStoredTargets = phases.some(item => item.target_units != null);
  if (hasStoredTargets) {
    return phases.map(item => item.target_units != null
      ? Math.max(0, Math.round(Number(item.target_units)))
      : Math.max(0, Math.round(availableUnits * Number(item.target_units_pct ?? 0) / 100)));
  }
  let cumulativePct = 0;
  let previousUnits = 0;
  return phases.map(item => {
    cumulativePct += Number(item.target_units_pct ?? 0);
    const cumulativeUnits = Math.max(0, Math.round(availableUnits * cumulativePct / 100));
    const target = Math.max(0, cumulativeUnits - previousUnits);
    previousUnits = cumulativeUnits;
    return target;
  });
}

export function FeasibilitySalesPlanManager({
  studyId,
  salesVelocities,
  availableUnits,
  editable,
}: {
  studyId:string;
  salesVelocities:SalesPhase[];
  availableUnits:number;
  editable:boolean;
}) {
  const phases = salesVelocities
    .filter(item => item.phase_key)
    .sort((a,b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0));

  if (!phases.length) {
    const legacy = salesVelocities[0];
    return <section className="feasibility-card feasibility-section">
      <div className="feasibility-section-title">
        <div><span>Plano de Vendas e Recebimentos</span><h2>5 fases comerciais</h2></div>
        <p>Pré-lançamento → lançamento → início das obras → meio das obras → pronto.</p>
      </div>
      <div className="feasibility-note">
        <strong>O estudo ainda usa o modelo antigo.</strong> {legacy ? <>Velocidade atual: {number(legacy.units_per_month,2)} un./mês a partir de {offsetLabel(Number(legacy.start_offset_months))}.</> : <>Nenhuma velocidade cadastrada.</>}
        <br />Ao ativar, o Elos cria as cinco fases sem apagar a premissa histórica. Você passa a definir quantidade de unidades, velocidade, valorização e condição comercial em cada fase.
      </div>
      {editable ? <form action={initializeFeasibilitySalesPlan} className="feasibility-actions">
        <input type="hidden" name="study_id" value={studyId}/>
        <button className="feasibility-primary" type="submit">Ativar plano em 5 fases</button>
      </form> : null}
    </section>;
  }

  const resolvedTargets = deriveTargets(phases, availableUnits);
  const targetUnitsTotal = resolvedTargets.reduce((sum,value) => sum + value, 0);
  const targetTotalPct = availableUnits > 0 ? targetUnitsTotal / availableUnits * 100 : 0;
  let cumulativeFactor = 1;

  return <section className="feasibility-card feasibility-section">
    <div className="feasibility-section-title">
      <div><span>Plano de Vendas e Recebimentos</span><h2>Estratégia comercial por fase</h2></div>
      <p>O início de cada fase também encerra a fase anterior. A última permanece ativa até zerar o estoque.</p>
    </div>

    <div className="feasibility-sales-summary">
      <article><span>Estoque comercializável</span><strong>{number(availableUnits,0)} un.</strong></article>
      <article className={targetUnitsTotal === Math.round(availableUnits) ? "positive" : "attention"}><span>Meta distribuída</span><strong>{number(targetUnitsTotal,0)} un.</strong><small>{number(targetTotalPct,1)}% do estoque</small></article>
      <article><span>Fases</span><strong>5</strong></article>
      <article><span>Regra de preço</span><strong>Valorização progressiva</strong></article>
    </div>

    {targetUnitsTotal !== Math.round(availableUnits) ? <div className="feasibility-note feasibility-warning" style={{marginTop:12}}>
      <strong>Atenção:</strong> as metas das cinco fases somam {number(targetUnitsTotal,0)} unidade(s), mas o estoque comercializável possui {number(availableUnits,0)}. Ajuste as quantidades para fechar todo o estoque.
    </div> : null}

    <div className="feasibility-sales-timeline">
      {phases.map((item,index) => {
        const appreciation = Number(item.price_appreciation_pct ?? 0);
        cumulativeFactor *= 1 + appreciation / 100;
        const targetUnits = resolvedTargets[index] ?? 0;
        const targetPct = availableUnits > 0 ? targetUnits / availableUnits * 100 : 0;
        const velocity = Number(item.units_per_month ?? 0);
        const monthsNeeded = velocity > 0 ? targetUnits / velocity : 0;
        const next = phases[index + 1];
        const startOffset = Number(item.start_offset_months);
        const nextStartOffset = next ? Number(next.start_offset_months) : null;
        const windowMonths = nextStartOffset == null ? null : Math.max(0, nextStartOffset - startOffset);
        const capacity = windowMonths == null ? null : velocity * windowMonths;
        const capacityWarning = capacity != null && targetUnits > capacity + 0.01;
        const entry = Number(item.entry_pct ?? 0);
        const monthly = Number(item.monthly_pct ?? 0);
        const keys = Number(item.keys_pct ?? 0);
        const installments = Number(item.monthly_installments ?? 1);
        const paymentTotal = entry + monthly + keys;
        const label = PHASE_LABELS[item.phase_key ?? ""] ?? item.name;

        return <article className={`feasibility-sales-phase ${capacityWarning ? "warning" : ""}`} key={item.id}>
          <div className="feasibility-sales-phase-head">
            <span className="feasibility-phase-number">{index + 1}</span>
            <div><strong>{label}</strong><small>Período: {periodLabel(startOffset,nextStartOffset)}</small></div>
          </div>
          <div className="feasibility-sales-phase-metrics">
            <div><span>Meta</span><strong>{number(targetUnits,0)} un.</strong><small>{number(targetPct,1)}% do estoque</small></div>
            <div><span>Velocidade</span><strong>{number(velocity,2)}</strong><small>un./mês</small></div>
            <div><span>Valorização</span><strong>{appreciation >= 0 ? "+" : ""}{number(appreciation,1)}%</strong><small>vs. fase anterior</small></div>
          </div>
          <div className="feasibility-phase-terms">{number(entry,1)}% entrada · {number(monthly,1)}% em {installments}x · {number(keys,1)}% chaves</div>
          <small className="feasibility-phase-helper">
            {number(monthsNeeded,1)} mês(es) para vender {number(targetUnits,0)} un.{windowMonths != null ? ` · janela disponível: ${windowMonths} mês(es)` : " · sem limite de janela"} · preço acumulado × {number(cumulativeFactor,3)}
          </small>
          {capacityWarning ? <div className="feasibility-phase-alert">Com esta velocidade, a fase não vende todas as {number(targetUnits,0)} unidades antes da próxima etapa. O saldo é carregado para a fase seguinte.</div> : null}
          {Math.abs(paymentTotal - 100) >= 0.001 ? <div className="feasibility-phase-alert">Condição comercial soma {number(paymentTotal,2)}%, e precisa fechar em 100%.</div> : null}

          {editable ? <details className="feasibility-phase-editor">
            <summary>Configurar fase</summary>
            <form action={updateFeasibilitySalesPhase} className="feasibility-phase-form">
              <input type="hidden" name="study_id" value={studyId}/>
              <input type="hidden" name="sales_phase_id" value={item.id}/>
              <input type="hidden" name="phase_key" value={item.phase_key ?? ""}/>
              <label>Começa em (meses vs. início da obra)<input name="start_offset_months" type="number" min="-60" max="240" defaultValue={startOffset} required /><small style={{fontWeight:600,color:"var(--muted)"}}>Negativo = antes da obra · 0 = início · positivo = depois.</small></label>
              <PhaseTargetUnitsField initialValue={targetUnits} availableUnits={availableUnits}/>
              <label>Velocidade (un./mês)<input name="units_per_month" type="number" min="0.01" step="0.01" defaultValue={velocity} required /></label>
              <label>Valorização vs. fase anterior (%)<input name="price_appreciation_pct" type="number" min="-90" max="500" step="0.01" defaultValue={appreciation} required /></label>
              <label>Entrada (%)<input name="entry_pct" type="number" min="0" max="100" step="0.01" defaultValue={entry} required /></label>
              <label>Mensais (%)<input name="monthly_pct" type="number" min="0" max="100" step="0.01" defaultValue={monthly} required /></label>
              <label>Nº parcelas mensais<input name="monthly_installments" type="number" min="1" max="240" defaultValue={installments} required /></label>
              <label>Chaves (%)<input name="keys_pct" type="number" min="0" max="100" step="0.01" defaultValue={keys} required /></label>
              <label className="span-2">Observação<input name="notes" defaultValue={item.notes ?? ""} placeholder="Opcional" /></label>
              <div className="feasibility-note span-2"><strong>Período desta fase:</strong> {periodLabel(startOffset,nextStartOffset)}. O término é definido automaticamente pelo início da próxima fase.</div>
              <div className="feasibility-actions span-2"><button className="feasibility-primary" type="submit">Salvar fase</button></div>
            </form>
            {index > 0 ? <form action={copyPreviousFeasibilitySalesPhaseTerms} className="feasibility-actions">
              <input type="hidden" name="study_id" value={studyId}/><input type="hidden" name="sales_phase_id" value={item.id}/>
              <button className="feasibility-secondary" type="submit">Copiar condição da fase anterior</button>
            </form> : null}
          </details> : null}
        </article>;
      })}
    </div>

    <div className="feasibility-note" style={{marginTop:14}}>
      <strong>Como o motor calcula:</strong> a meta é cadastrada em número de unidades; a porcentagem é apenas informativa e muda automaticamente conforme a quantidade. Cada fase vai do seu início até o início da próxima. Se a janela terminar antes de atingir a meta, o estoque pendente segue para a fase seguinte e passa a usar o preço e a condição comercial daquela fase.
    </div>
  </section>;
}
