// Соседние страны (GDD §3.5, §4.5).
//
// Устройство. world.neighbors = [{ id, name, presetId, label, world }]: мини-миры (меньше домохозяйств), которые считаются
// тем же движком (tickCore) и не имеют собственных соседей. У каждой страны — своя валюта, свой moneySupply и свой
// инвариант totalCash === moneySupply; «заграница» каждой страны (world.abroad) — это остальные страны.
// Все торговые потоки идут только через счета abroad по курсам стран. Месяц игрока:
//   1. beginMonth: собираем цены (в «мировых единицах» = цена / курс), курсы и запасы всех стран; для каждой страны решаем,
//      кто кому и сколько везёт (planTrade): импортёр выбирает поставщиков по цене с пошлинами, экспортёр ограничен выпуском.
//      Итог — world.abroad.plan у каждой страны: мировая цена, итоговая пошлина, объёмы импорта и экспорта.
//   2. tickCore игрока, затем tickCore каждого соседа — они исполняют план (экспорт отгружается первым, импорт приходит по заказу).
//   3. endMonth: зеркальные проводки. Всё, что страна отправила на счёт abroad и не относится к торговле (вывоз капитала,
//      проценты, лицензии, деньги переселенцев), в мировых единицах появляется у других стран: их abroad платит фирмам
//      и домохозяйствам (или, при обратном потоке, их фирмы и домохозяйства платят на abroad). Деньги нигде не рождаются:
//      каждая проводка — pay() внутри одной страны, а сумма по странам в мировых единицах сохраняется. Расхождения
//      (торговый зазор: цена поставки за месяц сдвинулась; незакрытое: у контрагента нет денег) считаются явно в xb.
//   4. Потоки капитала за доходностью, миграция, ответные меры соседей, учёт для интерфейса.
import { GOODS, IND, P, SKILLED } from './systems/params.js';
import { INDUSTRIES, PROFESSIONS, createWorld } from './schema.js';
import { POLICY_PRESETS, buildPolicies } from './presets.js';
import { populate } from './init.js';
import { tickCore } from './tick.js';
import { analyze } from './analytics/index.js';
import { pay } from './ledger.js';
import { rand } from './rng.js';
import { clamp, addEvent } from './systems/util.js';
import { importPull } from './systems/market.js';

const TRADABLE = GOODS.filter(g => IND[g].tradable);
const IND_LABEL = Object.fromEntries(INDUSTRIES.map(i => [i.id, i.label]));
const PROF_IDS = PROFESSIONS.map(p => p.id);

export const DEFAULT_NEIGHBORS = ['minarchy', 'planned', 'socdem'];
const COUNTRY_NAMES = { minarchy: 'Лавония', planned: 'Госплания', socdem: 'Среднегория' };
// Местный колорит соседей: страны выдуманные, рычаги слегка отличаются от эталонного набора.
// (Мини-миры на 140 домохозяйств устойчивее с этими значениями; эталоны presets.js калибруются на полных мирах.)
const COUNTRY_TWEAKS = {
  socdem: { unionPower: 1, firingCost: 2 },   // Среднегория: профсоюзы сильнее, увольнять проще
  planned: { pensionLevel: 0.4 },              // Госплания: пенсии скромнее
};
/** Исходный набор рычагов соседа: эталонный пресет плюс местный колорит. */
export function neighborPolicies(pid) {
  const preset = POLICY_PRESETS.find(p => p.id === pid);
  return preset ? Object.assign(buildPolicies(preset), COUNTRY_TWEAKS[pid]) : null;
}
const SPARE_NAMES = ['Нейтралия', 'Умеренная Республика', 'Тихие Земли', 'Пограничье', 'Серединное Княжество'];
export const NEIGHBOR_HOUSEHOLDS = 140;

// ───────────────────────── создание ─────────────────────────

export function freshBook() {
  return { ver: 1, fx0: {}, A0: {}, fxTrend: {}, lanes: {}, pair: {}, pairEma: {}, expEma: {}, capInEma: {}, tradeGap: 0, tradeGapM: 0, tradeVolM: 0,
    unmatched: 0, unmatchedM: 0, mirrorM: 0, Q: {}, mig: [], migTotal: {}, capTotal: {}, capM: {}, react: {}, imported: {}, logT: {} };
}

