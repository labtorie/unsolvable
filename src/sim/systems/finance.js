// Вторая волна: финансы и пузыри (GDD 3.8, 4.6). Вызывается из tick.js после techPhase.
// Пишет: f.value, f.valueHist, f.fundamental, f.stakes, f.stakeHolders, f.vendorLoans, f.circularRevenue,
// hh.marginDebt, hh.pension, world.finance (+ вспомогательные поля из schema.js, помеченные «блоком Финансы»).
//
// Устройство (всё — общие правила агентов, никаких проверок «какой сейчас год»):
//  1. Оценка. f.fundamental = 0,8 × чистые активы + дисконтированная прибыль (по ставке банка + премия) + доли в других фирмах.
//     f.value = оценка собственного бизнеса × множитель ожиданий + доли. Множитель = exp(продление роста выручки на горизонт
//     лет × extrapolation + стадность × настроение рынка). Настроение (−1..+1) подпитывается самим ростом индекса, кредитом
//     под залог и гаснет от принудительных продаж, подорожавшего кредита и «усталости» от завышенных оценок.
//  2. Меню фирмы со свободными деньгами: каждое действие получает оценку годовой доходности и сравнивается с остальными:
//     мощности (firms.js), поглощение (конкурента, поставщика/клиента, стартапа), вложение в клиента, кредит клиенту на
//     покупку своего товара, выплата владельцам (по умолчанию). Исследования и долгие контракты не моделируются здесь.
//  3. Круговая выручка: деньги, которые фирма вложила в клиента (f.tied у клиента) или одолжила ему под свой товар, возвращаются
//     к ней как выручка. Считаем f.circularRevenue и world.finance.circularShare.
//  4. Залог акций: домохозяйства и фирмы берут в банке до marginLimit × стоимость своих долей, при падении цен банк требует
//     вернуть кредит → принудительные продажи (margin_calls) → цены падают ниже.
//  5. Пенсионный фонд: взносы 2% зарплат (деньги работников, бюджет не затронут), pensionEquityShare — доля в акциях;
//     права домохозяйств (hh.pension) пропорциональны стоимости фонда: при обвале пенсионеры теряют.
//  6. Банк: капитал (учётная величина) съедается убытками по кредитам; при дефиците капитала банк душит кредит и требует
//     погашения; при неплатёжеспособности работает bailoutPolicy. Спасение повышает moralHazard (больше рычаг на годы).
import { pay, mint, burn } from '../ledger.js';
import { rand, randInt } from '../rng.js';
import { IND, GOODS, P } from './params.js';
import { clamp, addEvent, safePay, fmt } from './util.js';
import { creditRoom, borrow, repay, bankRoom } from './firms.js';
import { acquire } from './structure.js';
import { createWorld, makeFirm, makeHousehold } from '../schema.js';
import * as O from './ownership.js';

const q = n => '«' + n + '»';
const mean = (a, i0, i1) => { let s = 0; for (let i = i0; i < i1; i++) s += a[i]; return s / Math.max(1, i1 - i0); };

// настроечные константы блока (не «допущения» для игрока)
const K_TARGET = 0.09;        // целевой капитал банка / кредиты
const PENSION_RATE = 0.015;    // взносы в фонд от зарплаты
const PENSION_PAYOUT = 1 / 150; // доля прав, выплачиваемая пенсионеру в месяц
const ACQ_RATE = 0.007;       // вероятность, что фирма в месяц присматривается к покупке
const STAKE_RATE = 0.12;      // вероятность присмотреться к вложению в клиента/кредиту клиенту

// ───────────────────────── общие помощники ─────────────────────────

export function effMarginLimit(world) {
  const fin = world.finance;
  // залог акций работает, пока суд заставит должника расстаться с залогом: без защиты собственности банки под акции не кредитуют
  const enforce = clamp(world.policies.propertyRights / 0.6, 0.15, 1);
  // налог на сделки делает плечо дорогим для всех (и для домохозяйств, и для фирм): лимит сжимается
  const tax = clamp(1 - 60 * (world.policies.financialTransactionTax || 0), 0.1, 1);
  const L = world.policies.marginLimit * (1 + 0.4 * (fin.moralHazard || 0)) * (1 - 0.7 * (fin.bankCrunch || 0)) * enforce * tax;
  return clamp(L, 0, 0.95);
}

function stakeCollateral(world, ctx, holder, k) {
  const m = k === 'h' ? holder.shares : holder.stakes;
  let c = 0;
  for (const id in m) { const f = ctx.F[id]; if (f && f.alive) c += m[id] * O.priceOf(f, ctx); }
  return c;
}

/** Сколько ещё разрешено занять банком под залог долей домохозяйства (деньги). */
export function marginRoom(world, ctx, h) {
  const L = effMarginLimit(world);
  return Math.max(0, L * stakeCollateral(world, ctx, h, 'h') - h.marginDebt);
}

/** Какую часть разрешённого лимита домохозяйство готово использовать: в спокойном рынке немного, в эйфории почти весь (стадность × настроение). */
export function marginAppetite(world) {
  const fin = world.finance;
  // налог на сделки делает частые покупки в долг дорогими: аппетит падает
  const ftt = clamp(1 - 60 * (world.policies.financialTransactionTax || 0), 0.1, 1);
  return clamp(0.15 + 0.7 * Math.max(0, world.assumptions.herding * fin.sentiment - 0.4) / 0.6, 0.15, 0.85) * ftt;
}

/** Взять кредит под залог долей до желаемой доли лимита; frac — какую долю недостающего берём за месяц. Деньги создаёт банк. Возвращает сумму. */
export function marginBorrow(world, ctx, h, frac) {
  const L = effMarginLimit(world);
  const want = marginAppetite(world) * L * stakeCollateral(world, ctx, h, 'h') - h.marginDebt;
  // потолок на всю страну: долг под залог не может раздуться больше определённой доли капитализации (банки держат запас для остальных)
  const sysRoom = Math.max(0, 0.12 * (world.policies.marginLimit / 0.9) * world.finance.totalValue - world.finance.marginDebt);
  const a = Math.min(Math.max(0, want) * frac, bankRoom(world), sysRoom);
  if (!(a > 1e-6)) return 0;
  world.finance.marginDebt += a;
  mint(world, h, a, 'loans');
  world.bank.loans += a;
  h.marginDebt += a;
  return a;
}

function firmBuffer(world, f) {
  const pol = world.policies;
  return 1.3 * (Math.max(f.wageBill * (1 + pol.payrollTax) + f.inputUsed, 0.8 * f.target * f.unitCost) + 20);
}

// ───────────────────────── вторичный рынок (принудительные продажи) ─────────────────────────

