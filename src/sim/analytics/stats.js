// Агрегаты world.stats, заполняемые аналитикой.
import { num, gini, topShare, clamp01 } from './util.js';

/** Доля стоимости выпуска живых фирм owner 'state'|'coop'. Взвешено ценой: единицы разных товаров несопоставимы. */
export function stateShareOfOutput(world) {
  let all = 0, st = 0;
  for (const f of world.firms || []) {
    if (!f || f.alive === false) continue;
    const out = Math.max(0, num(f.output));
    const v = out * (num(f.price) > 0 ? f.price : 1);
    all += v;
    if (f.owner === 'state' || f.owner === 'coop') st += v;
  }
  return all > 0 ? st / all : 0;
}

/** Средний HHI по отраслям, взвешенный объёмом продаж. Берёт world.markets, иначе считает из firms.marketShare. */
export function averageHhi(world) {
  let sw = 0, s = 0, cnt = 0, plain = 0;
  const markets = world.markets || {};
  for (const g in markets) {
    const m = markets[g];
    if (!m || !Number.isFinite(m.hhi)) continue;
    const w = Math.max(0, num(m.sold)) * (num(m.price) > 0 ? m.price : 1);
    s += m.hhi * w; sw += w; plain += m.hhi; cnt++;
  }
  if (cnt) return clamp01(sw > 0 ? s / sw : plain / cnt);

  const byInd = {};
  for (const f of world.firms || []) {
    if (!f || f.alive === false) continue;
    const o = (byInd[f.industry] ||= { hhi: 0, rev: 0 });
    o.hhi += num(f.marketShare) ** 2;
    o.rev += Math.max(0, num(f.revenue));
  }
  s = 0; sw = 0; plain = 0; cnt = 0;
  for (const k in byInd) {
    const o = byInd[k];
    s += o.hhi * o.rev; sw += o.rev; plain += o.hhi; cnt++;
  }
  return cnt ? clamp01(sw > 0 ? s / sw : plain / cnt) : 0;
}

export function inequalityStats(world, ctx) {
  const n = world.households?.length || 0;
  const net = Array.from(ctx.net);
  const wealth = Array.from(ctx.wealth);
  const basket = num(world.stats?.basicBasketCost);
  const line = basket > 0 ? basket : 0.5 * ctx.medNet;
  let poor = 0;
  if (line > 0) for (let i = 0; i < n; i++) if (ctx.net[i] < line) poor++;
  let gross = 0;
  const grossArr = new Array(n);
  for (let i = 0; i < n; i++) grossArr[i] = num(world.households[i].income);
  return {
    giniIncome: gini(net),
    giniGross: gini(grossArr),
    giniWealth: gini(wealth),
    top1WealthShare: topShare(wealth, 0.01),
    top10IncomeShare: topShare(net, 0.1),
    povertyRate: n ? poor / n : 0,
  };
}
