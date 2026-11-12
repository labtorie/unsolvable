// Общие расчёты фирм: производительность, мощности, потребность в труде, себестоимость.
import { INDUSTRIES, PROFESSIONS } from '../schema.js';
import { IND, GOODS, P } from './params.js';
import { clamp } from './util.js';

export const PROF_IDS = PROFESSIONS.map(p => p.id);

export function baseMarkup(ind) {
  return 0.05 + 0.01 * ind.capitalPerUnit + 0.04 * ind.scale;
}

/** Общий множитель среды: инфраструктура, тень, здоровье, коррупция, преступность, грязь. */
export function envCommon(world, ctx) {
  const g = world.gov;
  const A = world.assumptions;
  const hours = Math.pow((world.policies.workWeek || 40) / 40, 0.6);
  const v = hours * Math.pow(clamp(g.infrastructure, 0.3, 2), 0.3)
    * (1 - 0.1 * g.shadowShare * A.evasionSensitivity)
    * (0.85 + 0.15 * ctx.avgHealth)
    * (1 - 0.08 * g.corruption)
    * (1 - 0.28 * Math.max(0, g.crime - 0.1) * A.crimeDamage)
    * (1 - 0.12 * A.lawlessCost * (1 - 0.5 * world.policies.courtsIndependence - 0.5 * world.policies.propertyRights - 0.35)) // контракты и охрана собственности
    * (1 - 0.05 * ctx.pollIdx);
  return v / (world.calib.envRef || 1);
}

/** Среда по отраслям на этот месяц. */
export function computeEnv(world, ctx) {
  const common = envCommon(world, ctx);
  const env = {};
  for (const ind of INDUSTRIES) env[ind.id] = common;
  env.agri *= Math.pow(clamp(world.resources.land / (world.calib.land0 || 1), 0.2, 3), 0.4);
  const r0 = world.resources.reservesInit || 1;
  const depl = clamp(1 - world.resources.reserves / r0, 0, 1);
  ctx.depletion = depl;
  env.mining *= 1 / (1 + 0.8 * depl * depl);
  if (world.resources.reserves <= 0) env.mining *= 0.05;
  ctx.env = env;
}

export function ownerMult(f, world) {
  const A = world.assumptions;
  if (f.owner === 'state') return Math.max(0.6, 1 - 0.1 * A.stateInefficiency);
  if (f.owner === 'coop') return 0.96;
  // переросшие фирмы теряют управляемость, особенно там, где эффект масштаба слаб
  const sh = f.marketShare || 0;
  if (sh > 0.35) return 1 - 0.3 * ((sh - 0.35) / 0.65) * (1 - 0.6 * IND[f.industry].scale);
  return 1;
}

export function scaleMult(f, world) {
  const ind = IND[f.industry];
  if (!ind.scale) return 1;
  const ratio = clamp(f.capital / ind.capitalPerUnit / (f.sizeRef || 1), 0.25, 40);
  return clamp(Math.pow(ratio, 0.15 * ind.scale * world.assumptions.scaleEffects), 0.8, 1.7);
}

/** Множитель производительности фирмы (и труда, и капитала). */
export function eff(f, world, ctx) {
  return f.productivity * ctx.env[f.industry] * scaleMult(f, world) * ownerMult(f, world);
}

export function capacity(f, world, ctx) {
  const ind = IND[f.industry];
  return (f.capital / ind.capitalPerUnit) * eff(f, world, ctx);
}

/** Сколько работников нужно на выпуск q: { prof: дробное число }. */
export function laborNeed(f, q, e) {
  const ind = IND[f.industry];
  const out = {};
  for (const p in ind.labor) out[p] = (q * ind.labor[p]) / 100 / e;
  return out;
}

/** Целое число работников под дробную потребность. Малые доли не нанимаются. */
export function headcount(need) {
  return need < 0.4 ? 0 : Math.max(1, Math.ceil(need - 0.25));
}

export function capexPrice(ctx) { return ctx.capUnit; }

/** Прогноз себестоимости единицы (на текущих зарплатах и ценах сырья). */
export function unitCostEst(f, world, ctx) {
  const ind = IND[f.industry];
  const e = eff(f, world, ctx);
  const pol = world.policies;
  let c = 0;
  const wf = ctx.floor;
  const q0 = Math.max(f.demandEMA * 1.05, f.output * 0.5, 5);
  for (const p in ind.labor) {
    let w = f.wageOffer[p] || (ctx.labWage[p] || 100);
    if (w < wf) w = wf;
    const cont = (ind.labor[p] / 100 / e) * w * (1 + pol.payrollTax * ctx.cmp);
    const n = headcount((q0 * ind.labor[p]) / 100 / e);
    // целые работники: у малых фирм реальные издержки выше «непрерывных»
    c += 0.5 * cont + 0.5 * (n * w * (1 + pol.payrollTax * ctx.cmp)) / q0;
  }
  for (const k in ind.inputs) c += ind.inputs[k] * (ctx.price[k] || world.basePrice[k] || 1);
  c += (P.delta * ctx.capUnit * ind.capitalPerUnit) / e;
  // налоговые и прочие удельные издержки
  const carbon = pol.carbonTax * (ind.pollution || 0) * 0.15 * (ctx.price[f.industry] || 1);
  c += carbon;
  const q = Math.max(f.output, 5);
  c += (f.debt * ctx.rateM) / q;
  return c * (1 + 0.2 * Math.max(0, world.gov.crime - 0.1) * world.assumptions.crimeDamage); // охрана и страхование от краж
}

export function indexFirms(world, ctx) {
  const F = ctx.F;
  F.length = 0;
  const by = {};
  for (const g of GOODS) by[g] = [];
  for (const f of world.firms) {
    F[f.id] = f;
    if (f.alive) by[f.industry].push(f);
  }
  ctx.by = by;
}