/** Создаёт соседей и подвязывает мир игрока к ним. ids — id наборов рычагов (presets.js). */
export function createNeighbors(world, ids, opts = {}) {
  const list = [];
  const used = new Set();
  const nH = opts.neighborHouseholds || NEIGHBOR_HOUSEHOLDS;
  const structure = opts.neighborStructure || 'industrial';
  ids.forEach((pid, k) => {
    const preset = POLICY_PRESETS.find(p => p.id === pid);
    if (!preset) throw new Error('нет набора рычагов для соседа: ' + pid);
    let name = COUNTRY_NAMES[pid] || SPARE_NAMES[k % SPARE_NAMES.length];
    while (used.has(name)) name += ' II';
    used.add(name);
    const seed = ((world.seed ?? 1) * 7919 + 101 * (k + 1)) | 0;
    const nw = createWorld({ seed, preset: structure });
    nw.policies = neighborPolicies(pid);
    nw.lite = true;                       // у соседей нет почты и журнала явлений
    nw.hardBudget = true;                 // и бездонной заграницы: казна платит только деньгами, которые у неё есть
    populate(nw, { preset: structure, households: nH });
    analyze(nw);
    list.push({ id: 'n' + (k + 1), name, presetId: pid, label: preset.label, world: nw });
  });
  world.neighbors = list;
  world.xb = freshBook();
  // стартовые курсы: уровень цен торгуемых товаров в мировых единицах у всех стран одинаков (паритет покупательной способности на старте);
  // дальше разницу цен, вызванную политикой, торговля и реальный курс отрабатывают сами
  const all = [world, ...list.map(n => n.world)];
  const lm = all.map(w => TRADABLE.reduce((a, g) => a + Math.log(w.markets[g].price || 1), 0) / TRADABLE.length);
  const mean = lm.reduce((a, b) => a + b, 0) / lm.length;
  all.forEach((w, i) => { w.abroad.fx = Math.exp(lm[i] - mean); w.abroad.fxCal = w.abroad.fx; w.abroad.reserves *= w.abroad.fx; });
  return world;
}

const countries = world => [{ id: 'home', name: 'Наша страна', w: world }, ...world.neighbors.map(n => ({ id: n.id, name: n.name, w: n.world, n }))];
const twOf = (w, id) => w.policies.tradeWith?.[id] || EMPTY;
const EMPTY = Object.freeze({});
const closed = (a, b) => !!(twOf(a.w, b.id).embargo || twOf(b.w, a.id).embargo);

// ───────────────────────── планирование торговли ─────────────────────────

function buckets(w) {
  const b = {};
  for (const g of TRADABLE) b[g] = { fs: [], capSum: 0, pw: 0, prod: 0, uc: 0, pmean: 1 };
  for (const f of w.firms) {
    if (!f.alive) continue;
    const x = b[f.industry];
    if (!x) continue;
    x.fs.push(f);
    const cap = Math.max(f.capacity || 0, 1e-6);
    x.capSum += cap; x.pw += cap * f.price; x.prod += f.output || 0; x.uc += f.unitCost || 0;
  }
  for (const g of TRADABLE) { const x = b[g]; x.pmean = x.capSum > 0 ? x.pw / x.capSum : (w.markets[g].price || 1); }
  return b;
}

/** Доля импорта в спросе при данной цене — та же формула, что у продавцов в market.js (sellerWeights). */
function softShare(w, bk, g, pI) {
  const eps = P.priceEps;
  let tot = 0;
  for (const f of bk.fs) tot += Math.max(f.capacity || 0, 1e-6) * Math.exp(-eps * (f.price / bk.pmean - 1));
  const wImp = w.ind[g].impK * importPull(w, g) * bk.capSum * Math.exp(-eps * (pI / bk.pmean - 1));
  const s = tot + wImp > 0 ? wImp / (tot + wImp) : 0;
  const prev = w.ind[g].impShare;
  return prev >= 0 && prev != null ? P.shareInertia * prev + (1 - P.shareInertia) * s : s;
}

