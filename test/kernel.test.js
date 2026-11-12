import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, INDUSTRIES, POLICY_DEFS, createPolicies } from '../src/sim/schema.js';
import { populate } from '../src/sim/init.js';
import { tick } from '../src/sim/tick.js';
import { totalCash } from '../src/sim/ledger.js';

function make(seed = 1, preset = 'industrial', mutate) {
  const w = createWorld({ seed, preset });
  populate(w, { preset });
  if (mutate) mutate(w);
  return w;
}
function run(w, n) { for (let i = 0; i < n; i++) tick(w); return w; }
function finite(o, path = '') {
  if (typeof o === 'number') { if (!Number.isFinite(o)) throw new Error('не число: ' + path + ' = ' + o); return; }
  if (o && typeof o === 'object') for (const k in o) finite(o[k], path + '.' + k);
}
function mean(a) { return a.reduce((s, x) => s + x, 0) / Math.max(1, a.length); }

test('мир — чистый JSON и стартует без аномалий', () => {
  for (const preset of ['industrial', 'agrarian', 'resource', 'trading']) {
    const w = make(1, preset);
    structuredClone(w);
    assert.equal(w.households.length, 500);
    const inds = new Set(w.firms.filter(f => f.alive).map(f => f.industry));
    assert.equal(inds.size, INDUSTRIES.length, preset);
    assert.ok(Math.abs(totalCash(w) - w.moneySupply) < 1e-6);
    finite(w.stats, 'stats');
  }
});

test('инвариант денег на 600 тиков', () => {
  const w = make(7);
  let maxErr = 0;
  for (let i = 0; i < 600; i++) {
    tick(w);
    maxErr = Math.max(maxErr, Math.abs(totalCash(w) - w.moneySupply) / Math.max(1, w.moneySupply));
  }
  assert.ok(maxErr < 1e-9, 'относительная ошибка ' + maxErr);
});

test('50 лет при политике по умолчанию: нет NaN, безработица, отрасли, ВВП', () => {
  for (const seed of [1, 2, 3]) {
    const w = make(seed);
    const g0 = w.stats.gdpReal;
    let inRange = 0, minG = Infinity, maxG = 0;
    for (let i = 0; i < 600; i++) {
      tick(w);
      const u = w.stats.unemployment;
      if (u >= 0.02 && u <= 0.25) inRange++;
      minG = Math.min(minG, w.stats.gdpReal); maxG = Math.max(maxG, w.stats.gdpReal);
      if (i % 50 === 0) { finite(w.stats, 'stats'); finite(w.gov, 'gov'); }
    }
    finite(w.stats, 'stats'); finite(w.gov, 'gov'); finite(w.markets, 'markets'); finite(w.abroad, 'abroad');
    for (const h of w.households) finite({ cash: h.cash, income: h.income, wage: h.wage, health: h.health }, 'hh');
    for (const f of w.firms) finite({ cash: f.cash, price: f.price, output: f.output, capital: f.capital }, 'firm');
    assert.ok(inRange / 600 > 0.75, `seed ${seed}: безработица в норме ${(inRange / 6).toFixed(0)}% месяцев`);
    const inds = new Set(w.firms.filter(f => f.alive).map(f => f.industry));
    assert.equal(inds.size, INDUSTRIES.length, 'фирмы есть во всех отраслях');
    assert.ok(minG > 0.35 * g0, 'ВВП не схлопнулся');
    assert.ok(maxG < 4 * g0, 'ВВП не улетел');
    assert.ok(w.stats.population > 0);
  }
});

test('детерминизм: одинаковый seed — одинаковый мир', () => {
  const a = run(make(42), 120);
  const b = run(make(42), 120);
  assert.deepEqual(a.stats, b.stats);
  assert.equal(a.moneySupply, b.moneySupply);
  assert.equal(a.firms.length, b.firms.length);
  assert.deepEqual(a.households.slice(0, 20).map(h => h.cash), b.households.slice(0, 20).map(h => h.cash));
  const c = run(make(43), 120);
  assert.notEqual(c.moneySupply, a.moneySupply);
});

