// Соседние страны (GDD §3.5): деньги в каждой стране отдельно, сохранение стоимости на границе, направление эффектов.
import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, step } from '../src/sim/index.js';
import { createWorld } from '../src/sim/schema.js';
import { populate } from '../src/sim/init.js';
import { tick } from '../src/sim/tick.js';
import { totalCash } from '../src/sim/ledger.js';
import { applyPreset, POLICY_PRESETS, buildPolicies } from '../src/sim/presets.js';
import { setTradeWith, neighborSummary } from '../src/sim/neighbors-info.js';
import { neighborPolicies } from '../src/sim/neighbors.js';

const countries = w => [w, ...w.neighbors.map(n => n.world)];
const inv = x => Math.abs(totalCash(x) - x.moneySupply) / Math.max(1, x.moneySupply);
const game = (seed = 2, pre = 24, opts = {}) => { const w = newGame({ seed, ...opts }); for (let i = 0; i < pre; i++) step(w); return w; };
const run = (w, n) => { for (let i = 0; i < n; i++) step(w); return w; };
const pair = (w, a, b) => w.xb.pairEma[a + '>' + b] || 0;
const migs = (w, from) => Object.entries(w.xb.migTotal).filter(([k]) => k.startsWith(from + '>')).reduce((a, [, v]) => a + v, 0);

test('соседи: инвариант денег в каждой стране и сохранение стоимости на границе, 15 лет', { timeout: 120000 }, () => {
  const w = newGame({ seed: 3 });
  assert.equal(w.neighbors.length, 3);
  let maxInv = 0, volSum = 0, gapSum = 0, worstMonthGap = 0;
  for (let i = 0; i < 180; i++) {
    step(w);
    for (const x of countries(w)) maxInv = Math.max(maxInv, inv(x));
    // сумма изменений счетов abroad по всем странам в мировых единицах (сумма / курс на начало месяца) равна торговому зазору и явно учтённому «незакрытому»
    const xb = w.xb;
    let S = 0;
    w.neighbors.forEach(n => { S += (n.world.abroad.cash - xb.A0[n.id]) / xb.fx0[n.id]; });
    S += (w.abroad.cash - xb.A0.home) / xb.fx0.home;
    const err = Math.abs(S - (xb.tradeGapM + xb.unmatchedM));
    worstMonthGap = Math.max(worstMonthGap, err / Math.max(1, xb.tradeVolM));
    volSum += xb.tradeVolM; gapSum += Math.abs(xb.tradeGapM);
  }
  assert.ok(maxInv < 1e-9, 'инвариант денег нарушен: ' + maxInv);
  assert.ok(worstMonthGap < 1e-6, 'проводки на границе не сходятся: ' + worstMonthGap);
  assert.ok(volSum > 0, 'между странами нет торговли');
  assert.ok(gapSum / volSum < 0.05, 'торговый зазор (сдвиг цены за месяц) больше 5% оборота: ' + gapSum / volSum);
  assert.ok(Math.abs(w.xb.unmatched) < 0.03 * volSum, 'незакрытых денег на границе слишком много: ' + w.xb.unmatched + ' при обороте ' + volSum);
  structuredClone(w);
  assert.ok(!JSON.stringify(w).includes('NaN') && !JSON.stringify(w).includes('null,null'));
});

test('соседи: детерминизм (одинаковый seed — одинаковый мир, включая соседей)', { timeout: 60000 }, () => {
  const a = run(newGame({ seed: 5 }), 60), b = run(newGame({ seed: 5 }), 60);
  assert.equal(a.stats.gdp, b.stats.gdp);
  assert.equal(a.moneySupply, b.moneySupply);
  assert.equal(a.xb.tradeGap, b.xb.tradeGap);
  a.neighbors.forEach((n, i) => { assert.equal(n.world.stats.gdp, b.neighbors[i].world.stats.gdp); assert.equal(n.world.rngState, b.neighbors[i].world.rngState); });
  const c = run(newGame({ seed: 6 }), 60);
  assert.notEqual(a.stats.gdp, c.stats.gdp);
});

