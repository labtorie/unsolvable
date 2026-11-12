import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, makeFirm, CLASSES, NEEDS } from '../src/sim/schema.js';
import { analyze } from '../src/sim/analytics/index.js';
import { gini, topShare } from '../src/sim/analytics/util.js';
import { buildWorld, hh } from './analytics-helpers.js';
import { SCEN } from './analytics-scenarios.js';

function noNaN(obj, path = '') {
  if (typeof obj === 'number') assert.ok(Number.isFinite(obj), `NaN/Infinity at ${path}`);
  else if (obj && typeof obj === 'object') for (const k in obj) noNaN(obj[k], `${path}.${k}`);
}

test('Джини: равное распределение = 0, один владеет всем ~ 1', () => {
  assert.equal(gini([5, 5, 5, 5]), 0);
  assert.equal(gini([]), 0);
  assert.equal(gini([0, 0, 0]), 0);
  const one = new Array(100).fill(0); one[37] = 1000;
  assert.ok(gini(one) > 0.98 && gini(one) <= 1);
  assert.ok(Math.abs(gini([1, 2, 3, 4]) - 0.25) < 1e-9);
  assert.equal(topShare(one, 0.01), 1);
});

test('пустой мир: без исключений и NaN', () => {
  const w = createWorld();
  assert.doesNotThrow(() => analyze(w));
  noNaN(w.stats, 'stats'); noNaN(w.regime, 'regime');
  assert.equal(w.stats.classes.length, CLASSES.length);
  assert.ok(w.regime.label.length > 0);
  assert.equal(w.stats.mobility, 0);
});

test('мир с мусорными полями не даёт NaN', () => {
  const w = createWorld();
  w.households.push(hh(1, { income: undefined, netIncome: NaN, cash: undefined, shares: { 99: 0.5 }, needsMet: { food: NaN } }));
  w.firms.push(makeFirm(1, 'agri'));
  w.firms[0].output = NaN; w.markets = { agri: { hhi: NaN } };
  w.gov.crime = undefined; w.policies.incomeTaxBrackets = null;
  assert.doesNotThrow(() => analyze(w));
  noNaN(w.stats, 'stats'); noNaN(w.regime, 'regime');
  assert.ok(Number.isFinite(w.households[0].satisfaction));
});

test('классы на собранных вручную домохозяйствах', () => {
  const w = createWorld();
  w.stats.basicBasketCost = 10;
  const firm = makeFirm(1, 'tech'); firm.capital = 1000; firm.cash = 200; firm.debt = 200; w.firms.push(firm);
  const poorNeeds = { food: 0.2, housing: 0.2, energy: 0.5, health: 0.2, security: 1 };
  const mk = (id, o) => { const h = hh(id, o); w.households.push(h); return h; };
  const hs = {
    unemployed: mk(1, { status: 'unemployed', netIncome: 3, income: 3 }),
    worker: mk(2, { status: 'employed', profession: 'manual', netIncome: 30, income: 35, incomeBySource: { wage: 35 } }),
    clerk: mk(3, { status: 'employed', profession: 'clerical', netIncome: 30, income: 35 }),
    engineer: mk(4, { status: 'employed', profession: 'engineer', netIncome: 60, income: 70 }),
    teacher: mk(5, { status: 'employed', profession: 'care', netIncome: 40, income: 45 }),
    official: mk(6, { status: 'employed', profession: 'official', skill: 0.3, netIncome: 40, income: 45 }),
    farmer: mk(7, { status: 'self', profession: 'manual', netIncome: 40, income: 45, incomeBySource: { business: 45 }, shares: { 1: 0.02 } }),
    gig: mk(8, { status: 'self', profession: 'service', netIncome: 12, income: 14, incomeBySource: { business: 14 } }),
    capitalist: mk(9, { status: 'employed', profession: 'manager', netIncome: 500, income: 600, cash: 5000, incomeBySource: { capital: 550, wage: 50 }, shares: { 1: 0.4 } }),
    retired: mk(10, { status: 'retired', age: 70, netIncome: 15, income: 15, incomeBySource: { transfer: 15 } }),
    shareholder: mk(11, { status: 'employed', profession: 'manual', netIncome: 40, income: 45, shares: { 1: 0.15 } }),
    deficit: mk(12, { status: 'employed', profession: 'manual', netIncome: 6, income: 6 }),
    starving: mk(13, { status: 'employed', profession: 'manual', netIncome: 40, income: 40, needsMet: poorNeeds }),
  };
  // государственный сектор мал: номенклатуры нет
  analyze(w);
  const c = (k) => hs[k].classId;
  assert.equal(c('unemployed'), 'destitute');
  assert.equal(c('worker'), 'workers');
  assert.equal(c('clerk'), 'workers');
  assert.equal(c('engineer'), 'specialists');
  assert.equal(c('teacher'), 'specialists');
  assert.equal(c('official'), 'specialists');
  assert.equal(c('farmer'), 'smallowners');
  assert.equal(c('gig'), 'precariat');
  assert.equal(c('capitalist'), 'capitalists');
  assert.equal(c('retired'), 'retired');
  assert.equal(c('shareholder'), 'smallowners');
  assert.equal(c('deficit'), 'destitute');
  assert.equal(c('starving'), 'destitute');

  // богатство: 5000 + 0.4 * (1000+200-200)
  const cap = w.stats.classes.find((x) => x.id === 'capitalists');
  assert.equal(cap.count, 1);
  assert.equal(cap.avgWealth, 5400);
  assert.equal(w.stats.classes.reduce((a, x) => a + x.count, 0), 13);
  assert.ok(Math.abs(w.stats.classes.reduce((a, x) => a + x.share, 0) - 1) < 1e-9);
  for (const h of w.households) assert.ok(h.satisfaction >= 0 && h.satisfaction <= 1);
  noNaN(w.stats, 'stats');
});

