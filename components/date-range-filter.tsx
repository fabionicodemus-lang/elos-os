"use client";

import { useState } from "react";
import {
  dateRangePresetLabels,
  resolveDateRange,
  type DateRangePreset,
} from "@/lib/date-range";

export function DateRangeFilter({
  defaultPreset,
  defaultFrom,
  defaultTo,
}: {
  defaultPreset: DateRangePreset;
  defaultFrom: string;
  defaultTo: string;
}) {
  const [preset, setPreset] = useState<DateRangePreset>(defaultPreset);
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);

  function changePreset(value: DateRangePreset) {
    setPreset(value);
    if (value === "custom") return;
    const range = resolveDateRange(value, from, to);
    setFrom(range.from);
    setTo(range.to);
  }

  return (
    <div className="date-range-filter">
      <select
        name="period"
        value={preset}
        onChange={(event) => changePreset(event.target.value as DateRangePreset)}
        aria-label="Período"
      >
        {(Object.entries(dateRangePresetLabels) as [DateRangePreset, string][]).map(([value, label]) => (
          <option key={value} value={value}>{label}</option>
        ))}
      </select>

      <input type="hidden" name="from" value={from} />
      <input type="hidden" name="to" value={to} />

      {preset === "custom" ? (
        <>
          <input
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            aria-label="Data inicial"
          />
          <input
            type="date"
            value={to}
            onChange={(event) => setTo(event.target.value)}
            aria-label="Data final"
          />
        </>
      ) : null}
    </div>
  );
}
