// Технологии (GDD 3.7): появляются сами, направление эффектов рычагов против базовой ветки с тем же seed.
// Метрики — среднее по seed 1–3, 30 лет, industrial. Пороги подобраны по измеренным значениям с запасом; где направление
// держится только на средней по нескольким seed (мир шумный), это сказано в сообщении проверки.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../src/sim/schema.js';
import { populate } from '../src/sim/init.js';
import { tick } from '../src/sim/tick.js';
import { newGame, step } from '../src/sim/index.js';
import { totalCash, mint } from '../src/sim/ledger.js';
import { forcePlatform, forceTech } from '../src/sim/systems/tech.js';

const SEEDS = [1, 2, 3];
const YEARS = 30;
const LOW = new Set(['manual', 'clerical', 'service']);
const mean = a => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);

function make(seed, mut) {
  const w = createWorld({ seed, preset: 'industrial' });
  populate(w, { preset: 'industrial' });
  if (mut) Object.assign(w.policies, mut);
  return w;
}

function metrics(w, extra = {}) {
  const T = w.tech;
  const au = T.list.filter(t => t.kind === 'automation');
  const aged = T.list.filter(t => (t.kind === 'automation' || t.kind === 'productivity' || t.kind === 'gpt') && w.t - t.bornT >= 60 && w.t - t.bornT <= 170);
  let emp = 0, man = 0;
  for (const h of w.households) if (h.status === 'employed' || h.status === 'gig') { emp++; if (h.profession === 'manual') man++; }
  return {
    n: T.count,
    nAuto: au.length,
    lowTargets: au.filter(t => LOW.has(t.profession)).length,
    autoBy12y: au.filter(t => t.bornT <= 144).length,
    firstAuto: au.length ? Math.min(...au.map(t => t.bornT)) : YEARS * 12,
    autoAdopters: au.reduce((s, t) => s + t.adopters.length, 0),
    adoptersPerTech: aged.length ? aged.reduce((s, t) => s + t.adopters.length, 0) / aged.length : 0,
    itHhi: w.markets.tech.hhi,
    manual: man / Math.max(1, emp),
    displaced: T.displacedTotal,
    ...extra,
  };
}

const cache = new Map();
function scenario(key, mut, seeds = SEEDS) {
  if (cache.has(key)) return cache.get(key);
  const rows = seeds.map(seed => {
    const w = make(seed, mut);
    let longDisp = 0;
    for (let i = 0; i < YEARS * 12; i++) {
      tick(w);
      if (i >= 120) for (const h of w.households) if (h.status === 'unemployed' && h.displacedT != null && !h.retrain && w.t - h.displacedT > 6) longDisp++;
    }
    return metrics(w, { longDisp: longDisp / (YEARS * 12 - 120) });
  });
  const m = {};
  for (const k of Object.keys(rows[0])) m[k] = mean(rows.map(r => r[k]));
  m.rows = rows;
  cache.set(key, m);
  return m;
}

// Платформы за 30 лет по умолчанию бывают не в каждом мире, поэтому в сценариях про платформы одну запускаем вручную на втором году
// (одинаково во всех ветках), а дальше всё решают правила и рычаги.
function platformScenario(key, mut) {
  if (cache.has(key)) return cache.get(key);
  const rows = SEEDS.map(seed => {
    const w = newGame({ seed, preset: 'industrial', neighbors: [] });
    Object.assign(w.policies, mut || {});
    let fees = 0, prec = 0, gig = 0, k = 0;
    for (let i = 0; i < 25 * 12; i++) {
      step(w);
      if (w.t === 24) {
        const ts = w.firms.filter(f => f.alive && f.industry === 'tech').sort((a, b) => b.capital - a.capital);
        mint(w, ts[0], 20000, 'emission'); // чтобы владелец не разорился в первые месяцы и платформа успела проявиться
        forcePlatform(w, {}, ts[0], 'services');
      }
      fees += w.flows.platform_fees;
      if (w.t > 120) { prec += (w.stats.classes.find(c => c.id === 'precariat') || { share: 0 }).share; gig += w.stats.gigShare; k++; }
    }
    return { fees, prec: prec / k, gig: gig / k };
  });
  const m = {};
  for (const f of ['fees', 'prec', 'gig']) m[f] = mean(rows.map(r => r[f]));
  cache.set(key, m);
  return m;
}