function planTrade(world, cs) {
  const xb = world.xb;
  const A = world.assumptions;
  const eps = 6 * (A.tradeSensitivity ?? 1);
  const BK = cs.map(c => buckets(c.w));
  const plans = cs.map(() => ({ wp: {}, tEff: {}, impQ: {}, expQ: {}, wpExp: {} }));
  const lanes = {};
  const pair = {};
  const QUOTA_SHARE = 0.03;
  const SCARCE = 0.05;      // нехватка товара на внутреннем рынке, выше которой импорт считается жизненно необходимым
  const stage = {};
  for (const g of TRADABLE) {
    const ex = cs.map((c, i) => {
      const w = c.w, ip = w.policies.industry[g], d = ip.exportDuty;
      const bk = BK[i][g];
      const banned = d >= 0.98 || (g === 'vice' && w.policies.vicePolicy === 'banned');
      const shortage = w.markets[g].shortage || 0;
      const cap = banned ? 0 : 0.4 * bk.prod * (1 - clamp(8 * (shortage - 0.01), 0, 1));
      const pw = (w.markets[g].price || 0) / w.abroad.fx;
      return { cap, pw, tau: d < 0.98 ? d / (1 - d) : 0, ok: cap > 1e-9 && pw > 0 };
    });
    const want = [];
    cs.forEach((cj, j) => {
      const w = cj.w, ip = w.policies.industry[g], bk = BK[j][g];
      const cand = [];
      for (let i = 0; i < cs.length; i++) {
        if (i === j || !ex[i].ok || closed(cs[i], cj)) continue;
        const tar = (1 + ip.tariff) * (1 + (twOf(w, cs[i].id).tariff || 0)) - 1;
        const pwl = ex[i].pw * (1 + ex[i].tau);
        cand.push({ i, pwl, tar, landed: pwl * (1 + tar) });
      }
      if (!cand.length) return;
      let minL = Infinity;
      for (const c of cand) minL = Math.min(minL, c.landed);
      let ws = 0, lw = 0, pw = 0;
      for (const c of cand) {
        c.wgt = ex[c.i].cap * Math.exp(-eps * (c.landed / minL - 1));
        ws += c.wgt; lw += c.wgt * c.landed; pw += c.wgt * c.pwl;
      }
      if (!(ws > 0)) return;
      const wpbar = pw / ws, tbar = lw / pw - 1;
      const pI = wpbar * w.abroad.fx * (1 + tbar);
      // допуск импорта — как в prepTrade: запрет «грешных» товаров и потолок цены ниже импортной цены
      if (g === 'vice' && w.policies.vicePolicy === 'banned') return;
      if (ip.priceCap > 0 && bk.fs.length && pI > ip.priceCap * (bk.uc / bk.fs.length)) return;
      const D = w.markets[g].demand || 0;
      const M = D * softShare(w, bk, g, pI);
      const rj = cj.n ? xb.react[cj.id] : null;
      for (const c of cand) {
        let q = (M * c.wgt) / ws;
        // квота соседа на нашу продукцию (ответ на демпинг)
        if (rj && cs[c.i].id === 'home' && (rj.quota?.[g] || -1) > world.t) q = Math.min(q, (QUOTA_SHARE * D * c.wgt) / ws);
        if (q > 1e-9) want.push({ i: c.i, j, q, pwl: c.pwl, tar: c.tar });
      }
    });
    stage[g] = { ex, want };
  }
  // кредит заграницы конечен: дефицит торговли страны не больше ~4% её выпуска плюс то, что приносит экспорт и чистый приток капитала.
  // Иначе импорт дешевле выпуска душит местные фирмы бесконечно, ЦБ печатает деньги на безработицу, и страна уходит в гиперинфляцию.
  // Но валюту, которой не хватает на всё, тратят в первую очередь на то, чего дома не хватает (сырьё и товары, по которым у страны дефицит):
  // без них встают отрасли, которые их покупают, и дефицит растёт вместе с безработицей. Урезается прежде всего импорт, вытесняющий местных продавцов.
  cs.forEach((cj, j) => {
    let Vn = 0, Vs = 0;
    const needs = {};
    for (const g of TRADABLE) {
      needs[g] = (cj.w.markets[g].shortage || 0) > SCARCE;
      for (const x of stage[g].want) if (x.j === j) { if (needs[g]) Vn += x.q * x.pwl; else Vs += x.q * x.pwl; }
    }
    const V = Vn + Vs;
    const fx = cj.w.abroad.fx;
    const room = (xb.expEma[cj.id] || 0) + 0.04 * (cj.w.stats.gdp || 0) / fx + Math.max(0, xb.capInEma[cj.id] || 0);
    if (!(V > room && V > 0)) return;
    const kN = Vn > room ? room / Vn : 1;
    const kS = Vs > 0 ? clamp((room - Vn) / Vs, 0, 1) : 1;
    for (const g of TRADABLE) for (const x of stage[g].want) if (x.j === j) x.q *= needs[g] ? kN : kS;
  });
  for (const g of TRADABLE) {
    const { ex, want } = stage[g];
    // экспортёр не может вывезти больше, чем выпускает
    for (let i = 0; i < cs.length; i++) {
      let tot = 0;
      for (const x of want) if (x.i === i) tot += x.q;
      if (tot > ex[i].cap && tot > 0) { const k = ex[i].cap / tot; for (const x of want) if (x.i === i) x.q *= k; }
    }
    const impQ = cs.map(() => 0), impV = cs.map(() => 0), impT = cs.map(() => 0), expQ = cs.map(() => 0);
    const lane = [];
    for (const x of want) {
      impQ[x.j] += x.q; impV[x.j] += x.q * x.pwl; impT[x.j] += x.q * x.pwl * x.tar; expQ[x.i] += x.q;
      lane.push({ from: cs[x.i].id, to: cs[x.j].id, q: x.q, p: x.pwl });
      const key = cs[x.i].id + '>' + cs[x.j].id;
      pair[key] = (pair[key] || 0) + x.q * x.pwl;
    }
    lanes[g] = lane;
    cs.forEach((c, i) => {
      const pl = plans[i];
      pl.impQ[g] = impQ[i]; pl.expQ[g] = expQ[i];
      pl.wp[g] = impQ[i] > 0 ? impV[i] / impQ[i] : 0;
      pl.tEff[g] = impV[i] > 0 ? impT[i] / impV[i] : 0;
      // цена, по которой экспортёр мог бы продать (для паритета ресурсов): лучшая из открытых стран без их пошлины
      let best = 0;
      cs.forEach((cj, j) => {
        if (j === i || closed(c, cj)) return;
        const wj = cj.w;
        const pj = (wj.markets[g].price || 0) / wj.abroad.fx;
        best = Math.max(best, pj / ((1 + wj.policies.industry[g].tariff) * (1 + (twOf(wj, c.id).tariff || 0))));
      });
      pl.wpExp[g] = best;
    });
  }
  cs.forEach((c, i) => {
    const ab = c.w.abroad;
    ab.plan = plans[i];
    for (const g of TRADABLE) ab.worldPrice[g] = plans[i].wp[g] || 0;
  });
  xb.lanes = lanes;
  xb.pair = pair;
}

