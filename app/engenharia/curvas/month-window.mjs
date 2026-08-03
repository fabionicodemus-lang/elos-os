export const MAX_CURVE_MONTHS = 240;

function monthIndex(value) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(value ?? ""));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(year) || year < 1 || year > 9999 || month < 1 || month > 12) return null;
  return year * 12 + month - 1;
}

function monthKey(index) {
  const year = Math.floor(index / 12);
  const month = index % 12 + 1;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

export function buildSafeMonthWindow(keys, asOfKey, maxMonths = MAX_CURVE_MONTHS) {
  const limit = Math.max(1, Math.min(MAX_CURVE_MONTHS, Math.trunc(Number(maxMonths) || MAX_CURVE_MONTHS)));
  const indexes = [...new Set((keys ?? []).map(monthIndex).filter((value) => value !== null))].sort((a, b) => a - b);
  if (!indexes.length) return { keys: [], truncated: false, sourceSpanMonths: 0 };

  const minimum = indexes[0];
  const maximum = indexes[indexes.length - 1];
  const sourceSpanMonths = maximum - minimum + 1;
  let start = minimum;
  let finish = maximum;

  if (sourceSpanMonths > limit) {
    const asOf = monthIndex(asOfKey);
    if (asOf !== null && asOf >= minimum && asOf <= maximum) {
      const monthsBeforeCurrent = Math.min(24, limit - 1);
      start = Math.max(minimum, Math.min(asOf - monthsBeforeCurrent, maximum - limit + 1));
    } else if (asOf !== null && asOf < minimum) {
      start = minimum;
    } else {
      start = maximum - limit + 1;
    }
    finish = start + limit - 1;
  }

  const result = [];
  for (let index = start; index <= finish; index += 1) result.push(monthKey(index));
  return { keys: result, truncated: sourceSpanMonths > limit, sourceSpanMonths };
}