function buildPool(world, ctx) {
  const pool = [];
  for (const h of world.households) {
    const thr = 6 * Math.max(h.netIncome, ctx.medWage);
    if (h.cash > thr) pool.push({ h, room: 0.6 * (h.cash - thr) });
  }
  return pool;
}

/**
 * Продажа доли frac фирмы f продавцом (k, seller) покупателям из пула богатых домохозяйств по цене unit за 100% (уже со скидкой).
 * Возвращает полученные деньги.
 */
function secondarySale(world, ctx, fx, k, seller, f, frac, unit, flow) {
  const pool = fx.pool || (fx.pool = buildPool(world, ctx));
  let R = 0;
  for (const b of pool) if (b.h !== seller && b.room > 0) R += b.room;
  if (!(R > 1e-9) || !(frac > 0)) return 0;
  const want = frac * unit;
  const got = Math.min(want, R);
  const fr = frac * got / want;
  for (const b of pool) {
    if (b.h === seller || !(b.room > 0)) continue;
    const part = (got * b.room) / R;
    const paid = safePay(world, b.h, seller, part, flow);
    b.room -= part;
    if (paid > 0) O.payFtt(world, b.h, paid);
    O.addHolding('h', b.h, f, fr * part / got);
  }
  O.addHolding(k, seller, f, -fr);
  return got;
}

/** Принудительное сокращение долга под залог: сначала деньги, потом продажа долей, потом списание. */
function deleverage(world, ctx, fx, k, o, target) {
  const bank = world.bank, fin = world.finance;
  let need = o.marginDebt - target;
  if (!(need > 0)) return;
  const useCash = Math.min(Math.max(0, o.cash), need);
  if (useCash > 0) { burn(world, o, useCash, 'margin_calls'); bank.loans -= useCash; o.marginDebt -= useCash; need -= useCash; }
  if (need > 1e-6) {
    const m = k === 'h' ? o.shares : o.stakes;
    const rows = [];
    for (const id in m) { const f = ctx.F[id]; if (f && f.alive) rows.push([f, m[id]]); }
    rows.sort((a, b) => b[1] * O.priceOf(b[0], ctx) - a[1] * O.priceOf(a[0], ctx));
    for (const [f, fr] of rows) {
      if (!(need > 1e-6)) break;
      const unit = O.priceOf(f, ctx) * (1 - fx.disc);
      const frac = Math.min(fr, need / Math.max(1e-9, unit));
      const got = secondarySale(world, ctx, fx, k, o, f, frac, unit, 'margin_calls');
      if (!(got > 0)) continue;
      burn(world, o, got, 'margin_calls');
      bank.loans -= got; o.marginDebt -= got; need -= got;
      fx.forced += got;
      fx.disc = clamp(0.03 + 0.35 * fx.forced / (0.04 * fin.totalValue + 1), 0.03, 0.45);
    }
  }
  // осталась задолженность, а забрать нечего: банк списывает убыток
  if (o.marginDebt > 1e-6 && stakeCollateral(world, ctx, o, k) < 0.02 * o.marginDebt) {
    const loss = o.marginDebt;
    bank.loans -= loss; bank.defaults += loss; ctx.defaultsNow += loss;
    o.marginDebt = 0;
    fx.writeoffs += loss;
  }
}

// ───────────────────────── оценка, индекс, настроение ─────────────────────────

function valuation(world, ctx, fx) {
  const fin = world.finance, A = world.assumptions;
  const cu = ctx.capUnit;
  const rate = world.bank.rate;
  const rEff = rate + 0.03;
  const horizon = 4 * clamp(0.12 / (rate + 0.05), 0.5, 2.2);   // на сколько лет вперёд инвесторы продлевают рост; дешёвые деньги удлиняют
  const extr = A.extrapolation, herd = A.herding;
  const s = fin.sentiment;
  const live = fx.live;
  const n = live.length;
  const first = fin.indexHist.length === 0;
  const prev = new Float64Array(n), opsOld = new Float64Array(n);
  const gs = [];
  // проход 1: прибыль, рост, собственный бизнес
  for (let i = 0; i < n; i++) {
    const f = live[i];
    prev[i] = f.value; opsOld[i] = f.opsValue;
    const div = ctx.divRecv ? (ctx.divRecv[f.id] || 0) : 0;
    const rep = f.profit + f.extra + div;
    f.extra = 0;
    f.profitEMA = first && f.valueHist.length === 0 ? f.profit : f.profitEMA + 0.035 * (rep - f.profitEMA);
    if (first || f.revHist.length === 0) { f.revHist = new Array(12).fill(f.revenue); }
    else { f.revHist.push(f.revenue); if (f.revHist.length > 24) f.revHist.shift(); }
    const len = f.revHist.length;
    let g = 0;
    if (len >= 12) {
      const mo = mean(f.revHist, 0, 6), mr = mean(f.revHist, len - 6, len);
      g = Math.log((mr + 1) / (mo + 1)) * 12 / (len - 6);
    }
    f.growth += 0.3 * (clamp(g, -0.6, 1) - f.growth);
    if (len >= 18) gs.push(f.growth);
  }
  if (gs.length >= 3) { gs.sort((a, b) => a - b); fin.growthMed += 0.2 * (gs[gs.length >> 1] - fin.growthMed); }
  const g0 = fin.growthMed;
  for (let i = 0; i < n; i++) {
    const f = live[i];
    const gross = f.capital * cu;
    let vend = 0, vdebt = 0;
    for (const id in f.vendorLoans) vend += f.vendorLoans[id];
    for (const id in f.vendorDebt) vdebt += f.vendorDebt[id];
    const book = gross * 0.85 + f.cash - f.debt - f.marginDebt + 0.8 * vend - vdebt;
    const E = 12 * f.profitEMA;
    const pv = clamp(E > 0 ? E / Math.max(0.04, rEff - 0.025) : E / (rEff + 0.3), -0.3 * gross, 0.6 * gross);
    const fund = Math.max(0.1 * gross, 0.9 * Math.max(0.12 * gross, book) + 0.25 * pv);
    const conf = Math.min(1, f.revHist.length / 24);
    const x = clamp(extr * horizon * 0.35 * (clamp(f.growth, -0.4, 0.6) - g0) * conf + 0.10 * herd * s, -0.8, 1.5);
    f.fundOps = fund;
    f.opsValue = fund * Math.exp(x);
  }
  // проход 2: доли в других фирмах и итоговая цена
  let tv = 0, tf = 0, prof = 0, num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    const f = live[i];
    let sv = 0, sf = 0, gain = 0;
    for (const id in f.stakes) {
      const b = ctx.F[id];
      if (!b || !b.alive || b.owner !== 'private') continue;
      const fr = f.stakes[id];
      sv += fr * b.opsValue; sf += fr * (b.fundOps || b.opsValue);
      const j = fx.idx[id];
      if (j !== undefined) gain += fr * (b.opsValue * (1 - b.raised) - opsOld[j]);
    }
    // переоценка доли записывается в прибыль на следующий месяц (на бумаге — тоже прибыль)
    f.extra += 0.7 * clamp(gain, -3 * f.revenue - 1, 3 * f.revenue + 1);
    f.fundamental = (f.fundOps || 0) + sf;
    f.value = f.opsValue + sv;
    f.valueHist.push(f.value);
    if (f.valueHist.length > 24) f.valueHist.shift();
    if (f.parent) { f.raised = 0; f.divPaid = 0; continue; }   // дочерние фирмы в капитализацию и индекс не входят: они уже внутри стоимости родителя
    tv += f.value; tf += f.fundamental; prof += Math.max(0, 12 * f.profitEMA);
    if (prev[i] > 1 && !first) {
      const r = clamp((f.value * (1 - f.raised) + f.divPaid) / prev[i] - 1, -0.5, 1);   // доходность акции: цена с поправкой на разводнение + дивиденды
      num += prev[i] * r; den += prev[i];
    }
    f.raised = 0; f.divPaid = 0;
  }
  for (const f of world.firms) if (f.alive && f.owner !== 'private' && f.value !== 0) { f.value = 0; f.fundamental = 0; f.opsValue = 0; }
  fin.totalValue = tv;
  fin.pe = tv / Math.max(1, prof);
  fin.ratio = tv / Math.max(1, tf);
  fx.indexRet = den > 0 ? num / den : 0;
}

