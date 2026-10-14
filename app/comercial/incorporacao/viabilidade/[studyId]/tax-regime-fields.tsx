"use client";

import { useState } from "react";

export function TaxRegimeFields({ regime, rate, disabled = false }: { regime: string; rate: number; disabled?: boolean }) {
  const [currentRegime, setCurrentRegime] = useState(regime === "common" ? "common" : "ret");
  const [currentRate, setCurrentRate] = useState(Number(rate || (currentRegime === "ret" ? 4 : 5.93)));
  return <>
    <label>Regime tributário
      <select name="tax_regime" value={currentRegime} disabled={disabled} onChange={(event) => {
        const next = event.target.value === "common" ? "common" : "ret";
        setCurrentRegime(next);
        setCurrentRate(next === "ret" ? 4 : 5.93);
      }}>
        <option value="ret">RET · referência 4%</option>
        <option value="common">Incorporação comum</option>
      </select>
      {disabled ? <input type="hidden" name="tax_regime" value={currentRegime} /> : null}
    </label>
    <label>Impostos sobre recebimentos (%)
      <input name="tax_rate_pct" type="number" min="0" max="100" step="0.01" value={currentRate} disabled={disabled}
        onChange={(event) => setCurrentRate(Number(event.target.value))} />
      {disabled ? <input type="hidden" name="tax_rate_pct" value={currentRate} /> : null}
    </label>
  </>;
}
