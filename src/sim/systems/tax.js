// Налоговые формулы.

/** Подоходный налог на месячный доход w (может быть отрицательным — доплата). med — медианная месячная зарплата. */
export function incomeTax(brackets, med, w) {
  let tax = 0;
  const n = brackets.length;
  for (let i = 0; i < n; i++) {
    const from = brackets[i].from * med;
    const to = i + 1 < n ? brackets[i + 1].from * med : Infinity;
    if (w > from) tax += brackets[i].rate * (Math.min(w, to) - from);
    else break;
  }
  return tax;
}

/** Средняя предельная ставка (для оценки налогового бремени). */
export function avgMarginal(brackets) {
  if (!brackets.length) return 0;
  // вес ступени: ориентировочно доля населения на ней
  const wts = [0.45, 0.4, 0.12, 0.03];
  let s = 0, wsum = 0;
  brackets.forEach((b, i) => { const w = wts[Math.min(i, 3)]; s += Math.max(0, b.rate) * w; wsum += w; });
  return s / wsum;
}

export function corpRate(pol, share, small) {
  let r = pol.corpTax;
  if (share > 0.25) r += pol.corpTaxLargeSurcharge;
  if (share < 0.05 && small) r *= 0.75;
  return r;
}