test('скорость: в среднем быстрее 10 мс на тик', () => {
  const w = make(5);
  run(w, 24);
  const t0 = performance.now();
  run(w, 120);
  const ms = (performance.now() - t0) / 120;
  assert.ok(ms < 10, 'мс на тик: ' + ms.toFixed(2));
});

test('каждый рычаг из POLICY_DEFS меняет мир (хотя бы в одной метрике)', { timeout: 300000 }, () => {
  const baseline = run(make(11), 60);
  const sig = w => JSON.stringify([w.stats.gdp, w.gov.revenue, w.gov.spending, w.stats.unemployment, w.stats.cpi, w.moneySupply,
    w.gov.corruption, w.gov.crime, w.stats.avgWage, w.abroad.fx, w.gov.shadowShare]);
  const base = sig(baseline);
  const noEffect = [];
  const alt = {
    incomeTaxBrackets: [{ from: 0, rate: 0.3 }, { from: 1, rate: 0.5 }], payrollTax: 0.3, corpTax: 0.5, corpTaxLargeSurcharge: 0.3, vat: 0.3, vatFoodExempt: true,
    exciseVice: 2, dividendTax: 0.5, wealthTax: 0.05, inheritanceTax: 0.8, resourceRent: 0.8, rentDistribution: 'citizens', carbonTax: 0.8, taxAdmin: 1,
    healthMode: 'state', healthBudget: 0.1, educationMode: 'state', educationBudget: 0.1, securityMode: 'private', securityBudget: 0.08,
    infrastructureBudget: 0.08, scienceBudget: 0.04, pensionLevel: 0.9, unemploymentBenefit: 0.8, minIncomeGuarantee: 1.2, ubi: 0.6, officialPay: 1.8,
    minWage: 1.2, unionPower: 1, firingCost: 10, workWeek: 55, retirementAge: 58, antitrustThreshold: 0.2, antitrustBreakup: true, cbMandate: 'none', inflationTarget: 0.12, regulationBurden: 1,
    propertyRights: 0.1, vicePolicy: 'banned', cbRate: 0.3, deficitMonetization: 1, fxRegime: 'fixed', capitalControls: 1, bankReserve: 0.8,
    elections: 'none', pressFreedom: 0, courtsIndependence: 0, strikeRight: false, emigrationAllowed: false, repression: 1,
  };
  for (const d of POLICY_DEFS) {
    if (!(d.id in alt)) continue;
    const w = make(11, 'industrial', ww => {
      ww.policies[d.id] = alt[d.id];
      if (d.id === 'antitrustThreshold') ww.policies.antitrustBreakup = true; // порог проявляется в дроблении и слияниях
      if (d.id === 'deficitMonetization') ww.policies.ubi = 0.3; // монетизации нужен дефицит
      if (d.id === 'educationBudget') ww.policies.educationMode = 'state';
    });
    run(w, 60);
    if (sig(w) === base) noEffect.push(d.id);
  }
  // рычаги по отраслям
  const indAlt = { ownership: 'state', planned: true, priceCap: 0.8, subsidy: 0.3, tariff: 1.5, exportDuty: 0.6 };
  for (const id in indAlt) {
    const w = make(11, 'industrial', ww => { for (const ind of INDUSTRIES) { ww.policies.industry[ind.id][id] = indAlt[id]; } });
    run(w, 60);
    if (sig(w) === base) noEffect.push('industry.' + id);
  }
  // ожидаемые исключения (вторая волна / декоративные)
  const allowed = new Set([]);
  const bad = noEffect.filter(x => !allowed.has(x));
  assert.deepEqual(bad, [], 'не действуют: ' + bad.join(', '));
});

test('направление эффекта: антимонопольный порог = 1 даёт более высокую концентрацию', { timeout: 300000 }, () => {
  const seeds = [1, 2, 3];
  const hhiOf = (thr, seed) => {
    const w = make(seed, 'industrial', ww => { ww.policies.antitrustThreshold = thr; });
    let acc = 0, n = 0;
    for (let i = 0; i < 360; i++) {
      tick(w);
      if (i >= 300) { acc += mean(Object.values(w.markets).map(m => m.hhi)); n++; }
    }
    return acc / n;
  };
  const a = mean(seeds.map(s => hhiOf(1, s)));
  const b = mean(seeds.map(s => hhiOf(0.4, s)));
  assert.ok(a > b, `hhi без закона ${a.toFixed(3)} должен быть выше, чем с порогом 0.4: ${b.toFixed(3)}`);
});