function sentimentAndIndex(world, ctx, fx) {
  const fin = world.finance, A = world.assumptions, pol = world.policies;
  const herd = A.herding;
  fin.index *= 1 + fx.indexRet;
  if (!(fin.rateRef > 0)) fin.rateRef = world.bank.rate;
  const h = fin.indexHist;
  h.push(fin.index);
  if (h.length > 36) h.shift();
  const len = h.length;
  const mom = len > 12 ? Math.log(h[len - 1] / h[len - 13]) : 0;
  let s = fin.sentiment;
  const target = clamp(1.1 * herd * Math.tanh(mom / 0.25), -1, 1);
  s += 0.15 * (target - s);
  // кредит под залог разгоняет мании: растёт доля долга в капитализации
  const mr = fin.marginDebt / Math.max(1, fin.totalValue);
  s += 1.5 * (mr - (fx.prevMarginRatio ?? mr));
  // усталость от завышенных оценок
  s -= 0.03 * herd * Math.max(0, fin.ratio - 1.6);
  // дорожающие деньги остужают
  const dr = world.bank.rate - fin.rateRef;
  fin.rateRef += 0.05 * dr;
  s -= 4 * Math.max(0, dr);
  fin.sentiment = clamp(s, -1, 1);
  fx.prevMarginRatio = mr;
  // просадка, обвалы, рекорды
  let peak = 0;
  for (const v of h) if (v > peak) peak = v;
  fin.peak = peak;
  const dd = peak > 0 ? 1 - fin.index / peak : 0;
  fin.drawdown = dd;
  if (dd >= 0.3 && !fin.inCrash) {
    fin.inCrash = true; fin.inCorrection = true;
    fin.crashesTotal++; fin.crashT.push(world.t);
    addEvent(world, 'crash', `Обвал: фондовый индекс просел на ${Math.round(dd * 100)}% от максимума. «На этот раз всё иначе», — говорили все, кроме учебников`, { drawdown: dd });
  } else if (dd >= 0.2 && !fin.inCorrection) {
    fin.inCorrection = true; fin.corrections++;
    addEvent(world, 'correction', `Коррекция: индекс потерял ${Math.round(dd * 100)}% — аналитики называют это здоровой, пока она не затронула их портфель`, { drawdown: dd });
  }
  if (dd < 0.12) { fin.inCrash = false; fin.inCorrection = false; }
  while (fin.crashT.length && fin.crashT[0] <= world.t - 12) fin.crashT.shift();
  fin.crashes = fin.crashT.length;
  if (fin.index > (fx.recordRef ?? 0) * 1.0 && h.length >= 12) {
    if (world.t - fin.lastRecordT >= 36 && fin.index > 1.1 * (fx.recordRef ?? 0) && (fx.recordRef ?? 0) > 0) {
      fin.lastRecordT = world.t;
      addEvent(world, 'index_record', `Индекс обновил рекорд: ${fmt(fin.index)}. Таксисты уже советуют, во что вкладываться`, { index: fin.index });
    }
  }
  fin.recordMax = Math.max(fin.recordMax || 0, fin.index);
  fx.recordRef = fin.recordMax;
}

// ───────────────────────── залог акций ─────────────────────────

function marginStep(world, ctx, fx) {
  const fin = world.finance, bank = world.bank, pol = world.policies;
  const L = effMarginLimit(world);
  const call = L > 0 ? Math.min(0.97, L * 1.25) : 0;
  const rateM = bank.rate / 12;
  const sent = fin.sentiment;
  const appetite = marginAppetite(world);
  let total = 0;
  const handle = (k, o, thr) => {
    if (!(o.marginDebt > 0)) return;
    const due = o.marginDebt * rateM;
    const paid = safePay(world, o, bank, due, 'interest');
    if (due > paid) { o.marginDebt += due - paid; bank.loans += due - paid; }   // неоплаченный процент капитализируется в долг
    const C = stakeCollateral(world, ctx, o, k);
    if (o.marginDebt > call * C) deleverage(world, ctx, fx, k, o, 0.8 * L * C);
    else if (k === 'h' && o.marginDebt > (appetite + 0.1) * L * C && o.cash > thr) {
      // охладев, долг гасят сами: он не должен превышать желаемой доли лимита
      const a = Math.min(o.marginDebt - appetite * L * C, 0.3 * (o.cash - thr));
      if (a > 0) { burn(world, o, a, 'repayments'); bank.loans -= a; o.marginDebt -= a; }
    }
    total += o.marginDebt;
  };
  for (const h of world.households) if (h.marginDebt > 0) handle('h', h, 6 * Math.max(h.netIncome, ctx.medWage));
  for (const f of fx.live) if (f.marginDebt > 0) handle('f', f, firmBuffer(world, f));
  fin.marginDebt = total;
  fin.forcedSales = fx.forced;
  if (fx.forced > 0) {
    // принудительные продажи давят на настроение рынка
    fin.sentiment = clamp(fin.sentiment - 4 * fx.forced / Math.max(1, fin.totalValue), -1, 1);
    if (fx.forced > 0.004 * fin.totalValue && world.t - fin.lastMarginEventT >= 6) {
      fin.lastMarginEventT = world.t;
      addEvent(world, 'margin_call', `Маржин-колл: банки потребовали вернуть кредиты под залог акций, продано на ${fmt(fx.forced)} — «временно, до отскока»`, { forced: fx.forced });
    }
  }
}