// ───────────────────────── начало и конец месяца ─────────────────────────

export function beginMonth(world) {
  const xb = world.xb || (world.xb = freshBook());
  const cs = countries(world);
  for (const c of cs) { xb.fx0[c.id] = c.w.abroad.fx; xb.A0[c.id] = c.w.abroad.cash; }
  planTrade(world, cs);
  // уровень цен у партнёров в мировых единицах: к нему тянется курс (паритет покупательной способности)
  cs.forEach((ci, i) => {
    let a = 0, n = 0;
    cs.forEach((cj, j) => { if (j !== i) { a += Math.log(Math.max(1e-3, cj.w.stats.cpi || 1) * (cj.w.abroad.fxCal || 1) / cj.w.abroad.fx); n++; } });
    ci.w.abroad.pppRef = Math.exp(a / Math.max(1, n));
  });
  // сколько иностранных денег страна может привлечь в этом месяце (кредит государству, возврат капитала): то, что есть у соседей сверх запаса
  const cap = cs.map(c => spareCash(c.w) / c.w.abroad.fx);
  cs.forEach((ci, i) => {
    let a = 0;
    cs.forEach((cj, j) => { if (j !== i && !closed(ci, cj)) a += 0.3 * cap[j]; });
    ci.w.abroad.avail = a * ci.w.abroad.fx;
  });
}

export function endMonth(world) {
  const cs = countries(world);
  const xb = world.xb;
  for (const n of world.neighbors) tickCore(n.world);
  // что за месяц прошло через счета abroad (в валюте страны) и какая часть — торговля
  const dA = {}, trade = {};
  let gap = 0, vol = 0;
  for (const c of cs) {
    const ab = c.w.abroad, lt = ab.lastTrade || { imports: 0, exports: 0, duty: 0 };
    dA[c.id] = ab.cash - xb.A0[c.id];
    trade[c.id] = lt.imports - lt.exports - lt.duty;
    gap += trade[c.id] / xb.fx0[c.id];
    vol += (lt.imports + lt.exports) / xb.fx0[c.id];
  }
  for (const c of cs) {
    xb.expEma[c.id] = 0.7 * (xb.expEma[c.id] || 0) + 0.3 * (c.w.abroad.lastTrade?.exports || 0) / xb.fx0[c.id];
  }
  xb.tradeGapM = gap; xb.tradeGap += gap; xb.tradeVolM = vol;
  xb.unmatchedM = 0; xb.mirrorM = 0;
  xb.capM = {};
  for (const n of world.neighbors) {
    if (world.t % 3 === 0 || !n.world.stats.classes?.length) analyze(n.world);
    const ab = n.world.abroad;
    const prev = xb.fxTrend[n.id] || 0;
    xb.fxTrend[n.id] = 0.9 * prev + 0.1 * 12 * Math.log(ab.fx / Math.max(1e-9, xb.fx0[n.id]));
  }
  xb.fxTrend.home = 0.9 * (xb.fxTrend.home || 0) + 0.1 * 12 * Math.log(world.abroad.fx / Math.max(1e-9, xb.fx0.home));
  mirrorResiduals(world, cs, dA, trade);
  capitalFlows(world, cs);
  migration(world, cs);
  reactions(world, cs);
  bookkeeping(world, cs);
}