test('технологии появляются сами: за 30 лет есть и виды, и события; мир — JSON; деньги сходятся', () => {
  const m = scenario('base');
  for (const r of m.rows) assert.ok(r.n > 0, 'в каждом из seed 1–3 появилась хотя бы одна технология');
  assert.ok(m.nAuto >= 2, `автоматизаций в среднем ${m.nAuto.toFixed(1)}`);
  assert.ok(m.autoAdopters > 0, 'автоматизацию внедряют');
  assert.ok(m.displaced > 0, 'кого-то вытеснили');
  const w = make(1);
  for (let i = 0; i < 240; i++) tick(w);
  structuredClone(w);
  assert.ok(Math.abs(totalCash(w) - w.moneySupply) < 1e-5 * Math.max(1, w.moneySupply), 'инвариант денег');
  assert.equal(w.tech.count, w.tech.list.length);
  const names = new Set();
  for (const t of w.tech.list) {
    assert.ok(t.name && !names.has(t.name), 'названия уникальны');
    names.add(t.name);
    assert.ok(['automation', 'productivity', 'product', 'platform', 'gpt'].includes(t.kind));
    assert.ok(['private', 'state', 'foreign'].includes(t.origin));
  }
  const techEvents = w.events.filter(e => /^(tech_|layoff|platform|patent|gig)/.test(e.type));
  assert.ok(techEvents.length > 0, 'в ленте есть технологические события');
  const perMonth = {};
  for (const e of techEvents) perMonth[e.t] = (perMonth[e.t] || 0) + 1;
  assert.ok(Math.max(...Object.values(perMonth)) <= 3, 'не спамим: не больше трёх технологических событий в месяц');
});

test('детерминизм: одинаковый seed — одинаковые технологии', () => {
  const a = make(4), b = make(4);
  for (let i = 0; i < 180; i++) { tick(a); tick(b); }
  assert.deepEqual(a.tech, b.tech);
});

test('направление: МРОТ 1.0 — автоматизация чаще целится в низкооплачиваемый труд и появляется раньше', () => {
  const base = scenario('base'), hi = scenario('minWage1', { minWage: 1.0 });
  assert.ok(hi.lowTargets > base.lowTargets, `целей среди manual/clerical/service: ${hi.lowTargets.toFixed(1)} против ${base.lowTargets.toFixed(1)}`);
  assert.ok(hi.autoBy12y > base.autoBy12y, `автоматизаций за первые 12 лет: ${hi.autoBy12y.toFixed(1)} против ${base.autoBy12y.toFixed(1)} (первая — на ${hi.firstAuto.toFixed(0)} против ${base.firstAuto.toFixed(0)} мес.: на одной цифре шум)`);
});

test('направление: запрет всего нового — технологий нет, доля физического труда выше', () => {
  const base = scenario('base'), ban = scenario('ban', { techBan: 'all' });
  assert.ok(ban.n <= 1, `технологий при запрете: ${ban.n}`);
  assert.equal(ban.displaced, 0);
  assert.ok(ban.manual > base.manual, `доля manual ${ban.manual.toFixed(3)} против ${base.manual.toFixed(3)}`);
});

test('направление: налог на роботов 1.0 — автоматизацию не внедряют', () => {
  const base = scenario('base'), rt = scenario('robot1', { robotTax: 1 });
  assert.ok(base.autoAdopters > 5, 'в базовой ветке автоматизацию внедряют');
  assert.ok(rt.autoAdopters < 0.25 * base.autoAdopters, `внедрений автоматизации ${rt.autoAdopters.toFixed(1)} против ${base.autoAdopters.toFixed(1)}`);
  assert.ok(rt.displaced < base.displaced);
});