// ───────────────────────── пенсионный фонд ─────────────────────────

function pensionStep(world, ctx, fx) {
  const fin = world.finance, pol = world.policies, hh = world.households;
  const fund = fin.pensionFund;
  // взносы работников: 3% зарплаты, из них pensionEquityShare уходит в фонд (и сразу в акции, т.е. возвращается в оборот через фирмы),
  // остальное остаётся на счёте работника (безрисковая часть накоплений); бюджет не затронут
  const share = pol.pensionEquityShare;
  for (const h of hh) {
    if (h.status !== 'employed' || !(h.wage > 0) || h.cash < 4 * h.wage) continue;   // откладывают только те, у кого есть запас
    const c = PENSION_RATE * h.wage;
    h.pension += safePay(world, h, fund, share * c, 'equity_purchases');
  }
  // выплаты пенсионерам: часть накопленных прав в месяц
  let need = 0;
  for (const h of hh) if (h.status === 'retired' && h.pension > 0) need += h.pension * PENSION_PAYOUT;
  // при нехватке денег фонд продаёт часть акций
  if (fund.cash < 1.5 * need) sellFundStakes(world, ctx, fx, 2.5 * need - fund.cash);
  const k = need > 0 ? Math.min(1, fund.cash / need) : 0;
  if (k > 0) {
    for (const h of hh) {
      if (h.status !== 'retired' || !(h.pension > 0)) continue;
      const a = h.pension * PENSION_PAYOUT * k;
      const paid = safePay(world, fund, h, a, 'dividends');
      h.pension -= paid;
      h.incomeBySource.transfer += paid;
    }
  }
  // деньги фонда (доля pensionEquityShare взносов; остальное уже ушло в облигации на имя участников) вкладываются в акции;
  // запас на выплаты — 6 месяцев
  let sv = 0;
  for (const id in fund.stakes) { const f = ctx.F[id]; if (f && f.alive) sv += fund.stakes[id] * O.priceOf(f, ctx); }
  const surplus = fund.cash - 6 * need;
  const herd = world.assumptions.herding, gm = fin.growthMed;
  if (surplus > 1) {
    const buy = surplus * 0.5;
    const cand = [];
    for (let i = 0; i < 8 && fx.live.length; i++) { const c = fx.live[randInt(world, fx.live.length)]; if (!c.parent) cand.push(c); }
    // фонд любит растущее: вес — стоимость × e^(стадность × рост выше фона)
    cand.sort((a, b) => b.value * Math.exp(2 * herd * clamp((b.growth || 0) - gm, -0.3, 0.6)) - a.value * Math.exp(2 * herd * clamp((a.growth || 0) - gm, -0.3, 0.6)));
    const top = cand.slice(0, 4);
    for (const f of top) { if (f.alive) O.issueShares(world, ctx, f, 'p', fund, buy / top.length, 'equity_purchases'); }
  }
  sv = 0;
  for (const id in fund.stakes) { const f = ctx.F[id]; if (f && f.alive) sv += fund.stakes[id] * O.priceOf(f, ctx); }
  fund.value = fund.cash + sv;
  // права домохозяйств = доли в стоимости фонда: падает рынок — падают пенсии
  let R = 0;
  for (const h of hh) R += h.pension;
  fin.pensionRights = R;
  if (R > 1e-9) { const kk = fund.value / R; for (const h of hh) h.pension *= kk; fin.pensionRights = fund.value; }
}

function sellFundStakes(world, ctx, fx, amount) {
  const fund = world.finance.pensionFund;
  const rows = [];
  for (const id in fund.stakes) { const f = ctx.F[id]; if (f && f.alive) rows.push([f, fund.stakes[id]]); }
  rows.sort((a, b) => b[1] * O.priceOf(b[0], ctx) - a[1] * O.priceOf(a[0], ctx));
  let need = amount;
  for (const [f, fr] of rows) {
    if (!(need > 1)) break;
    const unit = O.priceOf(f, ctx) * (1 - fx.disc);
    const frac = Math.min(fr, need / Math.max(1e-9, unit));
    const got = secondarySale(world, ctx, fx, 'p', fund, f, frac, unit, 'equity_purchases');
    if (!(got > 0)) break;
    need -= got;
  }
}

// ───────────────────────── банк: капитал, зажим кредита, крах, спасение ─────────────────────────

function bankStep(world, ctx, fx) {
  const fin = world.finance, bank = world.bank, pol = world.policies, gov = world.gov;
  const loans = Math.max(1, bank.loans);
  if (fin.bankCapital === 0 && fin.indexHist.length <= 1) { fin.bankCapital = K_TARGET * loans; fin.lastDefaults = bank.defaults; fin.defEMA = 0.0; }
  fin.moralHazard *= 0.992;   // «нас всё равно спасут» забывается за годы
  const dD = Math.max(0, bank.defaults - fin.lastDefaults);
  fin.lastDefaults = bank.defaults;
  const expected = fin.defEMA || 0;
  fin.defEMA = expected * 0.96 + dD * 0.04;
  // прибыль от процента частично остаётся в капитале; обычные потери заложены в ставку, сверхобычные съедают капитал
  fin.bankCapital += 0.3 * (world.flows.interest || 0) - 0.6 * Math.max(0, dD - expected);
  if (fin.bankCapital < K_TARGET * loans) fin.bankCapital += 0.04 * (K_TARGET * loans - fin.bankCapital);
  fin.bankCapital = Math.min(fin.bankCapital, 0.14 * loans);
  if (fin.bankCapital < 0) bankFailure(world, ctx, fx);
  const ratio = fin.bankCapital / loans;
  const panic = clamp((fin.drawdown - 0.25) / 0.35, 0, 1) * 0.5;
  const failure = fin.bankFailedT > -900 ? Math.pow(0.975, world.t - fin.bankFailedT) : 0;
  const crunch = Math.max(clamp((0.04 - ratio) / 0.035, 0, 1), panic, failure);
  fin.bankCrunch += 0.4 * (crunch - fin.bankCrunch);
  fx.callIn = Math.max(failure, panic);
  // банк требует вернуть часть кредитов
  if (fx.callIn > 0.08) {
    for (const f of fx.live) {
      if (!(f.debt > 1)) continue;
      const req = fx.callIn * 0.03 * f.debt;
      const free = Math.max(0, f.cash - 0.5 * firmBuffer(world, f));
      const paid = repay(world, f, Math.min(req, free));
      if (fx.callIn > 0.3 && req - paid > 0.5 * req && f.profit < 0) f.lossMonths++;
    }
  }
}