// ───────────────────────── зеркальные проводки ─────────────────────────

function openness(w) {
  const m = w.policies.foreignInvestment;
  return m === 'banned' ? 0 : m === 'limited' ? 0.4 : 1;
}

/** Привлекательность для капитала: реальная ставка с поправкой на защиту собственности, рост и ожидаемое обесценивание. */
function attractiveness(world, c) {
  const w = c.w, pol = w.policies, st = w.stats;
  const pr = clamp(pol.propertyRights * (1 - 0.5 * w.gov.crime) * (1 - 0.4 * clamp(w.shock.expropriation, 0, 1)), 0.05, 1);
  const real = w.bank.rate - clamp(st.inflation || 0, -0.05, 1);
  const dep = Math.max(0, world.xb.fxTrend[c.id] || 0);
  // доходность минус премия за риск: слабые права собственности, преступность и теневая экономика съедают любую ставку
  return real * (0.4 + 0.6 * pr) - 0.12 * (1 - pr) - 0.08 * w.gov.crime - 0.03 * Math.max(0, w.gov.corruption - 0.4) + 0.15 * clamp(st.gdpGrowth || 0, -0.1, 0.2) - 0.7 * dep;
}

function payFirms(c, amt, kind) {
  const w = c.w;
  let cand = w.firms.filter(f => f.alive && f.owner === 'private' && f.util > 0.8);
  if (!cand.length) cand = w.firms.filter(f => f.alive && f.owner === 'private');
  if (!cand.length) cand = w.firms.filter(f => f.alive);
  if (!cand.length) return 0;
  const each = amt / cand.length;
  for (const f of cand) pay(w, w.abroad, f, each, kind);
  return amt;
}

function payHouseholds(c, amt, kind) {
  const w = c.w;
  let tot = 0;
  for (const h of w.households) tot += Math.max(0, h.cash);
  if (!(tot > 0)) return 0;
  for (const h of w.households) {
    const a = (amt * Math.max(0, h.cash)) / tot;
    if (a > 0) { pay(w, w.abroad, h, a, kind); h.incomeBySource.capital += a; }
  }
  return amt;
}

/** Деньги на руках у домохозяйств и фирм страны сверх разумного запаса: то, что она может отдать за границу. */
function excessRows(w) {
  const med = Math.max(1, w.stats.medianWage || 1);
  const rows = [];
  let ex = 0;
  for (const h of w.households) { const e = h.cash - 6 * Math.max(h.netIncome || 0, med); if (e > 0) { rows.push([h, e]); ex += e; } }
  for (const f of w.firms) { if (!f.alive || f.owner === 'state') continue; const e = f.cash - 3 * Math.max(1, (f.revenue || 0) * 0.5); if (e > 0) { rows.push([f, e]); ex += e; } }
  return { rows, ex };
}
const spareCash = w => excessRows(w).ex;

/**
 * Деньги остальных стран уходят на их abroad (они платят стране i): берём у домохозяйств и фирм сверх запаса, у каждой страны
 * пропорционально её возможностям (не больше 35% излишка). Возвращает собранное в мировых единицах.
 */
function collectFor(cs, i, needW, kind, fx0) {
  const src = [];
  let cap = 0;
  cs.forEach((cj, j) => {
    if (j === i) return;
    const { rows, ex } = excessRows(cj.w);
    if (ex > 0) { src.push({ cj, rows, ex }); cap += 0.35 * ex / fx0[cj.id]; }
  });
  if (!(cap > 0)) return 0;
  const f = Math.min(1, needW / cap);
  let got = 0;
  for (const { cj, rows } of src) for (const [o, e] of rows) got += pay(cj.w, o, cj.w.abroad, 0.35 * e * f, kind) / fx0[cj.id];
  return got;
}

/**
 * Деньги, ушедшие на abroad страны i не по торговле, у остальных стран появляются зеркально (и наоборот).
 * В мировых единицах (сумма / курс на начало месяца) проводки сходятся в ноль; что не удалось, учтено в xb.unmatched.
 */
