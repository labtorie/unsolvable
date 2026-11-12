// Классы домохозяйств (GDD 3.1), богатство, удовлетворённость (GDD 7).
import { NEEDS, CLASSES } from '../schema.js';
import { num, clamp01, median, pol } from './util.js';

const BASIC = NEEDS.filter((n) => n.basic).map((n) => n.id);
const NONBASIC = NEEDS.filter((n) => !n.basic).map((n) => n.id);
const LOWER = new Set(['destitute', 'workers', 'precariat']);
const UPPER = new Set(['specialists', 'capitalists', 'smallowners']);
const SPECIALIST_PROF = new Set(['care', 'engineer', 'manager', 'creative']);

// Порог номенклатуры: госсектор больше этой доли выпуска, чиновник с навыком выше порога.
export const NOMENKLATURA_STATE_SHARE = 0.4;
export const NOMENKLATURA_SKILL = 0.7;

/** Оценка фирмы: капитал + деньги − долг, не ниже нуля. */
function firmValue(f) {
  if (!f || f.alive === false) return 0;
  return Math.max(0, num(f.capital) + num(f.cash) - num(f.debt));
}

function meanNeeds(needsMet, ids) {
  let s = 0, c = 0;
  for (const id of ids) {
    const v = needsMet?.[id];
    if (typeof v === 'number' && Number.isFinite(v)) { s += v; c++; }
  }
  return c ? s / c : null;
}

/** Считает hh.classId, возвращает вспомогательные массивы для статистики. */
export function classify(world, stateShare) {
  const hhs = world.households || [];
  const n = hhs.length;
  const basket = num(world.stats?.basicBasketCost);

  const values = new Map();
  for (const f of world.firms || []) values.set(f.id, firmValue(f));

  const wealth = new Float64Array(n);
  const net = new Float64Array(n);
  const buckets = {};
  for (let i = 0; i < n; i++) {
    const h = hhs[i];
    let w = num(h.cash);
    if (h.shares) for (const k in h.shares) w += num(h.shares[k]) * (values.get(+k) ?? values.get(k) ?? 0);
    wealth[i] = w;
    net[i] = num(h.netIncome);
    if (h.status === 'employed' || h.status === 'self') (buckets[h.profession] ||= []).push(net[i]);
  }
  const medNet = median(Array.from(net));
  const medProf = {};
  for (const k in buckets) medProf[k] = median(buckets[k]);

  for (let i = 0; i < n; i++) {
    const h = hhs[i];
    const income = num(h.income);
    const capInc = num(h.incomeBySource?.capital);
    const buffer = basket > 0 && wealth[i] >= 24 * basket;
    const capDominant = income > 0 && capInc / income >= 0.5;
    const basicMet = meanNeeds(h.needsMet, BASIC);
    let shareSum = 0;
    if (h.shares) for (const k in h.shares) shareSum += num(h.shares[k]);

    let cls;
    if (buffer && capDominant) cls = 'capitalists';
    else if (!buffer && (h.status === 'unemployed' && h.age < 65
      || (basket > 0 && net[i] < basket && h.status !== 'retired')
      || (basicMet !== null && basicMet < 0.5))) cls = 'destitute';
    else if (h.status === 'retired') cls = 'retired';
    else if (h.status === 'unemployed') cls = buffer ? 'retired' : 'destitute';
    else if (capDominant) cls = 'capitalists';
    else if (h.profession === 'official' && h.status === 'employed'
      && num(h.skill) >= NOMENKLATURA_SKILL && stateShare >= NOMENKLATURA_STATE_SHARE) cls = 'nomenklatura';
    else if (h.status === 'self') cls = shareSum < 0.05 && net[i] < medNet ? 'precariat' : 'smallowners';
    else if (shareSum >= 0.1) cls = 'smallowners';
    else if (h.profession === 'official' || SPECIALIST_PROF.has(h.profession)) cls = 'specialists';
    else cls = 'workers';
    h.classId = cls;
  }
  return { wealth, net, medNet, medProf };
}

// ── Удовлетворённость ──
// Компоненты 0..1: basic, nonbasic, rel, emp, safety, health, freedom, prop, capTax.
const W = {
  destitute:    [4, 1, 1, 2, 1.5, 1.5, 0.5, 0, 0],
  workers:      [3, 1.2, 1.5, 2.5, 1, 1, 1, 0, 0],
  precariat:    [3, 1, 1.5, 2, 1, 1, 1, 0, 0],
  specialists:  [1.5, 1.5, 1.5, 1.5, 1, 1, 2, 0.5, 0.3],
  smallowners:  [1.5, 1.5, 1.5, 1, 1.5, 0.8, 1, 2, 1],
  capitalists:  [0.5, 1.5, 1, 0.3, 1.5, 0.5, 1, 3, 3],
  retired:      [3, 1, 1, 0.5, 1.5, 2.5, 1, 0.5, 0],
  nomenklatura: [1, 2, 1.5, 1, 1, 1, 0.3, 1, 0.5],
};
// Веса свобод: [пресса, отсутствие репрессий, право на забастовку, свободный выезд, суды]
const FW = {
  workers: [1, 1, 2, 0.5, 0.5], precariat: [1, 1, 1.5, 0.5, 0.5],
  specialists: [1.5, 1, 0.3, 2, 0.5], capitalists: [0.7, 0.7, 0.1, 1, 1.5],
  smallowners: [1, 1, 0.3, 0.5, 1.5], nomenklatura: [0.2, 0.2, 0, 0.3, 0.3],
};
const FW_DEF = [1, 1, 0.3, 0.5, 0.5];