function bankFailure(world, ctx, fx) {
  const fin = world.finance, bank = world.bank, pol = world.policies, gov = world.gov, hh = world.households;
  const loans = Math.max(1, bank.loans);
  const face = fx.live.filter(f => f.industry === 'finance').sort((a, b) => b.capital - a.capital)[0];
  const name = face ? q(face.name) : 'банковская система';
  fin.bankFailures++;
  fin.bankFailedT = world.t;
  if (pol.bailoutPolicy === 'never') {
    // вкладчики теряют: убыток сверх капитала списывается с вкладов (деньги на счетах сгорают пропорционально остаткам)
    const loss = -fin.bankCapital;
    let H = 0;
    for (const h of hh) H += Math.max(0, h.cash);
    const hair = clamp(loss / Math.max(1, H), 0, 0.25);
    for (const h of hh) if (h.cash > 0) burn(world, h, h.cash * hair, 'repayments');
    fin.bankCapital = 0.02 * loans;
    addEvent(world, 'bank_failure', `Банк ${name} лопнул, государство не стало спасать: вкладчики узнали, что страховка — это состояние души (потеряно ${Math.round(hair * 100)}% остатков на счетах)`, { loss, hair });
  } else {
    const need = K_TARGET * loans - fin.bankCapital;
    pay(world, gov, bank, need, 'bailouts');
    fin.bankCapital = K_TARGET * loans;
    fin.bailoutsTotal += need;
    fin.moralHazard = Math.min(1.5, fin.moralHazard + 0.7);
    fin.bankFailedT = world.t - 20;   // паника короче: дыру закрыли
    addEvent(world, 'bailout', `Банк ${name} слишком большой, чтобы упасть: бюджет закрыл дыру в ${fmt(need)}. Прибыль, как обычно, осталась частной`, { need });
  }
}

/** Спасение фирмы бюджетом вместо банкротства. true — спасена. */
export function bailoutFirm(world, ctx, f) {
  const pol = world.policies, fin = world.finance;
  const mode = pol.bailoutPolicy;
  if (mode === 'never' || f.owner !== 'private') return false;
  if (world.t - f.bailedT < 36) return false;
  let ok = mode === 'always';
  if (!ok) {
    // системно значимые: крупнейшая фирма опорной отрасли (энергия, финансы, добыча) или фирма с заметной долей всей капитализации
    let cap = 0, big = true;
    for (const x of ctx.by[f.industry]) if (x.alive) { cap += x.capital; if (x.capital > f.capital) big = false; }
    const pillar = f.industry === 'energy' || f.industry === 'finance' || f.industry === 'mining';
    ok = (pillar && big && f.capital > 0.3 * cap) || f.value > 0.08 * fin.totalValue;
  }
  if (!ok) return false;
  // не чаще раза в полгода на всю страну, иначе бюджет превращается в страховой фонд
  if (mode !== 'always' && world.t - fin.lastFirmBailT < 6) return false;
  const gov = world.gov;
  const mc = Math.max(f.wageBill * (1 + pol.payrollTax) + f.inputUsed, 0) + 20;
  const need = 0.6 * f.debt + 2 * mc;
  fin.lastFirmBailT = world.t;
  pay(world, gov, f, need, 'bailouts');
  repay(world, f, 0.6 * f.debt);
  f.lossMonths = 0;
  f.bailedT = world.t; f.bailouts++;
  fin.bailoutsTotal += need;
  fin.moralHazard = Math.min(1.5, fin.moralHazard + 0.12);
  if (world.t - fin.lastBailEventT >= 4) {
    fin.lastBailEventT = world.t;
    addEvent(world, 'bailout', `Бюджет выручил ${q(f.name)}: слишком крупная, чтобы упасть, и слишком важная, чтобы её наказывать`, { firm: f.id, need });
  }
  return true;
}

/** Что происходит с цепочками долей и кредитов, когда фирма закрывается. */
export function onFirmClosed(world, ctx, f) {
  const bank = world.bank;
  O.dropOwnStakes(world, ctx, f);
  for (const id in f.vendorLoans) { const b = ctx.F[id]; if (b) delete b.vendorDebt[f.id]; }
  f.vendorLoans = {};
  for (const id in f.vendorDebt) {
    const l = ctx.F[id];
    const sum = f.vendorDebt[id];
    if (l && l.alive) { delete l.vendorLoans[f.id]; l.extra -= 0.9 * sum; }
  }
  f.vendorDebt = {};
  if (f.marginDebt > 0) {
    bank.loans -= f.marginDebt; bank.defaults += f.marginDebt; ctx.defaultsNow += f.marginDebt;
    f.marginDebt = 0;
  }
  f.value = 0; f.opsValue = 0; f.reserve = 0; f.tied = {};
}

// ───────────────────────── меню фирмы ─────────────────────────

function clientsOf(fx, g) {
  if (fx.clients[g]) return fx.clients[g];
  const out = [];
  const capGood = g === 'manufacturing' || g === 'construction';
  for (const f of fx.live) if (capGood || IND[f.industry].inputs[g] > 0) out.push(f);
  return (fx.clients[g] = out);
}

function tradeWeight(a, b) {
  // доля расходов клиента, приходящаяся на отрасль поставщика
  const g = a.industry;
  const inp = IND[b.industry].inputs;
  let w = 0;
  if (inp[g] > 0) { let tot = 0; for (const k in inp) tot += inp[k]; w += 0.6 * inp[g] / tot; }
  if (g === 'manufacturing') w += 0.15; else if (g === 'construction') w += 0.08;
  return Math.min(0.7, w);
}