function mirrorResiduals(world, cs, dA, trade) {
  const xb = world.xb;
  const flightOf = c => Math.max(0, c.w.flows.capital_flight || 0);
  const att = cs.map(c => attractiveness(world, c));
  cs.forEach((ci, i) => {
    const R = dA[ci.id] - trade[ci.id];
    xb.capInEma[ci.id] = 0.8 * (xb.capInEma[ci.id] || 0) + 0.2 * (-R / xb.fx0[ci.id]);   // чистый приток иностранных денег: им можно финансировать дефицит торговли
    if (Math.abs(R) < 1e-9) return;
    const wU = R / xb.fx0[ci.id];          // мировые единицы
    if (R > 0) {
      const cap = Math.min(R, flightOf(ci)) / xb.fx0[ci.id];
      const rest = wU - cap;
      for (const [part, mode] of [[cap, 'cap'], [rest, 'gen']]) {
        if (!(part > 1e-12)) continue;
        const wts = cs.map((cj, j) => {
          if (j === i) return 0;
          if (mode === 'cap') return closed(ci, cj) ? 0 : openness(cj.w) * Math.exp(6 * (att[j] - Math.max(...att)));
          return Math.sqrt(cj.w.households.length);
        });
        let sum = wts.reduce((a, b) => a + b, 0);
        let m = mode;
        if (!(sum > 0) && mode === 'cap') {
          // прямым вложениям везде закрыто: деньги достаются соседям вкладами и кредитами (домохозяйствам и фирмам поровну)
          cs.forEach((cj, j) => { wts[j] = j === i ? 0 : Math.sqrt(cj.w.households.length); });
          sum = wts.reduce((a, b) => a + b, 0); m = 'gen';
        }
        if (!(sum > 0)) { xb.unmatched += part; xb.unmatchedM += part; continue; }
        cs.forEach((cj, j) => {
          if (!wts[j]) return;
          const amt = (part * wts[j] / sum) * xb.fx0[cj.id];
          if (m === 'cap') payFirms(cj, amt, 'border_in');
          else { payFirms(cj, amt * 0.5, 'border_in'); payHouseholds(cj, amt * 0.5, 'border_in'); }
          xb.mirrorM += amt / xb.fx0[cj.id];
        });
      }
    } else {
      // деньги пришли в страну i из-за границы (вернулся капитал, иностранцы дали в долг): платят остальные страны
      const need = -wU;
      const taken = collectFor(cs, i, need, 'border_out', xb.fx0);
      xb.mirrorM += taken;
      xb.unmatched -= need - taken; xb.unmatchedM -= need - taken;
    }
  });
}

/** Капитал уходит туда, где реальная доходность и защита собственности лучше (если выезд капитала и вход открыты). */
function capitalFlows(world, cs) {
  const xb = world.xb;
  const A = world.assumptions;
  const mob = 0.01 * (A.capitalMobility ?? 1);
  if (!(mob > 0)) return;
  const att = cs.map(c => attractiveness(world, c));
  cs.forEach((ci, i) => {
    const w = ci.w, cc = w.policies.capitalControls || 0;
    if (cc >= 1) return;
    let best = -1, bestGap = 0.003;
    cs.forEach((cj, j) => {
      if (j === i || closed(ci, cj) || openness(cj.w) <= 0) return;
      const gp = att[j] - att[i];
      if (gp > bestGap) { bestGap = gp; best = j; }
    });
    if (best < 0) return;
    const cj = cs[best];
    const med = Math.max(1, w.stats.medianWage || 1);
    const rows = [];
    let ex = 0;
    for (const h of w.households) { const e = h.cash - 10 * Math.max(h.netIncome || 0, med); if (e > 0) { rows.push(h); ex += e; } }
    if (!(ex > 0)) return;
    const frac = clamp(mob * bestGap / 0.02, 0, 0.05) * (1 - cc) * openness(cj.w);
    let moved = 0;
    for (const h of rows) { const e = h.cash - 10 * Math.max(h.netIncome || 0, med); moved += pay(w, h, w.abroad, e * frac, 'capital_flight'); }
    if (!(moved > 0)) return;
    const wU = moved / xb.fx0[ci.id];
    payFirms(cj, wU * xb.fx0[cj.id], 'border_in');
    const key = ci.id + '>' + cj.id;
    xb.capTotal[key] = (xb.capTotal[key] || 0) + wU;
    xb.capM[key] = (xb.capM[key] || 0) + wU;
  });
}