test('направление эффекта: потолок цены ниже себестоимости на agri даёт дефицит', () => {
  const base = run(make(3), 24);
  const cap = run(make(3, 'industrial', w => { w.policies.industry.agri.priceCap = 0.7; }), 24);
  assert.ok(cap.markets.agri.shortage > base.markets.agri.shortage + 0.02, `дефицит ${cap.markets.agri.shortage} против ${base.markets.agri.shortage}`);
  assert.ok(cap.markets.agri.shortage > 0);
});

test('направление эффекта: монетизация дефицита повышает инфляцию', () => {
  const mk = m => make(4, 'industrial', w => {
    w.policies.deficitMonetization = m;
    w.policies.ubi = 0.15;
  });
  const a = run(mk(0), 60);
  const b = run(mk(1), 60);
  assert.ok(b.moneySupply > a.moneySupply * 1.5, 'денег заметно больше');
  assert.equal(a.flows.emission, 0, 'без монетизации новых денег нет');
  assert.ok(b.gov.debt < a.gov.debt, 'долг меньше, когда дефицит печатают');
  assert.ok(b.stats.cpi > a.stats.cpi * 1.1, `ИПЦ ${b.stats.cpi.toFixed(3)} против ${a.stats.cpi.toFixed(3)}`);
});

test('направление эффекта: тариф 2 на промышленность снижает импорт', () => {
  const avgImports = tariff => {
    const w = make(5, 'industrial', ww => { if (tariff != null) ww.policies.industry.manufacturing.tariff = tariff; });
    run(w, 24);
    let acc = 0;
    for (let i = 0; i < 24; i++) { tick(w); acc += w.markets.manufacturing.imports; }
    return acc / 24;
  };
  const a = avgImports(null), b = avgImports(2);
  assert.ok(b < a * 0.6, `импорт ${b.toFixed(1)} против ${a.toFixed(1)}`);
});

test('крайние наборы живут 20 лет без NaN: «анкап» и «плановая»', { timeout: 300000 }, () => {
  const anarchy = make(6, 'industrial', w => {
    const p = w.policies;
    p.incomeTaxBrackets = [{ from: 0, rate: 0 }]; p.payrollTax = 0; p.corpTax = 0; p.vat = 0; p.exciseVice = 0; p.dividendTax = 0; p.wealthTax = 0;
    p.inheritanceTax = 0; p.resourceRent = 0; p.carbonTax = 0; p.taxAdmin = 0;
    p.healthBudget = 0; p.educationBudget = 0; p.securityBudget = 0; p.infrastructureBudget = 0; p.scienceBudget = 0;
    p.pensionLevel = 0; p.unemploymentBenefit = 0; p.minIncomeGuarantee = 0; p.ubi = 0; p.minWage = 0; p.unionPower = 0; p.regulationBurden = 0;
    p.healthMode = 'private'; p.educationMode = 'private'; p.securityMode = 'private'; p.antitrustThreshold = 1; p.repression = 0;
    for (const ind of INDUSTRIES) p.industry[ind.id].tariff = 0;
    p.industry.security.ownership = 'free';
  });
  run(anarchy, 240);
  finite(anarchy.stats, 'stats'); finite(anarchy.gov, 'gov'); finite(anarchy.markets, 'markets');
  assert.ok(anarchy.firms.some(f => f.alive));
  assert.ok(Math.abs(totalCash(anarchy) - anarchy.moneySupply) < 1e-3 * Math.max(1, anarchy.moneySupply));

  const plan = make(8, 'industrial', w => {
    for (const ind of INDUSTRIES) { w.policies.industry[ind.id].ownership = 'state'; w.policies.industry[ind.id].planned = true; }
  });
  run(plan, 240);
  finite(plan.stats, 'stats'); finite(plan.gov, 'gov'); finite(plan.markets, 'markets');
  assert.ok(plan.firms.some(f => f.alive && f.owner === 'state'));
  assert.ok(Math.abs(totalCash(plan) - plan.moneySupply) < 1e-3 * Math.max(1, plan.moneySupply));
});