test('соседи: без соседей мир считается по-старому, а три соседа задаются по умолчанию', { timeout: 60000 }, () => {
  const solo = newGame({ seed: 4, neighbors: [], mail: false });
  assert.equal(solo.neighbors, undefined);
  assert.equal(solo.abroad.plan, undefined);
  const ref = createWorld({ seed: 4, preset: 'industrial' });
  populate(ref, { preset: 'industrial' });
  for (let i = 0; i < 60; i++) { step(solo); tick(ref); assert.equal(solo.stats.gdp, ref.stats.gdp); assert.equal(solo.moneySupply, ref.moneySupply); }
  assert.ok(solo.abroad.worldPrice.manufacturing > 0);
  const w = newGame({ seed: 4 });
  assert.deepEqual(w.neighbors.map(n => n.presetId), ['minarchy', 'planned', 'socdem']);
  assert.ok(w.neighbors.every(n => n.world.households.length < 200 && !n.world.neighbors));
  // старое сохранение без соседей продолжает работать
  const old = structuredClone(solo);
  step(old);
  assert.equal(old.t, 61);
});

test('соседи: идеология соседей не меняется, мини-миры живут сами по себе', { timeout: 60000 }, () => {
  const w = run(newGame({ seed: 7 }), 120);
  for (const n of w.neighbors) {
    const want = neighborPolicies(n.presetId);
    const got = structuredClone(n.world.policies);
    delete want.tradeWith; delete got.tradeWith;
    assert.deepEqual(got, want, n.name);
    assert.equal(n.world.t, w.t);
  }
});

// Мир хаотичен: через несколько лет траектории расходятся, поэтому прямой эффект меряем в первые месяцы после решения, а ответ соседа — позже.
function shortRun(w, n, from = 2) {
  let imp = 0, exp = 0;
  for (let i = 0; i < n; i++) { step(w); if (i >= from) { imp += w.xb.pair['n1>home'] || 0; exp += w.xb.pair['home>n1'] || 0; } }
  return { imp, exp };
}

test('соседи: пошлина на страну роняет торговлю с ней, сосед отвечает пошлиной; остальные не отвечают', { timeout: 120000 }, () => {
  for (const seed of [2, 3]) {
    const ctl = shortRun(game(seed), 8), hit = game(seed);
    setTradeWith(hit, 'n1', { tariff: 0.4 });
    const h = shortRun(hit, 8);
    assert.ok(h.imp < 0.6 * ctl.imp, `seed ${seed}: импорт из n1 ${h.imp} против ${ctl.imp}`);
    assert.ok(h.exp < 0.8 * ctl.exp, `seed ${seed}: наш экспорт к n1 ${h.exp} против ${ctl.exp}`);
    run(hit, 52);
    const s = neighborSummary(hit);
    assert.ok(s[0].theirTariff >= 0.2, 'сосед не ответил пошлиной: ' + s[0].theirTariff);
    assert.ok(s[1].theirTariff < 0.05 && s[2].theirTariff < 0.05, 'остальные соседи не должны отвечать');
    assert.ok(hit.events.some(e => e.type === 'neighbor_tariff'));
    // снимаем пошлину — ответная смягчается
    setTradeWith(hit, 'n1', { tariff: 0 });
    run(hit, 60);
    assert.ok(neighborSummary(hit)[0].theirTariff < 0.1, 'ответная пошлина не смягчилась');
    for (const x of countries(hit)) assert.ok(inv(x) < 1e-9);
  }
});

test('соседи: эмбарго сводит торговлю со страной к нулю, сосед отвечает эмбарго и снимает его не сразу', { timeout: 120000 }, () => {
  const ctl = run(game(2), 48), w = game(2);
  setTradeWith(w, 'n3', { embargo: true });
  run(w, 48);
  const before = pair(ctl, 'n3', 'home') + pair(ctl, 'home', 'n3');
  const after = pair(w, 'n3', 'home') + pair(w, 'home', 'n3');
  assert.ok(before > 0 && after < 0.02 * before + 1e-6, `торговля с n3 после эмбарго: ${after}, без него ${before}`);
  assert.ok(neighborSummary(w)[2].theirEmbargo, 'сосед не ответил эмбарго');
  assert.ok(!neighborSummary(w)[0].theirEmbargo);
  setTradeWith(w, 'n3', { embargo: false });
  run(w, 3);
  assert.ok(neighborSummary(w)[2].theirEmbargo, 'обида должна жить дольше самого эмбарго');
  run(w, 14);
  assert.ok(!neighborSummary(w)[2].theirEmbargo);
  run(w, 24);
  assert.ok(pair(w, 'n3', 'home') + pair(w, 'home', 'n3') > 0.2 * before, 'торговля не восстановилась');
});