function acqOption(world, ctx, fx, f, rEff, spare, borrowCap) {
  const pol = world.policies, fin = world.finance;
  const thr = pol.antitrustThreshold;
  const cands = [];
  const peers = fx.byInd[f.industry];
  for (let i = 0; i < 2 && peers.length > 1; i++) cands.push([peers[randInt(world, peers.length)], 'horizontal']);
  if (peers.length > 1 && rand(world) < 0.8) {
    // сильнейший из тех, кого можно проглотить: дорогие сделки между крупными — то, что запрещает антимонопольный порог
    let big = null;
    for (const x of peers) if (x !== f && x.value <= f.value && (!big || x.value > big.value)) big = x;
    if (big) cands.push([big, 'horizontal']);
  }
  const inp = Object.keys(IND[f.industry].inputs);
  // вертикальные поглощения: поставщик или клиент остаётся работать как дочерняя фирма (нужно разрешение владеть чужими акциями)
  if (pol.crossOwnershipCap >= 0.5 && inp.length && rand(world) < 0.4) {
    const g = inp[randInt(world, inp.length)];
    const L = fx.byInd[g];
    if (L && L.length) for (let i = 0; i < 2; i++) cands.push([L[randInt(world, L.length)], 'vertical']);
  }
  if (pol.crossOwnershipCap >= 0.5 && rand(world) < 0.25) {
    const cl = clientsOf(fx, f.industry);
    if (cl.length) cands.push([cl[randInt(world, cl.length)], 'vertical']);
  }
  if (peers.length > 1 && rand(world) < 0.8) {
    // стартап в своей отрасли: молодая и небольшая фирма, пока не выросла в конкурента
    const yp = peers.filter(x => x !== f && world.t - x.bornT <= 72);
    if (yp.length) cands.push([yp[randInt(world, yp.length)], 'startup']);
  }
  const fv = Math.max(1, f.value);
  const bHolders = Object.keys(f.holders).length > 0;
  const barrier = ctx.barrier[f.industry] || 0;
  let best = null;
  for (const [t, kind0] of cands) {
    if (t === f || !t.alive || t.owner !== 'private' || !(t.value > 0) || t.parent || t.parent === f.id) continue;
    const age = world.t - t.bornT;
    const same = t.industry === f.industry;
    const kind = same ? 'horizontal' : 'vertical';
    // пока закон есть, регулятор не пропускает сделку, после которой в отрасли цели остаётся меньше трёх фирм
    if (thr < 0.95 && fx.byInd[t.industry].length - 1 < 3) continue;
    const isStartup = age <= 72 && t.value <= 0.35 * fv;
    if (isStartup && pol.startupAcquisitionBan) continue;
    if (t.value > (same ? 1.0 : 0.7) * fv) continue;
    let shareAfter = f.marketShare;
    if (same) {
      shareAfter = f.marketShare + t.marketShare;
      if (shareAfter > thr + 1e-9) continue;
      // строгость регулятора растёт с понижением порога: чем сильнее сделка повышает концентрацию (ΔHHI = 2·s1·s2), тем реже её одобряют
      const law = clamp((1 - thr) / 0.6, 0, 1.3);
      if (law > 0 && rand(world) > Math.exp(-law * 2 * f.marketShare * t.marketShare / 0.015)) continue;

    } else if (kind === 'vertical' && t.marketShare > thr + 1e-9) continue;
    const Vt = O.priceOf(t, ctx);
    const prem = 0.2 + 0.3 * Math.max(0, t.growth);
    const price = Vt * (1 + prem);
    const rev12 = 12 * t.revenue;
    let gain = Vt * rEff + 0.9 * Math.max(0, 12 * t.profitEMA) * 0.1;
    if (same) {
      gain += 0.03 * rev12;
      const sl = (0.35 + 0.65 * barrier) * 0.75;
      const pw = (sh, rev) => sl * Math.max(0, sh - 0.12) * rev;
      gain += 0.7 * 12 * Math.max(0, pw(shareAfter, f.revenue + t.revenue) - pw(f.marketShare, f.revenue) - pw(t.marketShare, t.revenue));
      // чем крупнее объединённая фирма, тем дороже управлять (издержки масштаба): дальше трети рынка сделки перестают окупаться сами
      gain -= 12 * (f.revenue + t.revenue) * 0.4 * Math.max(0, shareAfter - 0.42);
    } else if (kind === 'vertical') {
      gain += 0.02 * rev12;
      const k = t.industry;
      if (IND[f.industry].inputs[k] > 0) {
        let tot = 0;
        for (const kk in IND[f.industry].inputs) tot += IND[f.industry].inputs[kk] * (ctx.price[kk] || 1);
        const spend = 12 * f.inputUsed * (IND[f.industry].inputs[k] * (ctx.price[k] || 1)) / Math.max(1e-9, tot) * t.marketShare;
        gain += 0.5 * (t.markup / (1 + t.markup)) * spend;
      } else gain += 0.1 * rev12 * Math.max(0, (f.price - f.unitCost) / Math.max(1e-9, f.price));
    }
    if (isStartup && same) { gain += 0.02 * rev12 + 0.25 * Math.max(0, t.growth) * Vt; }
    // у покупателя с завышенной оценкой акции — дешёвая валюта
    const over = f.value / Math.max(1, f.fundamental);
    const cashAvail = spare + borrowCap;
    const cashPart = bHolders ? Math.min(0.4 * price, cashAvail) : price;   // сделка может быть и целиком обменом акциями
    const stockFrac = 1 - cashPart / price;
    const effPrice = price * ((1 - stockFrac) + stockFrac * clamp(1 / over, 0.4, 1));   // акции покупателя — дешёвая валюта, когда их оценка выше «честной»
    const cashNeed = cashPart;
    if (cashNeed > spare + borrowCap + 1e-6) continue;
    const roi = gain / Math.max(1, effPrice);
    const margin = roi - (rEff + 0.01);
    if (!best || margin > best.margin) best = { kind: 'acq', margin, t, akind: kind === 'vertical' ? 'vertical' : isStartup ? 'startup' : 'horizontal', price, stockFrac, shareAfter, cashNeed, effPrice, roi };
  }
  return best;
}