test('пресеты различаются и живут 20 лет', () => {
  const res = {};
  for (const preset of ['industrial', 'agrarian', 'resource', 'trading']) {
    const w = run(make(9, preset), 240);
    finite(w.stats, 'stats');
    assert.ok(w.stats.gdp > 0, preset);
    res[preset] = w;
  }
  const share = (w, g) => w.firms.filter(f => f.alive && f.industry === g).reduce((a, f) => a + f.output, 0);
  assert.ok(share(res.agrarian, 'agri') > 0 && share(res.resource, 'mining') > 0);
});

test('снимок и ветка: structuredClone продолжается так же, как оригинал', () => {
  const a = run(make(21), 60);
  const b = structuredClone(a);
  run(a, 36); run(b, 36);
  assert.deepEqual(a.stats, b.stats);
  assert.equal(a.moneySupply, b.moneySupply);
});

test('национализация, приватизация, кооперация, дробление: события, деньги сходятся', () => {
  const w = make(5);
  run(w, 12);
  w.policies.industry.manufacturing.ownership = 'state';
  run(w, 3);
  assert.ok(w.firms.filter(f => f.alive && f.industry === 'manufacturing').every(f => f.owner === 'state'));
  assert.ok(w.events.some(e => e.type === 'nationalization'));
  w.policies.industry.manufacturing.ownership = 'free';
  run(w, 3);
  assert.ok(w.firms.filter(f => f.alive && f.industry === 'manufacturing').every(f => f.owner === 'private'));
  assert.ok(w.events.some(e => e.type === 'privatization'));
  w.policies.industry.agri.ownership = 'coop';
  run(w, 3);
  assert.ok(w.firms.filter(f => f.alive && f.industry === 'agri').every(f => f.owner === 'coop'));
  w.policies.industry.agri.ownership = 'free';
  w.policies.antitrustThreshold = 0.2;
  w.policies.antitrustBreakup = true;
  run(w, 36);
  assert.ok(w.events.some(e => e.type === 'breakup'));
  assert.ok(Math.abs(totalCash(w) - w.moneySupply) < 1e-6 * w.moneySupply);
  finite(w.stats, 'stats');
  assert.ok(w.events.length <= 260);
});

test('запрет «грешных» товаров при слабой полиции: чёрный рынок и преступность', () => {
  const mk = banned => make(7, 'industrial', w => {
    if (banned) { w.policies.vicePolicy = 'banned'; w.policies.securityBudget = 0.003; }
  });
  const a = run(mk(false), 48), b = run(mk(true), 48);
  assert.ok(b.flows.black_market + (b.flows.corruption || 0) > 0, 'есть обороты чёрного рынка');
  assert.ok(b.gov.crime > a.gov.crime, 'преступность выше');
  assert.ok(b.markets.vice.sold < a.markets.vice.sold * 0.2, 'легальных продаж почти нет');
});

test('высокие налоги и слабый аппарат гонят в тень (кривая Лаффера)', { timeout: 120000 }, () => {
  const rev = k => {
    const w = make(3, 'industrial', ww => {
      const p = ww.policies;
      p.payrollTax = Math.min(0.5, 0.17 * k); p.corpTax = Math.min(0.9, 0.2 * k); p.vat = Math.min(0.5, 0.18 * k);
      p.incomeTaxBrackets = [{ from: 0, rate: Math.min(0.9, 0.1 * k) }, { from: 1, rate: Math.min(0.9, 0.2 * k) }, { from: 3, rate: Math.min(0.9, 0.3 * k) }];
    });
    run(w, 60);
    let r = 0, g = 0;
    for (let i = 0; i < 48; i++) { tick(w); r += w.gov.revenue - (w.gov.revenueByKind.acquisitions || 0); g += w.stats.gdp; }
    return { share: r / g, shadow: w.gov.shadowShare };
  };
  const lo = rev(1), mid = rev(1.5), hi = rev(2.8);
  assert.ok(hi.shadow > lo.shadow + 0.3, 'тень растёт');
  assert.ok(hi.share < mid.share, 'после пика сборы падают');
});