export function computeSatisfaction(world, ctx) {
  const hhs = world.households || [];
  const n = hhs.length;
  const basket = num(world.stats?.basicBasketCost);
  const crime = clamp01(world.gov?.crime);
  const press = clamp01(pol(world, 'pressFreedom', 0.7));
  const repr = clamp01(pol(world, 'repression', 0.1));
  const strike = pol(world, 'strikeRight', true) ? 1 : 0;
  const emig = pol(world, 'emigrationAllowed', true) ? 1 : 0;
  const courts = clamp01(pol(world, 'courtsIndependence', 0.6));
  const prop = clamp01(pol(world, 'propertyRights', 0.7));
  const capTax = 1 - clamp01(0.35 * pol(world, 'corpTax', 0) / 0.5 + 0.25 * pol(world, 'dividendTax', 0) / 0.5
    + 0.2 * pol(world, 'wealthTax', 0) / 0.03 + 0.2 * pol(world, 'inheritanceTax', 0) / 0.5);
  const freeParts = [press, 1 - repr, strike, emig, courts];

  let total = 0;
  for (let i = 0; i < n; i++) {
    const h = hhs[i];
    const cls = h.classId;
    const w = W[cls] || W.workers;
    const netI = ctx.net[i];
    const basic = meanNeeds(h.needsMet, BASIC) ?? (basket > 0 ? clamp01(netI / basket) : 0.5);
    const nonbasic = meanNeeds(h.needsMet, NONBASIC) ?? (basket > 0 ? clamp01(netI / (2 * basket)) : 0.5);
    const mp = ctx.medProf[h.profession];
    let rel = 0.5;
    if (ctx.medNet > 0) {
      const a = clamp01(netI / (2 * ctx.medNet));
      rel = mp > 0 ? 0.5 * a + 0.5 * clamp01(netI / (2 * mp)) : a;
    }
    const emp = h.status === 'unemployed' ? 0 : h.status === 'retired' ? 0.8 : 1;
    const fw = FW[cls] || FW_DEF;
    let fs = 0, fsw = 0;
    for (let k = 0; k < 5; k++) { fs += fw[k] * freeParts[k]; fsw += fw[k]; }
    const freedom = fsw > 0 ? fs / fsw : 0.5;
    const comp = [basic, nonbasic, rel, emp, 1 - crime, clamp01(h.health), freedom, prop, capTax];
    let s = 0, sw = 0;
    for (let k = 0; k < 9; k++) { s += w[k] * comp[k]; sw += w[k]; }
    h.satisfaction = clamp01(s / sw);
    total += h.satisfaction;
  }
  return n ? total / n : 0;
}

/** Агрегаты по классам для stats.classes и мобильность. */
export function classStats(world, ctx) {
  const hhs = world.households || [];
  const n = hhs.length;
  const acc = {};
  for (const c of CLASSES) {
    acc[c.id] = { id: c.id, label: c.label, count: 0, share: 0, avgIncome: 0, avgNetIncome: 0, avgWealth: 0,
      needsMet: Object.fromEntries(NEEDS.map((x) => [x.id, 0])), health: 0, satisfaction: 0 };
  }
  let lowerParents = 0, climbed = 0;
  for (let i = 0; i < n; i++) {
    const h = hhs[i];
    const a = acc[h.classId] || acc.workers;
    a.count++;
    a.avgIncome += num(h.income);
    a.avgNetIncome += ctx.net[i];
    a.avgWealth += ctx.wealth[i];
    a.health += num(h.health);
    a.satisfaction += num(h.satisfaction);
    for (const nd of NEEDS) a.needsMet[nd.id] += num(h.needsMet?.[nd.id]);
    if (h.parentClassId && LOWER.has(h.parentClassId)) {
      lowerParents++;
      if (UPPER.has(h.classId)) climbed++;
    }
  }
  const out = [];
  for (const c of CLASSES) {
    const a = acc[c.id];
    const k = a.count;
    if (k > 0) {
      a.avgIncome /= k; a.avgNetIncome /= k; a.avgWealth /= k; a.health /= k; a.satisfaction /= k;
      for (const id in a.needsMet) a.needsMet[id] /= k;
    }
    a.share = n ? k / n : 0;
    out.push(a);
  }
  return { classes: out, mobility: lowerParents ? climbed / lowerParents : 0 };
}