// ───────────────────────── люди ─────────────────────────

function removeHousehold(w, h) {
  const hh = w.households;
  const idx = h.id - 1;
  const last = hh[hh.length - 1];
  hh.pop();
  if (last !== h) {
    // последний занимает освободившийся номер: в коде id - 1 — это индекс
    const oldId = last.id;
    last.id = h.id;
    hh[idx] = last;
    for (const fid in last.shares) {
      const f = w.firms.find(x => x.id === +fid);
      if (f) { delete f.holders[oldId]; f.holders[last.id] = true; }
    }
  }
  w.nextHouseholdId = hh.length + 1;
}

function addHousehold(w, h) {
  h.id = w.households.length + 1;
  w.households.push(h);
  w.nextHouseholdId = h.id + 1;
}

const IMMIGRATION_OPEN = { closed: 0, quota: 0.25, open: 1 };

function qualityOfLife(c) {
  const w = c.w, basket = Math.max(1e-9, w.stats.basicBasketCost || 1);
  const sum = {}, cnt = {};
  for (const h of w.households) {
    if (h.status === 'retired') continue;
    sum[h.profession] = (sum[h.profession] || 0) + (h.netIncome || 0);
    cnt[h.profession] = (cnt[h.profession] || 0) + 1;
  }
  const q = {};
  for (const p of PROF_IDS) if (cnt[p] >= 3) q[p] = sum[p] / cnt[p] / basket;
  return q;
}

function migration(world, cs) {
  const xb = world.xb;
  const pull = world.assumptions.migrationPull ?? 1;
  if (!(pull > 0)) return;
  // сглаженные «качества жизни» по профессиям (чистый доход / корзина)
  for (const c of cs) {
    const q = qualityOfLife(c);
    const e = (xb.Q[c.id] ||= {});
    for (const p of PROF_IDS) if (q[p] !== undefined) e[p] = e[p] === undefined ? q[p] : 0.85 * e[p] + 0.15 * q[p];
  }
  const moves = [];
  cs.forEach((ci, i) => {
    const w = ci.w;
    if (!w.policies.emigrationAllowed) return;
    const qi = xb.Q[ci.id];
    // кандидатов смотрим один раз на профессию
    const best = {};
    for (const p of PROF_IDS) {
      if (p === 'official' || qi[p] === undefined) continue;
      let bj = -1, bs = 0;
      cs.forEach((cj, j) => {
        if (j === i) return;
        const open = IMMIGRATION_OPEN[cj.w.policies.immigration ?? 'quota'];
        const qj = xb.Q[cj.id]?.[p];
        if (!open || qj === undefined) return;
        const score = (qj / Math.max(0.05, qi[p]) - 1.2) * open;     // 20% разницы съедают переезд, язык и тоска по дому
        if (score > bs) { bs = score; bj = j; }
      });
      if (bj >= 0) best[p] = { j: bj, score: bs };
    }
    for (const h of w.households) {
      const b = best[h.profession];
      if (!b || h.status === 'retired' || h.age > 55 || h.profession === 'official') continue;
      if (h.status === 'self' || h.marginDebt > 0 || h.bonds > 0 || Object.keys(h.shares).length) continue;   // владельцы и должники привязаны к месту
      const mob = 0.5 + (SKILLED[h.profession] || 0);
      const pr = clamp(0.008 * pull * mob * b.score * (h.status === 'unemployed' ? 1.5 : 1), 0, 0.05);
      if (rand(w) < pr) moves.push({ i, j: b.j, h });
    }
  });
  for (const m of moves) moveHousehold(world, cs, m.i, m.j, m.h);
}

function moveHousehold(world, cs, i, j, h) {
  const xb = world.xb;
  const ci = cs[i], cj = cs[j];
  const rec = { t: world.t, from: ci.id, to: cj.id, prof: h.profession, skilled: (SKILLED[h.profession] || 0) > 0.5 };
  // деньги переезжают через счета abroad по курсу
  const amt = Math.max(0, h.cash);
  if (amt > 0) pay(ci.w, h, ci.w.abroad, amt, 'capital_flight');
  removeHousehold(ci.w, h);
  Object.assign(h, { status: 'unemployed', employerId: null, wage: 0, income: 0, netIncome: 0, retrain: null, platformId: null, displacedT: null,
    jobSearch: 0, shares: {}, bonds: 0, marginDebt: 0, pension: 0, needsMet: {}, incomeBySource: { wage: 0, capital: 0, transfer: 0, business: 0 } });
  addHousehold(cj.w, h);
  if (amt > 0) pay(cj.w, cj.w.abroad, h, (amt / xb.fx0[ci.id]) * xb.fx0[cj.id], 'border_in');
  rec.cash = amt / xb.fx0[ci.id];
  xb.mig.push(rec);
  if (xb.mig.length > 600) xb.mig.splice(0, xb.mig.length - 500);
  const key = ci.id + '>' + cj.id;
  xb.migTotal[key] = (xb.migTotal[key] || 0) + 1;
}

