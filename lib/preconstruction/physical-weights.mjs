// Integer hundredths keep suggestions compatible with the editor's 0.01 step.
export function normalizedPercentages(values) {
  if (!values.length) return [];
  const safe = values.map(value => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0);
  const total = safe.reduce((sum, value) => sum + value, 0);
  const raw = safe.map(value => total > 0 ? value / total * 10000 : 10000 / safe.length);
  const cents = raw.map(Math.floor);
  const ranked = raw.map((value, index) => ({index, remainder: value - cents[index]})).sort((a,b) => b.remainder - a.remainder || a.index - b.index);
  const missing = 10000 - cents.reduce((sum,value) => sum + value, 0);
  for (let i=0; i<missing; i++) cents[ranked[i % ranked.length].index]++;
  return cents.map(value => value / 100);
}
