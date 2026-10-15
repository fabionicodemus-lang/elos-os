import {
  copyPreviousFeasibilitySalesPhaseTerms,
  initializeFeasibilitySalesPlan,
  updateFeasibilitySalesPhase,
} from "../sales-plan-actions";
import type { FeasibilitySalesVelocity } from "./managed-assumptions";

type SalesPhase = FeasibilitySalesVelocity & {
  phase_key?: string | null;
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
  if (value === 0) return "No início da obra";
  if (value < 0) return `${Math.abs(value)} mês(es) antes da obra`;
  return `${value} mês(es) após o início da obra`;
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
        <br />Ao ativar, o Elos cria as cinco fases sem apagar a premissa histórica. Você passa a definir meta, velocidade, valorização e condição comercial em cada fase.
      </div>
      {editable ? <form action={initializeFeasibilitySalesPlan} className="feasibility-actions">
        <input type="hidden" name="study_id" value={studyId}/>
        <button className="feasibility-primary" type="submit">Ativar plano em 5 fases</button>
      </form> : null}
    </section>;
  }

  const targetTotal = phases.reduce((sum,item) => sum + Number(item.target_units_pct ?? 0), 0);
  let cumulativeFactor = 1;

  return <section className="feasibility-card feasibility-section">
    <div className="feasibility-section-title">
      <div><span>Plano de Vendas e Recebimentos</span><h2>Estratégia comercial por fase</h2></div>
      <p>O preço parte das tipologias e recebe a valorização de cada fase. A condição comercial define quando o caixa entra.</p>
    </div>

    <div className="feasibility-sales-summary">
      <article><span>Estoque comercializável</span><strong>{number(availableUnits,2)} un.</strong></article>
      <article className={Math.abs(targetTotal - 100) < 0.001 ? "positive" : "attention"}><span>Meta distribuída</span><strong>{number(targetTotal,2)}%</strong></article>
      <article><span>Fases</span><strong>5</strong></article>
      <article><span>Regra de preço</span><strong>Valorização progressiva</strong></article>
    </div>

    {Math.abs(targetTotal - 100) >= 0.001 ? <div className="feasibility-note feasibility-warning" style={{marginTop:12}}>
      <strong>Atenção:</strong> as metas das cinco fases somam {number(targetTotal,2)}%. Ajuste para 100% para que o plano represente todo o estoque comercializável.
    </div> : null}

    <div className="feasibility-sales-timeline">
      {phases.map((item,index) => {
        const appreciation = Number(item.price_appreciation_pct ?? 0);
        cumulativeFactor *= 1 + appreciation / 100;
        const targetPct = Number(item.target_units_pct ?? 0);
        const targetUnits = availableUnits * targetPct / 100;
        const velocity = Number(item.units_per_month ?? 0);
        const monthsNeeded = velocity > 0 ? targetUnits / velocity : 0;
        const next = phases[index + 1];
        const windowMonths = next ? Math.max(0, Number(next.start_offset_months) - Number(item.start_offset_months)) : null;
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
            <div><strong>{label}</strong><small>{offsetLabel(Number(item.start_offset_months))}</small></div>
          </div>
          <div className="feasibility-sales-phase-metrics">
            <div><span>Meta</span><strong>{number(targetPct,1)}%</strong><small>≈ {number(targetUnits,1)} un.</small></div>
            <div><span>Velocidade</span><strong>{number(velocity,2)}</strong><small>un./mês</small></div>
            <div><span>Valorização</span><strong>{appreciation >= 0 ? "+" : ""}{number(appreciation,1)}%</strong><small>vs. fase anterior</small></div>
          </div>
          <div className="feasibility-phase-terms">{number(entry,1)}% entrada · {number(monthly,1)}% em {installments}x · {number(keys,1)}% chaves</div>
          <small className="feasibility-phase-helper">
            {number(monthsNeeded,1)} mês(es) para cumprir a meta{windowMonths != null ? ` · janela até a próxima fase: ${windowMonths} mês(es)` : ""} · preço acumulado × {number(cumulativeFactor,3)}
          </small>
          {capacityWarning ? <div className="feasibility-phase-alert">Com esta velocidade, a fase não atinge a meta antes da próxima etapa. O saldo é carregado para a fase seguinte.</div> : null}
          {Math.abs(paymentTotal - 100) >= 0.001 ? <div className="feasibility-phase-alert">Condição comercial soma {number(paymentTotal,2)}%, e precisa fechar em 100%.</div> : null}

          {editable ? <details className="feasibility-phase-editor">
            <summary>Configurar fase</summary>
            <form action={updateFeasibilitySalesPhase} className="feasibility-phase-form">
              <input type="hidden" name="study_id" value={studyId}/>
              <input type="hidden" name="sales_phase_id" value={item.id}/>
              <input type="hidden" name="phase_key" value={item.phase_key ?? ""}/>
              <label>Início vs. obra (meses)<input name="start_offset_months" type="number" min="-60" max="240" defaultValue={item.start_offset_months} required /></label>
              <label>Meta de vendas (%)<input name="target_units_pct" type="number" min="0" max="100" step="0.01" defaultValue={targetPct} required /></label>
              <label>Velocidade (un./mês)<input name="units_per_month" type="number" min="0.01" step="0.01" defaultValue={velocity} required /></label>
              <label>Valorização vs. fase anterior (%)<input name="price_appreciation_pct" type="number" min="-90" max="500" step="0.01" defaultValue={appreciation} required /></label>
              <label>Entrada (%)<input name="entry_pct" type="number" min="0" max="100" step="0.01" defaultValue={entry} required /></label>
              <label>Mensais (%)<input name="monthly_pct" type="number" min="0" max="100" step="0.01" defaultValue={monthly} required /></label>
              <label>Nº parcelas mensais<input name="monthly_installments" type="number" min="1" max="240" defaultValue={installments} required /></label>
              <label>Chaves (%)<input name="keys_pct" type="number" min="0" max="100" step="0.01" defaultValue={keys} required /></label>
              <label className="span-2">Observação<input name="notes" defaultValue={item.notes ?? ""} placeholder="Opcional" /></label>
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
      <strong>Como o motor calcula:</strong> cada fase tenta cumprir sua meta na velocidade informada. Se a janela terminar antes, o estoque pendente segue para a próxima fase e passa a usar o preço e a condição comercial daquela fase.
    </div>
  </section>;
}