// ───────────────────────── ответные меры соседей ─────────────────────────

const meanTariff = w => TRADABLE.reduce((a, g) => a + w.policies.industry[g].tariff, 0) / TRADABLE.length;

function reactions(world, cs) {
  const xb = world.xb;
  const k = world.assumptions.retaliation ?? 1;
  const home = cs[0];
  for (const n of world.neighbors) {
    const nw = n.world;
    const R = (xb.react[n.id] ||= { embargoUntil: -1, quota: {}, dumpM: {}, tariffSeen: 0 });
    const twH = twOf(world, n.id);
    const twN = ((nw.policies.tradeWith ||= {}).home ||= { tariff: 0, embargo: false });
    // эмбарго за эмбарго: после снятия обида живёт ещё год
    if (twH.embargo) {
      R.embargoUntil = world.t + 12;
      if (k > 0 && !twN.embargo) { twN.embargo = true; addEvent(world, 'neighbor_embargo', `${n.name} отвечает эмбарго: торговля закрыта в обе стороны, зато симметрично`, { id: n.id }); }
    } else if (twN.embargo && world.t >= R.embargoUntil) {
      twN.embargo = false;
      addEvent(world, 'neighbor_embargo_end', `${n.name} снимает эмбарго: обида прошла, склады — нет`, { id: n.id });
    }
    // пошлина за пошлину: сосед отвечает, когда наши пошлины на его товары выше его собственных больше чем на 10 п.п.
    const pt = (1 + meanTariff(world)) * (1 + (twH.tariff || 0)) - 1;
    const own = meanTariff(nw);
    const target = k > 0 ? clamp(k * Math.max(0, (1 + pt) / (1 + own) - 1 - 0.1), 0, 1.2) : 0;
    let cur = twN.tariff || 0;
    cur += target > cur ? 0.25 * (target - cur) : 0.08 * (target - cur);
    cur = Math.abs(cur) < 0.005 ? 0 : Math.round(cur * 100) / 100;
    twN.tariff = cur;
    if (cur >= R.tariffSeen + 0.1) {
      R.tariffSeen = cur;
      addEvent(world, 'neighbor_tariff', `${n.name} вводит ответную пошлину на наши товары: ${Math.round(cur * 100)}%. Взаимность — тоже форма уважения`, { id: n.id, tariff: cur });
    } else if (cur < R.tariffSeen - 0.1) {
      R.tariffSeen = cur;
      if (cur < 0.05) addEvent(world, 'neighbor_tariff_end', `${n.name} смягчает ответную пошлину до ${Math.round(cur * 100)}%: торговля тихо оживает`, { id: n.id, tariff: cur });
    }
    // демпинг: наши товары заметно дешевле их собственных и занимают заметную долю их рынка — квота
    for (const g of TRADABLE) {
      const lane = (xb.lanes[g] || []).find(l => l.from === 'home' && l.to === n.id);
      const D = nw.markets[g].demand || 0;
      const cheap = lane && D > 0 && lane.q / D >= 0.06 && lane.p < 0.8 * ((nw.markets[g].price || 0) / nw.abroad.fx);
      R.dumpM[g] = cheap ? (R.dumpM[g] || 0) + 1 : 0;
      if (R.dumpM[g] >= 3 && (R.quota[g] || -1) <= world.t && k > 0) {
        R.quota[g] = world.t + 18;
        addEvent(world, 'neighbor_quota', `${n.name} вводит квоту на наш импорт (${IND_LABEL[g].toLowerCase()}): обвиняет в демпинге. Мы это называем эффективностью`, { id: n.id, good: g });
      }
    }
  }
}

// ───────────────────────── учёт для интерфейса и тестов ─────────────────────────

function bookkeeping(world, cs) {
  const xb = world.xb;
  const keys = new Set([...Object.keys(xb.pair), ...Object.keys(xb.pairEma)]);
  for (const key of keys) xb.pairEma[key] = 0.9 * (xb.pairEma[key] || 0) + 0.1 * (xb.pair[key] || 0);
}

export { neighborSummary, setTradeWith } from './neighbors-info.js';