test('соседи: открытые границы и большой разрыв жизни дают переезд в нужную сторону, закрытые — нет', { timeout: 180000 }, () => {
  const mk = (emig, immig) => {
    const w = game(2, 24);
    applyPreset(w, 'failed');       // жить дома заметно хуже, чем у соседей
    w.policies.emigrationAllowed = emig;
    w.neighbors.forEach(n => { n.world.policies.immigration = immig; });
    return run(w, 96);
  };
  const open = mk(true, 'open');
  const out = migs(open, 'home');
  const back = Object.entries(open.xb.migTotal).filter(([k]) => k.endsWith('>home')).reduce((a, [, v]) => a + v, 0);
  assert.ok(out >= 15 && out > 3 * back, `уехали ${out}, приехали ${back}`);
  // человек физически переехал: население упало у нас и выросло у соседей, деньги сошлись
  const N0 = 500;
  const nb = open.neighbors.reduce((a, n) => a + n.world.households.length, 0);
  assert.ok(open.households.length < N0 && nb > 3 * 140 - 5);
  open.households.forEach((h, i) => assert.equal(h.id, i + 1));
  for (const x of countries(open)) { x.households.forEach((h, i) => assert.equal(h.id, i + 1)); assert.ok(inv(x) < 1e-9); }
  assert.ok(open.phenomena.active.brain_drain || open.xb.mig.some(m => m.skilled), 'нет квалифицированных среди переселенцев');
  const shut = mk(false, 'open');
  assert.equal(migs(shut, 'home'), 0, 'выезд запрещён, а уехали');
  const closed = mk(true, 'closed');
  assert.equal(migs(closed, 'home'), 0, 'иммиграция закрыта, а приехали');
});

test('соседи: капитал уходит туда, где надёжнее права собственности, и не уходит под контролем', { timeout: 180000 }, () => {
  const out = c => Object.entries(c.xb.capTotal).filter(([k]) => k.startsWith('home>')).reduce((a, [, v]) => a + v, 0);
  const pre = new Map();   // капитал мог уйти ещё в прогреве 24 мес. при обычных рычагах дома: считаем только поток после включения контроля
  const mk = cc => {
    const w = game(2, 24);
    pre.set(cc, out(w));
    applyPreset(w, 'failed');
    w.policies.capitalControls = cc;
    w.neighbors.forEach(n => { n.world.policies.foreignInvestment = 'open'; });
    return run(w, 60);
  };
  const open = mk(0), shut = mk(1);
  assert.ok(out(open) - pre.get(0) > 100, 'капитал не ушёл: ' + (out(open) - pre.get(0)));
  assert.equal(out(shut), pre.get(1));
  assert.ok(open.flows.capital_flight >= 0);
  // запрет иностранных инвестиций у получателей закрывает целевой канал
  const ban = game(2, 24);
  const out0 = out(ban);   // капитал мог уйти и до запрета, в прогреве 24 мес. при обычных рычагах дома
  applyPreset(ban, 'failed');
  ban.neighbors.forEach(n => { n.world.policies.foreignInvestment = 'banned'; });
  run(ban, 60);
  assert.equal(out(ban), out0);
  for (const x of countries(open)) assert.ok(inv(x) < 1e-9);
});

test('соседи: торговая война распознаётся в журнале явлений', { timeout: 120000 }, () => {
  const w = game(2, 24);
  for (const n of w.neighbors) setTradeWith(w, n.id, { tariff: 0.5 });
  run(w, 48);
  assert.ok(w.phenomena.active.trade_war, 'торговая война не распознана');
  assert.ok(w.phenomena.active.trade_war.facts.length > 0);
});

