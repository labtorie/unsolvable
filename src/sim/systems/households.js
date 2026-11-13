// Домохозяйства: итоги месяца, налог на богатство, вложения в акции, здоровье.
import { pay } from '../ledger.js';
import { rand, randInt } from '../rng.js';
import { IND, P } from './params.js';
import { clamp, median, safePay } from './util.js';
import { priceOf, issueShares } from './ownership.js';
import { marginBorrow } from './finance.js';

export function firmEquity(f, ctx) {
  return Math.max(0, f.capital * ctx.capUnit * 0.7 + f.cash - f.debt);
}

/** Состояние: деньги, облигации и доли по рыночной цене (f.value) за вычетом долга под залог акций. */
export function wealthOf(h, ctx) {
  let w = h.cash + h.bonds - (h.marginDebt || 0);
  for (const id in h.shares) {
    const f = ctx.F[id];
    if (f && f.alive) w += h.shares[id] * priceOf(f, ctx);
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
        // взнос в капитал малого бизнеса: новый выпуск акций, разбавляются все прежние владельцы (в том числе фирмы и фонд)
        const { amt: paid } = issueShares(world, ctx, f, 'h', h, amt, 'investment');
        if (!(paid > 0)) continue;
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
  // вложения богатых в акции по рыночной цене; под залог акций банк даёт кредит (marginLimit)
  const fin = world.finance;
  const pool = [];
  for (const f of world.firms) if (f.alive && f.owner === 'private' && !f.parent) pool.push(f);
  if (pool.length) {
    const herd = A_.herding;
    const sent = fin.sentiment;
    const gm = fin.growthMed || 0;
    for (let i = 0; i < N; i++) {
      const h = hh[i];
      const thr = 12 * Math.max(h.netIncome, ctx.medWage);
      let amt = 0;
      if (h.cash > thr) amt = 0.08 * (h.cash - thr) * clamp(1 - 20 * (pol.financialTransactionTax || 0), 0.3, 1) * Math.min(1.5, Math.pow(ctx.effPR / 0.63, A_.lawlessCost)) * (1 + 0.5 * Math.max(0, herd * sent - 0.4));
      const wantMargin = pol.marginLimit > 0 && h.status !== 'retired' && sent > 0 && wealth[i] > 3 * medW;
      if (!(amt > 1e-6) && !wantMargin) continue;
      let best = null, bs = -Infinity;
      // в спокойном рынке выбирают загруженные прибыльные фирмы; в эйфории (herd × настроение) гонятся за ростом и забывают про оценку
      const chase = clamp((herd * sent - 0.2) / 0.6, 0, 1);
      for (let k = 0; k < 4; k++) {
        const f = pool[randInt(world, pool.length)];
        if (!(f.util > 0.8 || (chase > 0 && f.growth > gm))) continue;
        const fund = Math.max(1, f.fundamental);
        const sc = clamp(f.profitMargin, -0.2, 0.3) + chase * 0.6 * clamp((f.growth || 0) - gm, -0.3, 0.6) + (f.util > 0.8 ? 0.03 : 0)
          - 0.15 * (1 - chase) * Math.max(0, f.value / fund - 1.5);
        if (sc > bs) { bs = sc; best = f; }
      }
      if (!best) continue;
      // кредит под залог: охотнее берут в эйфории, не берут в панике
      if (wantMargin) amt += marginBorrow(world, ctx, h, 0.25);
      if (amt > 1e-6) issueShares(world, ctx, best, 'h', h, amt, 'equity_purchases');
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
