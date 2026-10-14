"use client";

import { useState } from "react";

export function TaxRegimeFields({ regime, rate, disabled = false }: { regime: string; rate: number; disabled?: boolean }) {
  const initialRegime = regime === "common" ? "common" : "ret";
  const [currentRegime, setCurrentRegime] = useState(initialRegime);
  const [currentRate, setCurrentRate] = useState(Number.isFinite(Number(rate)) ? Number(rate) : initialRegime === "ret" ? 4 : 0);
  return <>
    <label>Regime tributário
      <select name="tax_regime" value={currentRegime} disabled={disabled} onChange={(event) => {
        const next = event.target.value === "common" ? "common" : "ret";
        setCurrentRegime(next);
        setCurrentRate(next === "ret" ? 4 : 0);
      }}>
        <option value="ret">RET · referência 4%</option>
        <option value="common">Incorporação comum · informar premissa</option>
      </select>
      {disabled ? <input type="hidden" name="tax_regime" value={currentRegime} /> : null}
    </label>
    <label>Impostos sobre recebimentos (%)
      <input name="tax_rate_pct" type="number" min="0" max="100" step="0.01" value={currentRate} disabled={disabled}
        onChange={(event) => setCurrentRate(Number(event.target.value))} />
      {disabled ? <input type="hidden" name="tax_rate_pct" value={currentRate} /> : null}
      <small>{currentRegime === "ret" ? "Referência inicial do RET. A alíquota permanece editável." : "Informe a alíquota efetiva usada pela empresa na viabilidade."}</small>
    </label>
  </>;
}
