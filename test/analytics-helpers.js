// Сборка синтетических миров для тестов аналитики.
import { createWorld, makeHousehold, makeFirm, INDUSTRIES } from '../src/sim/schema.js';

export function hh(id, o = {}) {
  const h = makeHousehold(id);
  Object.assign(h, o);
  h.incomeBySource = { wage: 0, capital: 0, transfer: 0, business: 0, ...(o.incomeBySource || {}) };
  return h;
}

/**
 * Мир под конкретный строй. spec: { policies, industry: {id: {...}}, owners: {industryId: owner}, gov, stats,
 * spendingFrac, revenueFrac, transferFrac, hhi, top1 }.
 */
export function buildWorld(spec = {}) {
  const w = createWorld();
  Object.assign(w.policies, spec.policies || {});
  for (const id in spec.industry || {}) Object.assign(w.policies.industry[id], spec.industry[id]);
  const gdp = spec.gdp ?? 1000;
  Object.assign(w.stats, { gdp, basicBasketCost: 10, ...(spec.stats || {}) });
  Object.assign(w.gov, spec.gov || {});
  w.gov.spending = (spec.spendingFrac ?? 0) * gdp;
  w.gov.revenue = (spec.revenueFrac ?? 0) * gdp;
  w.gov.spendingByKind = { transfers_pension: (spec.transferFrac ?? 0) * gdp };
  w.gov.revenueByKind = { tax_rent: (spec.rentFrac ?? 0) * w.gov.revenue };
  let id = 1;
  for (const ind of INDUSTRIES) {
    const f = makeFirm(id++, ind.id);
    f.owner = spec.owners?.[ind.id] ?? 'private';
    f.output = 100; f.price = 1; f.revenue = 100; f.marketShare = spec.hhi !== undefined ? Math.sqrt(spec.hhi) : 0.3;
    f.capital = 50;
    w.firms.push(f);
  }
  // население: 100 домохозяйств, у одного 1% — доля богатства top1 (через cash)
  const top1 = spec.top1 ?? 0.05;
  for (let i = 1; i <= 100; i++) {
    const h = hh(i, { status: 'employed', profession: 'manual', netIncome: 20, income: 25, wage: 25, cash: i === 1 ? 0 : 100 });
    w.households.push(h);
  }
  const rest = 99 * 100;
  w.households[0].cash = top1 >= 1 ? 0 : rest * top1 / (1 - top1);
  w.markets = {};
  for (const ind of INDUSTRIES) w.markets[ind.id] = { price: 1, sold: 100, hhi: spec.hhi ?? 0.1, exports: 0 };
  return w;
}