function runMenu(world, ctx, fx) {
  const fin = world.finance, pol = world.policies, A = world.assumptions;
  const rate = world.bank.rate;
  const rEff = rate + 0.03;
  const s = fin.sentiment;
  const gm = fin.growthMed;
  const cu = ctx.capUnit;
  const ftt2 = 2 * (pol.financialTransactionTax || 0);
  const live = fx.live;
  const hurdle0 = rate + 0.09 - 0.05 * Math.max(0, s) * A.herding;
  const capCap = Math.min(pol.crossOwnershipCap, 0.45);
  for (let i = 0; i < live.length; i++) {
    const f = live[i];
    if (!f.alive || f.owner !== 'private' || world.t - f.bornT < 12 || !(f.value > 0) || f.parent) continue;
    const doAcq = rand(world) < ACQ_RATE * (1 + 6 * f.marketShare) * (1 + 0.5 * Math.max(0, s));
    const doTie = rand(world) < STAKE_RATE;
    const doLoan = f.inventory > 0.05 * Math.max(1, f.output) && rand(world) < 0.5;
    if (!doAcq && !doTie && !doLoan) continue;
    // фирма, чью оценку рынок завысил, занимает дешевле и охотнее вкладывается: порог доходности ниже
    const over = clamp(f.value / Math.max(1, f.fundamental) - 1, 0, 1.2);
    const hurdle = hurdle0 - 0.07 * over;
    const buffer = firmBuffer(world, f);
    const spare = f.cash - buffer;
    const room = creditRoom(world, ctx, f);
    const gross = f.capital * cu;
    // базовый вариант — выплатить владельцам: порог доходности; расширение мощностей считает firmFinance, но если оно выгоднее — меню молчит
    let capRoi = -1;
    if (f.util > 0.93 && f.orders > 0.98 * (f.capacity || 1)) capRoi = clamp(12 * f.profitEMA / Math.max(1, 0.7 * gross), -0.1, 0.6);
    let best = null;
    if (doAcq) {
      const o = acqOption(world, ctx, fx, f, rEff, Math.max(0, spare), 0.6 * room);
      if (o) best = o;
    }
    let tieOpt = null, loanOpt = null;
    if ((doTie || doLoan) && f.lossMonths === 0) {
      const cl = clientsOf(fx, f.industry);
      if (cl.length) {
        const b = cl[randInt(world, cl.length)];
        if (b !== f && b.alive && b.owner === 'private' && b.value > 0 && b.lossMonths === 0 && !b.parent) {
          const w = tradeWeight(f, b);
          const margin = clamp((f.price - f.unitCost) / Math.max(1e-9, f.price), 0, 0.5);
          const idle = 1 + 3 * Math.max(0, 0.9 - f.util);
          const gb = clamp(b.growth, -0.4, 0.6);
          // (д1) доля в клиенте
          const frRoom = capCap - (f.stakes[b.id] || 0);
          if (doTie && pol.crossOwnershipCap > 0 && frRoom > 0.02) {
            const yld = Math.max(0, 12 * b.profitEMA) / Math.max(1, b.value);
            const apprec = 0.5 * A.extrapolation * Math.max(0, gb - gm) + 0.12 * Math.max(0, s) * A.herding;
            const score = yld + apprec + w * margin * idle + 0.03 - ftt2;
            tieOpt = { kind: 'stake', margin: score - hurdle, b, frRoom, w };
          }
          // (д2) кредит клиенту на покупку своей продукции: нераспроданный товар (особенно нехранимый) — почти бесплатная выручка
          if (doLoan && !pol.vendorFinancingBan) {
            const owe = Object.values(b.vendorDebt).reduce((a, x) => a + x, 0);
            const headroom = 0.5 * b.capital * cu - owe;
            const risk = 0.03 + 0.25 * b.lossMonths / 10 + 0.1 * clamp(b.debt / Math.max(1, 0.3 * b.capital * cu), 0, 1);
            const idleFrac = Math.min(1, f.inventory / Math.max(1, f.sales + f.inventory));
            const score = rate + 0.03 + 0.7 * idleFrac * (0.2 + margin) + 0.3 * Math.max(0, gb - gm) * A.extrapolation - risk - 0.03;
            if (headroom > 0) loanOpt = { kind: 'loan', margin: score - hurdle, b, headroom };
          }
        }
      }
    }
    if (tieOpt && (!best || tieOpt.margin > best.margin)) best = tieOpt;
    if (loanOpt && loanOpt.margin > 0) { f.menuT = world.t; execLoan(world, ctx, fx, f, loanOpt); }
    if (!best || best.margin <= 0 || best.margin <= capRoi - hurdle) continue;
    f.menuT = world.t;
    if (best.kind === 'acq') execAcq(world, ctx, fx, f, best, spare, room);
    else execStake(world, ctx, fx, f, best, spare, room);
  }
}

function spendFrom(f, amt) { f.reserve = Math.max(0, Math.min(f.reserve, f.cash - amt)); }

function execAcq(world, ctx, fx, f, o, spare, room) {
  const t = o.t;
  if (!t.alive || !f.alive) return;
  const short = o.cashNeed - Math.max(0, spare);
  if (short > 0) { const got = borrow(world, ctx, f, short * 1.02); if (got < short * 0.98) return; }
  acquire(world, ctx, f, t, o.price, { stockFrac: o.stockFrac, kind: o.akind, subsidiary: o.akind === 'vertical', shareAfter: o.akind === 'vertical' ? undefined : o.shareAfter });
}

function execStake(world, ctx, fx, f, o, spare, room) {
  const fin = world.finance, pol = world.policies;
  const b = o.b;
  const frac = Math.min(o.frRoom, 0.25);
  const V = Math.max(1, O.priceOf(b, ctx));
  const want = Math.min(frac * V / (1 - frac), 0.5 * V);
  let funds = Math.max(0, spare) * 0.6;
  // дополнительно: кредит банка и кредит под залог уже имеющихся долей
  if (o.margin > 0.03 && funds < want) {
    const a = borrow(world, ctx, f, Math.min(want - funds, 0.25 * room));
    funds += a;
  }
  if (o.margin > 0.06 && funds < want && pol.marginLimit > 0 && Object.keys(f.stakes).length) {
    const C = stakeCollateral(world, ctx, f, 'f');
    const L = effMarginLimit(world);
    const a = Math.min(Math.max(0, L * C - f.marginDebt) * 0.3, bankRoom(world), want - funds);
    if (a > 1) { mint(world, f, a, 'loans'); world.bank.loans += a; f.marginDebt += a; funds += a; }
  }
  const amt = Math.min(want, funds, f.cash);
  if (!(amt > 1)) return;
  const before = O.holdingOf('f', f, b);
  const { amt: paid, phi } = O.issueShares(world, ctx, b, 'f', f, amt, 'equity_purchases');
  if (!(paid > 0)) return;
  spendFrom(f, 0);
  b.tied[f.id] = (b.tied[f.id] || 0) + paid;
  // вложение «под заказы»: клиент обязуется потратить часть денег на товар самого инвестора (из его нераспроданных запасов)
  const back = tiedSale(world, ctx, f, b, 0.6 * paid);
  if (back > 0) b.tied[f.id] = Math.max(0, b.tied[f.id] - back);
  if (before === 0 && phi >= 0.05 && world.t - (fin.lastStakeEventT ?? -99) >= 9) {
    fin.lastStakeEventT = world.t;
    const isClient = IND[b.industry].inputs[f.industry] > 0;
    addEvent(world, 'stake', `${q(f.name)} купила ${Math.round(phi * 100)}% ${isClient ? 'своего клиента' : 'фирмы'} ${q(b.name)}. Совпадение, что клиент теперь заказывает у неё больше, — разумеется, случайное`, { firm: f.id, target: b.id, phi });
  }
}