// ───────── Регрессия баланса: политика по умолчанию, 50 лет, все пресеты ─────────
const SPEC = ['care', 'engineer', 'manager', 'creative'];
const specialists = w => w.households.filter(h => h.status === 'employed' && SPEC.includes(h.profession)).length;

export function balanceRun(seed, preset, months = 600) {
  const w = make(seed, preset);
  const spec0 = specialists(w);
  const us = [], cpi = [];
  let maxShortage24 = 0;
  for (let i = 0; i < months; i++) {
    tick(w);
    us.push(w.stats.unemployment); cpi.push(w.stats.cpi);
    if (i < 24) for (const m of Object.values(w.markets)) maxShortage24 = Math.max(maxShortage24, m.shortage);
  }
  const late = us.slice(60);
  const years = (months - 60) / 12;
  return {
    inflation: Math.pow(cpi[months - 1] / cpi[59], 1 / years) - 1,
    avgU: mean(late), maxU: Math.max(...us), hi: us.filter(u => u > 0.15).length / months,
    cpi50: cpi[months - 1], spec: specialists(w) / Math.max(1, spec0), u0: us[0], maxShortage24,
  };
}

test('баланс по умолчанию: инфляция, безработица, ИПЦ и структура занятости за 50 лет', { timeout: 600000 }, () => {
  const bad = [];
  for (const preset of ['industrial', 'agrarian', 'resource', 'trading']) {
    for (const seed of [1, 2, 3, 4]) {
      const r = balanceRun(seed, preset);
      const tag = `${preset}/${seed}`;
      if (!(r.inflation >= 0 && r.inflation <= 0.06)) bad.push(`${tag}: инфляция ${(r.inflation * 100).toFixed(1)}%`);
      if (!(r.avgU >= 0.03 && r.avgU <= 0.11)) bad.push(`${tag}: средняя безработица ${(r.avgU * 100).toFixed(1)}%`);
      if (!(r.hi < 0.1)) bad.push(`${tag}: безработица >15% в ${(r.hi * 100).toFixed(0)}% месяцев`);
      if (!(r.cpi50 > 1.2)) bad.push(`${tag}: ИПЦ(50) ${r.cpi50.toFixed(2)}`);
      if (!(r.spec >= 0.6)) bad.push(`${tag}: специалистов ${(r.spec * 100).toFixed(0)}% от стартовых`);
    }
  }
  assert.deepEqual(bad, []);
});

test('мандат центробанка: none — без якоря и раздачи, но экономика не умирает', { timeout: 600000 }, () => {
  const bad = [];
  for (const seed of [1, 2, 3]) {
    const w = make(seed, 'industrial', ww => { ww.policies.cbMandate = 'none'; });
    const g0 = w.stats.gdpReal;
    const us = [];
    let stim = 0;
    for (let i = 0; i < 600; i++) { tick(w); us.push(w.stats.unemployment); stim += w.flows.cb_stimulus; }
    finite(w.stats, 'stats');
    if (stim !== 0) bad.push(`${seed}: раздача при мандате none`);
    if (!(mean(us.slice(60)) < 0.2)) bad.push(`${seed}: безработица ${(mean(us.slice(60)) * 100).toFixed(0)}%`);
    if (!(w.stats.gdpReal > 0.6 * g0)) bad.push(`${seed}: ВВП ${(w.stats.gdpReal / g0).toFixed(2)} от стартового`);
  }
  assert.deepEqual(bad, []);
});

test('мандат dual раздаёт деньги отдельным потоком, none — нет', () => {
  const run1 = mandate => {
    const w = make(2, 'industrial', ww => { ww.policies.cbMandate = mandate; ww.policies.minWage = 1.2; });
    let stim = 0;
    for (let i = 0; i < 120; i++) { tick(w); stim += w.flows.cb_stimulus; }
    return stim;
  };
  assert.equal(run1('none'), 0);
  assert.ok(run1('dual') > 0);
});