test('номенклатура появляется при большом госсекторе', () => {
  const w = buildWorld({ owners: Object.fromEntries(['agri', 'mining', 'energy', 'manufacturing', 'construction', 'services', 'finance'].map((i) => [i, 'state'])) });
  w.households[5] = hh(6, { status: 'employed', profession: 'official', skill: 0.9, netIncome: 40, income: 45 });
  analyze(w);
  assert.ok(w.stats.stateShareOfOutput > 0.5);
  assert.equal(w.households[5].classId, 'nomenklatura');
  const w2 = buildWorld({});
  w2.households[5] = hh(6, { status: 'employed', profession: 'official', skill: 0.9, netIncome: 40, income: 45 });
  analyze(w2);
  assert.equal(w2.households[5].classId, 'specialists');
});

test('мобильность и статистика неравенства', () => {
  const w = createWorld();
  w.stats.basicBasketCost = 10;
  w.households.push(hh(1, { status: 'employed', profession: 'engineer', netIncome: 50, income: 50, parentClassId: 'workers' }));
  w.households.push(hh(2, { status: 'employed', profession: 'manual', netIncome: 30, income: 30, parentClassId: 'destitute' }));
  w.households.push(hh(3, { status: 'employed', profession: 'engineer', netIncome: 50, income: 50, parentClassId: 'capitalists' }));
  w.households.push(hh(4, { status: 'unemployed', netIncome: 0 }));
  analyze(w);
  assert.equal(w.stats.mobility, 0.5);       // из двух детей нижних классов один поднялся
  assert.equal(w.stats.povertyRate, 0.25);
  assert.ok(w.stats.giniIncome > 0.3);
  assert.ok(w.stats.avgSatisfaction > 0 && w.stats.avgSatisfaction < 1);
});

test('удовлетворённость: безработный ниже занятого, свободы поднимают, преступность снижает', () => {
  const mk = () => { const w = buildWorld({}); w.households[1].status = 'unemployed'; w.households[1].netIncome = 0; return w; };
  const w = mk(); analyze(w);
  assert.ok(w.households[1].satisfaction < w.households[2].satisfaction);
  const free = mk(); const tyr = mk();
  Object.assign(tyr.policies, { pressFreedom: 0, repression: 1, strikeRight: false, emigrationAllowed: false });
  analyze(free); analyze(tyr);
  assert.ok(free.stats.avgSatisfaction > tyr.stats.avgSatisfaction);
  const crim = mk(); crim.gov.crime = 0.9; analyze(crim);
  assert.ok(free.stats.avgSatisfaction > crim.stats.avgSatisfaction);
  // капиталистам важны права собственности
  const cw = (pr) => { const x = buildWorld({}); x.policies.propertyRights = pr; x.households[0] = hh(1, { status: 'employed', netIncome: 500, income: 500, cash: 9999, incomeBySource: { capital: 500 } }); analyze(x); return x.households[0]; };
  const a = cw(1), b = cw(0);
  assert.equal(a.classId, 'capitalists');
  assert.ok(a.satisfaction > b.satisfaction + 0.1);
});

test('статистика ренты и HHI из firms.marketShare без markets', () => {
  const w = createWorld();
  const f = makeFirm(1, 'agri'); f.marketShare = 1; f.revenue = 10; w.firms.push(f);
  const g = makeFirm(2, 'tech'); g.marketShare = 0.5; g.revenue = 10; w.firms.push(g);
  const g2 = makeFirm(3, 'tech'); g2.marketShare = 0.5; g2.revenue = 10; w.firms.push(g2);
  analyze(w);
  assert.ok(Math.abs(w.stats.avgHhi - (1 * 10 + 0.5 * 20) / 30) < 1e-9);
});