/** Продажа клиенту товара из нераспроданных запасов фирмы f на сумму не больше amount. Возвращает проданное в деньгах. */
function tiedSale(world, ctx, f, b, amount) {
  const unit = Math.max(1e-9, f.price);
  const qty = Math.min(0.9 * f.inventory, amount / unit);
  if (!(qty > 1e-6)) return 0;
  const cost = qty * unit;
  f.inventory -= qty;
  f.demandEMA += 0.6 * qty;   // продавец принимает проданное «под вложение» за спрос и планирует выпуск выше
  pay(world, b, f, Math.min(cost, Math.max(0, b.cash)), 'b2b');
  f.revenue += cost;
  if (f.revHist.length) f.revHist[f.revHist.length - 1] += cost;
  f.extra += cost - qty * f.unitCost;
  f.circularRevenue += cost;
  const g = f.industry;
  if (IND[b.industry].inputs[g] > 0) {
    const old = b.inputStock[g] || 0;
    b.inputCost[g] = ((b.inputCost[g] || unit) * old + cost) / Math.max(1e-9, old + qty);
    b.inputStock[g] = old + qty;
  } else {
    b.capital += cost / ctx.capUnit;
    b.capex += cost;
  }
  return cost;
}

function execLoan(world, ctx, fx, f, o) {
  const b = o.b;
  const unit = Math.max(1e-9, f.price);
  const cap = Math.min(0.2 * (b.capital * ctx.capUnit), o.headroom);
  if (!(cap > 1)) return;
  // кредит и тут же покупка товара за него: деньги по кругу, у продавца — выручка и требование к клиенту
  pay(world, f, b, Math.min(cap, 0.9 * f.inventory * unit), 'vendor_loans');
  const sold = tiedSale(world, ctx, f, b, Math.min(cap, 0.9 * f.inventory * unit));
  if (!(sold > 0)) return;
  // деньги кредита, не ушедшие на товар, остаются у клиента
  f.vendorLoans[b.id] = (f.vendorLoans[b.id] || 0) + sold;
  b.vendorDebt[f.id] = (b.vendorDebt[f.id] || 0) + sold;
  world.finance.vendorVolume = (world.finance.vendorVolume || 0) + sold;
}

/** Обслуживание кредитов поставщиков: проценты и частичное погашение; кто не тянет — копит долг. */
function vendorService(world, ctx, fx) {
  const rate = world.bank.rate;
  const rM = (rate + 0.03) / 12;
  for (const b of fx.live) {
    for (const id in b.vendorDebt) {
      const a = ctx.F[id];
      let L = b.vendorDebt[id];
      if (!a || !a.alive) { delete b.vendorDebt[id]; continue; }
      const buffer = firmBuffer(world, b);
      const room = Math.max(0, b.cash - buffer);
      const due = L * rM + L * 0.04;
      const paid = Math.min(due, room);
      const interest = Math.min(paid, L * rM);
      if (paid > 0) {
        pay(world, b, a, paid, 'vendor_repayments');
        a.extra += interest;
        L -= (paid - interest);
      }
      if (due > paid) L += (due - paid) * 0.3;   // неоплаченное копится
      if (L < 1) { delete b.vendorDebt[id]; delete a.vendorLoans[b.id]; }
      else { b.vendorDebt[id] = L; a.vendorLoans[b.id] = L; }
    }
  }
}

// ───────────────────────── круговая выручка ─────────────────────────

function circularStep(world, ctx, fx) {
  const fin = world.finance;
  let circ = 0, rev = 0;
  const live = fx.live;
  // деньги, вложенные продавцом в клиента (f.tied), возвращаются к продавцу через закупки клиента в его отрасли
  for (const b of live) {
    for (const id in b.tied) {
      const a = ctx.F[id];
      let T = b.tied[id];
      if (!a || !a.alive || T < 1) { delete b.tied[id]; continue; }
      const outlay = b.wageBill + b.inputUsed + b.capex + 1e-9;
      let spendOnA = 0;
      const inp = IND[b.industry].inputs;
      const g = a.industry;
      if (inp[g] > 0) {
        let tot = 0;
        for (const k in inp) tot += inp[k] * (ctx.price[k] || 1);
        spendOnA += b.inputUsed * (inp[g] * (ctx.price[g] || 1)) / Math.max(1e-9, tot);
      }
      if (g === 'manufacturing') spendOnA += b.capex * 0.65; else if (g === 'construction') spendOnA += b.capex * 0.35;
      const w = clamp(spendOnA * a.marketShare / outlay, 0, 1);
      const back = T * 0.6 * w;
      a.circularRevenue += back;
      b.tied[id] = T * 0.4;
    }
  }
  for (const f of live) { circ += Math.min(f.circularRevenue, f.revenue); rev += f.revenue; }
  const share = rev > 0 ? circ / rev : 0;
  fin.circularShare += 0.5 * (share - fin.circularShare);
}

// ───────────────────────── главная фаза ─────────────────────────

/** Миграция: мир из старого сохранения без полей этого блока получает значения по умолчанию. */
function ensureFields(world) {
  const fin = world.finance;
  if (fin.crashT !== undefined && fin.ver === 2) return;
  const fresh = createWorld().finance;
  for (const k in fresh) if (fin[k] === undefined) fin[k] = structuredClone(fresh[k]);
  const pf = fresh.pensionFund;
  for (const k in pf) if (fin.pensionFund[k] === undefined) fin.pensionFund[k] = structuredClone(pf[k]);
  const f0 = makeFirm(0, 'agri'), h0 = makeHousehold(0);
  for (const f of world.firms) for (const k in f0) if (f[k] === undefined) f[k] = structuredClone(f0[k]);
  for (const h of world.households) for (const k in h0) if (h[k] === undefined) h[k] = structuredClone(h0[k]);
  fin.ver = 2;
}

export function financePhase(world, ctx) {
  ensureFields(world);
  const fin = world.finance;
  const fx = ctx.fin = { forced: 0, disc: 0.03, pool: null, writeoffs: 0, live: [], byInd: {}, clients: {}, idx: {}, prevMarginRatio: undefined, recordRef: fin.recordMax || 0 };
  fx.prevMarginRatio = fin.marginDebt / Math.max(1, fin.totalValue);
  for (const g of GOODS) fx.byInd[g] = [];
  for (const f of world.firms) {
    if (!f.alive || f.owner !== 'private') continue;
    f.circularRevenue = 0;
    fx.idx[f.id] = fx.live.length;
    fx.live.push(f);
    fx.byInd[f.industry].push(f);
  }
  valuation(world, ctx, fx);
  sentimentAndIndex(world, ctx, fx);
  marginStep(world, ctx, fx);
  pensionStep(world, ctx, fx);
  bankStep(world, ctx, fx);
  runMenu(world, ctx, fx);
  vendorService(world, ctx, fx);
  circularStep(world, ctx, fx);
}
