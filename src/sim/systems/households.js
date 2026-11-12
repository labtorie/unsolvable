// Домохозяйства: итоги месяца, налог на богатство, вложения в акции, здоровье.
import { pay } from '../ledger.js';
import { rand, randInt } from '../rng.js';
import { IND, P } from './params.js';
import { clamp, median, safePay } from './util.js';

export function firmEquity(f, ctx) {
  return Math.max(0, f.capital * ctx.capUnit * 0.7 + f.cash - f.debt);
}

export function wealthOf(h, ctx) {
  let w = h.cash + h.bonds;
  for (const id in h.shares) {
    const f = ctx.F[id];
    if (f && f.alive) w += h.shares[id] * firmEquity(f, ctx);
  }
  return w;
}

export function householdFinance(world, ctx) {
  const A_ = world.assumptions;
  const pol = world.policies;
  const hh = world.households;
  const N = hh.length;
  const gov = world.gov;
  const cmp = ctx.cmp;
  // итоги дохода
  for (let i = 0; i < N; i++) {
    const h = hh[i];
    const s = h.incomeBySource;
    h.income = s.wage + s.capital + s.transfer + s.business;
    h.netIncome = Math.max(0, h.income - ctx.tax[i]);
  }
  // самозанятые: если дело не кормит полгода, закрывают его и идут в наём
  for (let i = 0; i < N; i++) {
    const h = hh[i];
    if (h.status !== 'self') continue;
    const s = h.incomeBySource;
    if (s.business + s.capital < 0.04 * ctx.medWage) h.jobSearch++; else h.jobSearch = 0;
    if (h.jobSearch >= 12) { h.status = 'unemployed'; h.employerId = null; h.jobSearch = 0; }
  }
  // новые самозанятые: накопившие денег входят в долю малого бизнеса и бросают найм, пока доля самозанятых ниже цели
  {
    let selfN = 0;
    for (let i = 0; i < N; i++) if (hh[i].status === 'self') selfN++;
    const target = 0.07 * N;
    const smallFirms = [];
    for (const f of world.firms) if (f.alive && f.owner === 'private' && (f.industry === 'agri' || f.industry === 'services' || f.industry === 'construction' || f.industry === 'vice')) smallFirms.push(f);
    if (selfN < target && smallFirms.length) {
      const tries = Math.ceil((target - selfN) * 0.15);
      for (let k = 0; k < tries; k++) {
        const h = hh[randInt(world, N)];
        if ((h.status !== 'employed' && h.status !== 'unemployed') || h.employerId === 0) continue;
        if (h.cash < 4 * ctx.medWage) continue;
        const f = smallFirms[randInt(world, smallFirms.length)];
        const amt = Math.min(0.6 * h.cash, 8 * ctx.medWage);
        const phi = amt / (firmEquity(f, ctx) + amt);
        for (const id in f.holders) { const o = hh[id - 1]; if (o && o.shares[f.id]) o.shares[f.id] *= 1 - phi; }
        pay(world, h, f, amt, 'investment');
        h.shares[f.id] = (h.shares[f.id] || 0) + phi; f.holders[h.id] = true;
        h.status = 'self'; h.employerId = f.id; h.wage = 0; h.retrain = null; h.jobSearch = 0;
      }
    }
  }
  // богатство
  const wealth = new Float64Array(N);
  for (let i = 0; i < N; i++) wealth[i] = wealthOf(hh[i], ctx);
  const medW = median(Array.from(wealth));
  ctx.medWealth = medW;
  world.calib.carry.medWealth = medW;
  if (pol.wealthTax > 0) {
    const thr = 10 * medW;
    for (let i = 0; i < N; i++) {
      if (wealth[i] > thr) safePay(world, hh[i], gov, (pol.wealthTax / 12) * (wealth[i] - thr) * cmp, 'tax_wealth');
    }
  }
  // вложения богатых в акции
  const firms = ctx.by;
  const pool = [];
  for (const f of world.firms) if (f.alive && f.owner === 'private' && f.util > 0.8) pool.push(f);
  if (pool.length) {
    for (let i = 0; i < N; i++) {
      const h = hh[i];
      const thr = 12 * Math.max(h.netIncome, ctx.medWage);
      if (h.cash <= thr) continue;
      const amt = 0.08 * (h.cash - thr) * Math.min(1.5, Math.pow(ctx.effPR / 0.63, A_.lawlessCost));
      let best = null;
      for (let k = 0; k < 4; k++) {
        const f = pool[randInt(world, pool.length)];
        if (!best || f.profitMargin > best.profitMargin) best = f;
      }
      const val = Math.max(amt, firmEquity(best, ctx));
      const phi = amt / (val + amt);
      for (const id in best.holders) { const o = hh[id - 1]; if (o && o.shares[best.id]) o.shares[best.id] *= 1 - phi; }
      pay(world, h, best, amt, 'investment');
      h.shares[best.id] = (h.shares[best.id] || 0) + phi;
      best.holders[h.id] = true;
    }
  }
  // здоровье
  const pollIdx = ctx.pollIdx;
  for (let i = 0; i < N; i++) {
    const h = hh[i];
    const nm = h.needsMet;
    const t = 0.3 + 0.3 * (nm.food ?? 0.5) + 0.15 * (nm.health ?? 0.5) + 0.12 * (ctx.carry.qHealth || 0) + 0.1 * (nm.housing ?? 0.5) + 0.05 * (nm.energy ?? 0.5)
      - 0.25 * pollIdx - Math.max(0, h.age - 55) * 0.006 - 0.004 * (world.policies.workWeek - 40) * (h.status === 'employed' ? 1 : 0);
    h.health = clamp(h.health + 0.04 * (clamp(t, 0.1, 1) - h.health), 0.05, 1);
  }
}