// ── Определитель строя ──
for (const [id, label] of [
  ['anarchocapitalism', 'Анархо-капитализм'], ['minarchism', 'Минархизм'], ['socialdemocracy', 'Социал-демократия'],
  ['plannedsocialism', 'Плановый социализм'], ['statecapitalism', 'Государственный капитализм'], ['marketsocialism', 'Рыночный социализм'],
]) {
  test(`строй: ${label}`, () => {
    const w = buildWorld(SCEN[id]);
    analyze(w);
    assert.equal(w.regime.defacto, null, 'де-факто не ожидается');
    assert.equal(w.regime.top[0].id, id, `top: ${w.regime.top.slice(0, 3).map((t) => t.label + ' ' + t.score.toFixed(2))}`);
    assert.ok(w.regime.label.startsWith(label));
    noNaN(w.regime, 'regime');
    const shares = w.regime.top.reduce((a, t) => a + t.share, 0);
    assert.ok(Math.abs(shares - 1) < 1e-9);
    for (const k of Object.keys(w.regime.axes)) assert.ok(w.regime.axes[k] >= 0 && w.regime.axes[k] <= 1, k);
    assert.equal(Object.keys(w.regime.axes).length, 9);
  });
}

test('компас: анкап слева-снизу, плановый социализм справа и авторитарнее', () => {
  const a = buildWorld(SCEN.anarchocapitalism); analyze(a);
  const p = buildWorld(SCEN.plannedsocialism); analyze(p);
  assert.ok(a.regime.compass.x < -0.7 && a.regime.compass.y < -0.8);
  assert.ok(p.regime.compass.x > 0.4 && p.regime.compass.y > 0.2);
});

test('модификаторы: авторитарная и протекционистская', () => {
  const w = buildWorld(SCEN.plannedsocialism); analyze(w);
  assert.ok(w.regime.modifiers.includes('авторитарная'));
  assert.ok(w.regime.modifiers.includes('протекционистская'));
});

test('де-факто: либеральные законы + hhi 0.9 + 1% богатства -> корпоратократия', () => {
  const w = buildWorld({ ...SCEN.minarchism, hhi: 0.9, top1: 0.5, policies: { ...SCEN.minarchism.policies, antitrustThreshold: 1 } });
  analyze(w);
  assert.ok(w.stats.avgHhi > 0.85);
  assert.ok(w.stats.top1WealthShare > 0.45);
  assert.equal(w.regime.defacto, 'корпоратократия');
  assert.equal(w.regime.label, 'корпоратократия');
  assert.equal(w.regime.top[0].id, 'minarchism', 'строй по закону остаётся первым');
});

test('де-факто: нулевое государство + преступность 0.8 -> несостоявшееся государство', () => {
  const w = buildWorld({ ...SCEN.anarchocapitalism, gov: { crime: 0.8, taxCompliance: 0.2, shadowShare: 0.6, corruption: 0.5 } });
  analyze(w);
  assert.equal(w.regime.top[0].id, 'anarchocapitalism');
  assert.equal(w.regime.defacto, 'несостоявшееся государство');
  assert.equal(w.regime.label, 'несостоявшееся государство');
});

test('де-факто: клептократия, петрогосударство, олигархия', () => {
  const k = buildWorld({ ...SCEN.minarchism, gov: { corruption: 0.8 } }); analyze(k);
  assert.equal(k.regime.defacto, 'клептократия');
  const p = buildWorld({ ...SCEN.socialdemocracy, rentFrac: 0.7 }); analyze(p);
  assert.equal(p.regime.defacto, 'петрогосударство');
  const o = buildWorld({ ...SCEN.minarchism, top1: 0.6, hhi: 0.2, gov: { corruption: 0.5 } }); analyze(o);
  assert.equal(o.regime.defacto, 'олигархия');
});

test('скорость: 500 домохозяйств и 100 фирм < 2 мс', () => {
  const w = createWorld();
  for (let i = 0; i < 100; i++) { const f = makeFirm(i + 1, ['agri', 'tech', 'services', 'energy'][i % 4]); f.output = 10 + i; f.price = 1; f.capital = 100; f.marketShare = 0.1; w.firms.push(f); }
  const profs = ['manual', 'clerical', 'service', 'care', 'engineer', 'manager', 'creative', 'official'];
  for (let i = 0; i < 500; i++) {
    const h = hh(i + 1, { status: i % 17 === 0 ? 'unemployed' : 'employed', profession: profs[i % 8], netIncome: 10 + (i * 7) % 90, income: 20 + (i * 7) % 90,
      cash: i * 3, shares: i % 5 === 0 ? { [(i % 100) + 1]: 0.05 } : {}, needsMet: Object.fromEntries(NEEDS.map((n) => [n.id, (i % 10) / 10])), parentClassId: 'workers' });
    w.households.push(h);
  }
  w.stats.basicBasketCost = 15;
  for (let i = 0; i < 20; i++) analyze(w);
  const t0 = performance.now();
  const N = 50;
  for (let i = 0; i < N; i++) analyze(w);
  const per = (performance.now() - t0) / N;
  assert.ok(per < 2, `analyze: ${per.toFixed(3)} мс`);
});