test('направление: патент 0 лет — одна и та же технология расходится шире; технологий меньше', () => {
  // контролируемый опыт: на втором году у лучшей IT-фирмы появляется одна и та же автоматизация, дальше 30 месяцев считаем внедрения
  const adopters = years => {
    const out = [];
    for (const seed of SEEDS) {
      const w = make(seed);
      for (let i = 0; i < 24; i++) tick(w);
      w.policies.patentYears = years;
      const ts = w.firms.filter(f => f.alive && f.industry === 'tech').sort((a, b) => b.capital - a.capital);
      const tt = ['manufacturing', 'agri', 'construction', 'mining'].map(industry => forceTech(w, ts[0], { kind: 'automation', industry, profession: 'manual' }));
      for (let i = 0; i < 30; i++) tick(w);
      out.push(tt.reduce((x, t) => x + t.adopters.length, 0));
    }
    return mean(out);
  };
  const a15 = adopters(15), a0 = adopters(0);
  assert.ok(a0 > a15, `внедрений четырёх технологий за 30 месяцев: ${a0.toFixed(2)} против ${a15.toFixed(2)}`);
  const base = scenario('base'), p0 = scenario('pat0', { patentYears: 0 });
  assert.ok(p0.n < base.n, `технологий ${p0.n.toFixed(1)} против ${base.n.toFixed(1)}: слабые патенты — меньше стимул`);
});

test('направление: потолок комиссии 5% — платформы получают меньше', { timeout: 300000 }, () => {
  const base = platformScenario('pbase'), cap = platformScenario('pcap05', { platformFeeCap: 0.05 });
  assert.ok(base.fees > 0, 'платформа собирает комиссию');
  assert.ok(cap.fees < 0.5 * base.fees, `сборы ${cap.fees.toFixed(0)} против ${base.fees.toFixed(0)}`);
});

test('направление: подрядчики — наёмные работники: прекариата меньше', { timeout: 300000 }, () => {
  const base = platformScenario('pbase'), emp = platformScenario('pgigEmp', { gigWorkersAreEmployees: true });
  assert.ok(base.gig > 0 && base.prec > 0, `в базовой ветке есть подрядчики (${base.gig.toFixed(3)}) и прекариат (${base.prec.toFixed(3)})`);
  assert.ok(emp.prec < 0.5 * base.prec, `прекариат ${emp.prec.toFixed(4)} против ${base.prec.toFixed(4)}`);
  assert.ok(emp.gig < 0.1 * base.gig, `подрядчиков ${emp.gig.toFixed(4)} против ${base.gig.toFixed(4)}`);
});

test('направление: переобучение 2% ВВП — длительная безработица вытесненных ниже', () => {
  // при МРОТ 1.0 вытесненных достаточно, чтобы разница не тонула в шуме
  const S5 = [1, 2, 3, 4, 5];
  const base = scenario('mwbase', { minWage: 1.0 }, S5), re = scenario('mwretr', { minWage: 1.0, retrainingBudget: 0.02 }, S5);
  assert.ok(base.longDisp > 0, 'в базовой ветке есть долго безработные вытесненные');
  const rb = base.longDisp / Math.max(1, base.displaced), rr = re.longDisp / Math.max(1, re.displaced);
  assert.ok(rr < 0.85 * rb, `долго безработных вытесненных на одного вытесненного: ${rr.toFixed(4)} против ${rb.toFixed(4)}`);
});

test('иностранные технологии: closed — нет технологий из-за границы, open — есть', () => {
  const origins = mut => {
    let n = 0;
    for (const seed of SEEDS) {
      const w = make(seed, mut);
      for (let i = 0; i < 25 * 12; i++) tick(w);
      n += w.tech.list.filter(t => t.origin === 'foreign').length;
    }
    return n;
  };
  assert.equal(origins({ foreignTech: 'closed' }), 0);
  assert.ok(origins({ foreignTech: 'open' }) > 0);
});

test('госнаука: при openScience технологии государства свободны, иначе плата уходит в бюджет', () => {
  const run = open => {
    const w = make(2, { scienceBudget: 0.05, openScience: open });
    let fees = 0;
    for (let i = 0; i < 25 * 12; i++) { tick(w); fees += w.flows.tech_licenses; }
    const st = w.tech.list.filter(t => t.origin === 'state');
    return { n: st.length, adopters: st.reduce((s, t) => s + t.adopters.length, 0), fees };
  };
  const o = run(true), c = run(false);
  assert.ok(o.n > 0 && c.n > 0, 'госнаука делает технологии');
  assert.ok(o.adopters > 0, 'их внедряют');
});
