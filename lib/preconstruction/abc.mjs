export function classifyAbc(rows, { classALimit = 80, classBLimit = 95 } = {}) {
  const normalized = rows
    .map((row) => ({ ...row, value: Math.max(0, Number(row.value ?? 0)) }))
    .sort((a, b) => b.value - a.value);
  const total = normalized.reduce((sum, row) => sum + row.value, 0);
  let accumulated = 0;
  return normalized.map((row, index) => {
    const percentage = total > 0 ? row.value / total * 100 : 0;
    accumulated += percentage;
    const classification = accumulated <= classALimit || index === 0
      ? "A"
      : accumulated <= classBLimit ? "B" : "C";
    return {
      ...row,
      rank: index + 1,
      percentage,
      accumulatedPercentage: Math.min(100, accumulated),
      classification,
    };
  });
}

export function abcSummary(rows) {
  const result = { A: { count: 0, value: 0 }, B: { count: 0, value: 0 }, C: { count: 0, value: 0 } };
  for (const row of rows) {
    const key = row.classification;
    if (!result[key]) continue;
    result[key].count += 1;
    result[key].value += Number(row.value ?? 0);
  }
  return result;
}