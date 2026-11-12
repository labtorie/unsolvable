// Безопасные числовые помощники аналитики: никаких NaN и исключений на пустых данных.
export function num(x, d = 0) { return typeof x === 'number' && Number.isFinite(x) ? x : d; }
export function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }
export function clamp01(x) { return clamp(num(x), 0, 1); }
export function div(a, b, d = 0) { b = num(b); return b === 0 ? d : num(a) / b; }

/** Политика по id с запасным значением. */
export function pol(world, id, d = 0) {
  const v = world?.policies?.[id];
  return v === undefined || v === null ? d : v;
}
export function ipol(world, industry, id, d) {
  const v = world?.policies?.industry?.[industry]?.[id];
  return v === undefined || v === null ? d : v;
}

/** Джини по массиву неотрицательных значений (отрицательные считаются нулём). */
export function gini(values) {
  const n = values.length;
  if (n < 2) return 0;
  const a = new Float64Array(n);
  for (let i = 0; i < n; i++) a[i] = Math.max(0, num(values[i]));
  a.sort();
  let sum = 0, w = 0;
  for (let i = 0; i < n; i++) { sum += a[i]; w += (i + 1) * a[i]; }
  if (sum <= 0) return 0;
  return clamp01((2 * w) / (n * sum) - (n + 1) / n);
}

/** Доля верхней доли выборки (frac, не менее одного элемента) в сумме. */
export function topShare(values, frac) {
  const n = values.length;
  if (n === 0) return 0;
  const a = new Float64Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) { a[i] = Math.max(0, num(values[i])); sum += a[i]; }
  if (sum <= 0) return 0;
  a.sort();
  const k = Math.max(1, Math.ceil(n * frac - 1e-9));
  let top = 0;
  for (let i = n - k; i < n; i++) top += a[i];
  return clamp01(top / sum);
}

export function median(values) {
  const n = values.length;
  if (!n) return 0;
  const a = Float64Array.from(values, (v) => num(v));
  a.sort();
  return n % 2 ? a[(n - 1) >> 1] : (a[n / 2 - 1] + a[n / 2]) / 2;
}