test('соседи: чужие технологии приходят от конкретного соседа, эмбарго их закрывает', { timeout: 180000 }, () => {
  let from = [], w;
  for (const seed of [2, 3, 4, 5]) {   // у соседей технологии появляются редко: берём первый сид, где за 25 лет что-то перешло границу
    w = run(game(seed, 0), 300);
    from = w.tech.list.filter(t => t.fromCountry);
    if (from.length) break;
  }
  assert.ok(from.length >= 1 && from.every(t => t.origin === 'foreign' && w.neighbors.some(n => n.id === t.fromCountry)));
  const e = game(2, 0);
  for (const n of e.neighbors) setTradeWith(e, n.id, { embargo: true });
  run(e, 300);
  assert.equal(e.tech.list.filter(t => t.fromCountry).length, 0);
});

test('соседи: тик игрока вместе с соседями укладывается в бюджет (цель 8 мс, в тесте запас на параллельный прогон)', { timeout: 120000 }, () => {
  const w = newGame({ seed: 8 });
  run(w, 60);
  // npm test гоняет файлы параллельно, поэтому берём лучшую из шести серий (на одном ядре с соседними файлами тестов)
  let ms = Infinity;
  for (let k = 0; k < 6; k++) { const t0 = performance.now(); run(w, 30); ms = Math.min(ms, (performance.now() - t0) / 30); }
  assert.ok(ms < 12, 'шаг занимает ' + ms.toFixed(2) + ' мс');
});

test('соседи: 50 лет подряд без падений, NaN и гиперинфляции у игрока; соседи не уходят в гиперинфляцию', { timeout: 300000 }, () => {
  for (const seed of [2, 3]) {   // на этих сидах раньше: гиперинфляция у игрока и падение в tech.js
    const w = newGame({ seed, preset: 'industrial', mail: false });
    let u = 0, inf = 0, n = 0, maxInf = 0;
    for (let t = 0; t < 600; t++) {
      step(w);
      if (t >= 60) { u += w.stats.unemployment; inf += w.stats.inflation; maxInf = Math.max(maxInf, w.stats.inflation); n++; }
      if (t % 60 === 59) for (const x of countries(w)) { assert.ok(Number.isFinite(x.stats.gdp) && x.stats.gdp > 0, `seed ${seed}, месяц ${t}: ВВП ${x.stats.gdp}`); assert.ok(inv(x) < 1e-9); }
    }
    assert.ok(u / n > 0.02 && u / n < 0.12, `seed ${seed}: средняя безработица игрока ${u / n}`);
    assert.ok(inf / n < 0.06 && maxInf < 0.5, `seed ${seed}: инфляция игрока ${inf / n}, максимум ${maxInf}`);
    for (const nb of w.neighbors) assert.ok(nb.world.stats.cpi < 500, `seed ${seed}: ${nb.name} ушла в гиперинфляцию, cpi ${nb.world.stats.cpi}`);
  }
});

test('соседи: Среднегория на seed 3 не схлопывается за 15 лет (дефицит торговли не душит импорт нужного)', { timeout: 120000 }, () => {
  const w = newGame({ seed: 3, preset: 'industrial', mail: false });
  const sd = w.neighbors.find(n => n.presetId === 'socdem');
  let bad = 0, fxMax = 0;
  for (let i = 0; i < 180; i++) {
    step(w);
    if (i >= 36 && sd.world.stats.unemployment > 0.5) bad++;
    fxMax = Math.max(fxMax, sd.world.abroad.fx);
  }
  const alive = sd.world.firms.filter(f => f.alive).length;
  assert.ok(bad <= 12, 'безработица выше 50% дольше года: ' + bad + ' мес.');
  assert.ok(sd.world.stats.unemployment < 0.4, 'в конце безработица ' + sd.world.stats.unemployment);
  assert.ok(alive >= 15, 'фирм осталось ' + alive);
  assert.ok(fxMax < 100, 'курс ушёл в гиперинфляцию: ' + fxMax);
  assert.ok(w.stats.unemployment < 0.2, 'у игрока безработица ' + w.stats.unemployment);
});
