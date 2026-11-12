// Структура рынков: режимы собственности, банкротства, вход новых фирм, слияния, дробление.
import { makeFirm } from '../schema.js';
import { pay, burn } from '../ledger.js';
import { rand, randInt, randNormal } from '../rng.js';
import { firmName, splitName } from '../names.js';
import { IND, GOODS, P, effOwnership } from './params.js';
import { baseMarkup, laborNeed, headcount } from './core.js';
import { clamp, addEvent, safePay, fmt } from './util.js';
import { creditRoom, borrow } from './firms.js';

const q = n => '«' + n + '»';
const plural = (n, a, b, c) => { const m = n % 100, d = n % 10; return m > 10 && m < 15 ? c : d === 1 ? a : d >= 2 && d <= 4 ? b : c; };

function takeShares(world, f) {
  const hh = world.households;
  for (const id in f.holders) { const h = hh[id - 1]; if (h) delete h.shares[f.id]; }
  f.holders = {};
}

function firmValue(f, ctx) {
  return Math.max(0.15 * f.capital * ctx.capUnit, f.capital * ctx.capUnit * 0.7 + f.cash - f.debt);
}

export function createFirm(world, ctx, g, opts) {
  const ind = IND[g];
  const f = makeFirm(world.nextFirmId++, g);
  const used = new Set(world.firms.map(x => x.name));
  f.owner = opts.owner || 'private';
  f.name = firmName(world, g, used, f.owner);
  f.bornT = world.t;
  const peers = ctx.by[g].filter(x => x.alive);
  const avgProd = peers.length ? peers.reduce((a, x) => a + x.productivity, 0) / peers.length : 1;
  f.productivity = opts.productivity ?? clamp(avgProd * 0.97, 0.4, 3);
  f.capital = opts.capital;
  f.sizeRef = peers.length ? peers.reduce((a, x) => a + x.capital / ind.capitalPerUnit, 0) / peers.length : f.capital / ind.capitalPerUnit;
  const pAvg = ctx.price[g] || world.basePrice[g];
  f.price = f.priceFree = pAvg;
  f.unitCost = pAvg / (1 + baseMarkup(ind));
  for (const p in ind.labor) f.wageOffer[p] = (world.labor[p] && world.labor[p].wage) || P.baseWage;
  f.cash = 0;
  f.inputStock = {}; f.inputCost = {};
  const cap0 = (f.capital / ind.capitalPerUnit) * f.productivity;
  f.demandEMA = f.orders = 0.6 * cap0;
  f.output = 0.6 * cap0;
  f.target = 0.6 * cap0;
  f.share = opts.share ?? 0.03;
  f.marketShare = f.share;
  for (const k in ind.inputs) { f.inputStock[k] = ind.inputs[k] * cap0 * 0.7; f.inputCost[k] = ctx.price[k] || world.basePrice[k]; }
  f.capacity = cap0;
  world.firms.push(f);
  ctx.by[g].push(f);
  ctx.F[f.id] = f;
  return f;
}

/** Фирма меняет собственника на государство. */
function nationalize(world, ctx, f) {
  takeShares(world, f);
  f.owner = 'state';
}

function privatize(world, ctx, f, workersEqual) {
  const hh = world.households;
  const gov = world.gov;
  const value = Math.max(1, 0.55 * firmValue(f, ctx));
  const buyers = [];
  if (workersEqual) {
    for (const h of hh) if (h.employerId === f.id) buyers.push(h);
    if (!buyers.length) workersEqual = false;
    else { for (const h of buyers) { h.shares[f.id] = 1 / buyers.length; f.holders[h.id] = true; } f.owner = 'private'; return 0; }
  }
  const cand = [];
  for (let i = 0; i < 24; i++) cand.push(hh[randInt(world, hh.length)]);
  cand.sort((a, b) => b.cash - a.cash);
  const top = cand.slice(0, 5);
  const paid = [];
  let tot = 0;
  for (const h of top) {
    const a = safePay(world, h, gov, Math.min(value / top.length, h.cash * 0.6), 'acquisitions');
    paid.push(a); tot += a;
  }
  takeShares(world, f);
  f.owner = 'private';
  top.forEach((h, i) => {
    const sh = tot > 0 ? paid[i] / tot : 1 / top.length;
    h.shares[f.id] = (h.shares[f.id] || 0) + sh; f.holders[h.id] = true;
  });
  ctx.privatizationProceeds += tot;
  return tot;
}

export function applyOwnership(world, ctx) {
  const pol = world.policies;
  for (const g of GOODS) {
    const cur = effOwnership(pol.industry[g]);
    const st = world.ind[g];
    const prev = st.ownershipApplied;
    if (cur === prev) continue;
    const ind = IND[g];
    const fs = ctx.by[g].filter(f => f.alive);
    if (cur === 'state') {
      for (const f of fs) if (f.owner !== 'state') nationalize(world, ctx, f);
      world.shock.expropriation += 0.35;
      addEvent(world, 'nationalization', `Отрасль «${ind.label}» национализирована: прежние владельцы получили благодарность и справку`, { industry: g });
    } else if (cur === 'coop') {
      for (const f of fs) {
        if (f.owner === 'private') { takeShares(world, f); f.owner = 'coop'; }
        else if (f.owner === 'state') f.owner = 'coop';
      }
      world.shock.expropriation += 0.2;
      addEvent(world, 'coop', `Отрасль «${ind.label}» передана трудовым коллективам: теперь собрания дольше, чем смены`, { industry: g });
    } else {
      // free / licensed / mixed
      let total = 0, n = 0;
      fs.sort((a, b) => b.capital - a.capital);
      fs.forEach((f, i) => {
        if (f.owner === 'state') {
          if (cur === 'mixed' && i === 0) return; // остаётся «национальный чемпион»
          total += privatize(world, ctx, f, false); n++;
        } else if (f.owner === 'coop') { privatize(world, ctx, f, true); n++; }
      });
      if (n > 0) addEvent(world, 'privatization', `Приватизация в отрасли «${ind.label}»: ${n} фирм ушли с молотка, среди своих, за ${fmt(total)}`, { industry: g, proceeds: total });
    }
    st.ownershipApplied = cur;
  }
}

export function closeFirm(world, ctx, f, reason) {
  const hh = world.households;
  const bank = world.bank;
  const ws = ctx.workers[f.id] || [];
  for (const h of ws) { if (h.employerId === f.id) { h.status = 'unemployed'; h.employerId = null; h.wage = 0; h.jobSearch = 0; } }
  for (const h of hh) if (h.status === 'self' && h.employerId === f.id) h.employerId = null;
  // долг и остаток денег
  if (f.cash > 0 && f.debt > 0) {
    const r = Math.min(f.cash, f.debt);
    burn(world, f, r, 'repayments');
    bank.loans -= r; f.debt -= r;
  }
  if (f.debt > 0) { bank.loans -= f.debt; bank.defaults += f.debt; ctx.defaultsNow += f.debt; f.debt = 0; }
  if (f.cash > 1e-9) {
    let sum = 0;
    for (const id in f.holders) { const h = hh[id - 1]; if (h && h.shares[f.id] > 0) sum += h.shares[f.id]; }
    if (sum > 0) {
      const c = f.cash;
      for (const id in f.holders) { const h = hh[id - 1]; if (h && h.shares[f.id] > 0) { const a = (c * h.shares[f.id]) / sum; pay(world, f, h, a, 'dividends'); } }
    } else {
      pay(world, f, world.gov, f.cash, 'dividends');
      ctx.stateDiv += 0;
    }
  }
  takeShares(world, f);
  f.alive = false; f.deadT = world.t; f.output = 0; f.inventory = 0; f.employees = {};
  if (reason === 'bankrupt') {
    const n = ws.length;
    if (n >= 2) addEvent(world, 'bankruptcy', `Банкротство: ${q(f.name)} закрыта, ${n} ${plural(n, 'работник', 'работника', 'работников')} ищут новое место`, { firm: f.id, industry: f.industry });
  }
}

function bankruptcies(world, ctx) {
  for (const f of world.firms) {
    if (!f.alive || f.owner === 'state') continue;
    const val = f.capital * ctx.capUnit;
    if (world.t < 30 && f.bornT === 0) continue; // стартовые фирмы переживают период настройки
    const bad = f.lossMonths >= 10 || (f.debt > 2.5 * val && f.debt > 0) || (f.capital < 0.5 && f.output < 1e-6 && world.t - f.bornT > 6);
    if (bad) closeFirm(world, ctx, f, 'bankrupt');
  }
}

function foundFirm(world, ctx, g, owner) {
  const ind = IND[g];
  const pol = world.policies;
  const hh = world.households;
  let mainL = 0;
  for (const p in ind.labor) mainL = Math.max(mainL, ind.labor[p]);
  // новичок должен быть по размеру хотя бы на 3 работника главной профессии
  const minUnits = (3 * 100) / mainL;
  const K0 = Math.max(ind.entryCost * (1 + 0.5 * pol.regulationBurden) * 0.45, (minUnits * ind.capitalPerUnit) / 0.9);
  const plan = 0.7 * (K0 / ind.capitalPerUnit);
  const wc = 1.5 * plan * (ctx.price[g] || 1) * 0.8;
  const invest = ind.entryCost * (1 + 0.5 * pol.regulationBurden) * 0.55 * ctx.capUnit;
  const money = invest + wc;
  if (owner === 'state' || owner === 'coop') {
    const f = createFirm(world, ctx, g, { owner, capital: K0 * (owner === 'state' ? 3 : 1) });
    pay(world, world.gov, f, money, 'investment');
    f.capexBudget = invest * 0.8;
    addEvent(world, 'entry', `В отрасли «${ind.label}» ${owner === 'state' ? 'государство открыло' : 'работники открыли'} фирму ${q(f.name)}`, { firm: f.id });
    return f;
  }
  const cand = [];
  for (let i = 0; i < 12; i++) cand.push(hh[randInt(world, hh.length)]);
  cand.sort((a, b) => b.cash - a.cash);
  const founder = cand.find(h => h.status !== 'retired') || null;
  if (!founder) return null;
  const eq = Math.min(0.7 * founder.cash, money);
  if (eq < 0.5 * money) return null;
  const f = createFirm(world, ctx, g, { owner: 'private', capital: K0 });
  pay(world, founder, f, eq, 'investment');
  founder.shares[f.id] = 1; f.holders[founder.id] = true;
  if (founder.status === 'employed' || founder.status === 'unemployed') {
    if (founder.employerId) { const e = ctx.F[founder.employerId]; if (e && e.employees[founder.profession] > 0) e.employees[founder.profession]--; }
    founder.status = 'self'; founder.employerId = f.id; founder.wage = 0; founder.retrain = null; founder.jobSearch = 0;
  }
  if (money > eq) borrow(world, ctx, f, money - eq);
  f.capexBudget = invest * 0.8;
  addEvent(world, 'entry', `В отрасли «${ind.label}» открылась фирма ${q(f.name)}: кто-то увидел прибыль и не удержался`, { firm: f.id });
  return f;
}

export function entryAndStructure(world, ctx) {
  const pol = world.policies;
  const bank = world.bank;
  bankruptcies(world, ctx);
  for (const g of GOODS) {
    const ind = IND[g];
    const ip = pol.industry[g];
    const st = world.ind[g];
    const fs = ctx.by[g].filter(f => f.alive);
    // рентабельность отрасли
    let rev = 0, prof = 0;
    for (const f of fs) { rev += f.revenue; prof += f.profit; }
    if (rev > 0) st.profitMargin = 0.9 * st.profitMargin + 0.1 * (prof / rev);
    const own = effOwnership(ip);
    // государственные и кооперативные фирмы создаёт сам режим
    if (fs.length === 0 && (own === 'state' || own === 'mixed' || own === 'coop') && world.t - st.lastEntryT > 3) {
      foundFirm(world, ctx, g, own === 'coop' ? 'coop' : 'state'); st.lastEntryT = world.t; continue;
    }
    if (own === 'mixed' && !fs.some(f => f.owner === 'state') && world.t - st.lastEntryT > 6) {
      foundFirm(world, ctx, g, 'state'); st.lastEntryT = world.t;
    }
    if (g === 'vice' && pol.vicePolicy === 'banned') continue;
    if (own === 'state') continue;
    // вход частных фирм и кооперативов
    if (fs.length < 40) {
      let signal = (st.profitMargin - (0.015 + 0.2 * bank.rate)) / 0.08;
      const mk = world.markets[g];
      if (mk.shortage > 0.1) signal += 1.5 + 4 * mk.shortage;
      if (fs.length === 0) signal = Math.max(signal, 1.5);
      if (signal > 0) {
        const credit = 1 / (1 + 8 * Math.max(0, bank.rate - 0.06));
        const lic = own === 'licensed' ? 0.35 : 1;
        const domin = Math.max(0, ...fs.map(f => f.marketShare));
        let p = 0.1 * clamp(signal, 0, 2.5) * credit / (1 + ind.entryCost / 120) * (1 - 0.7 * pol.regulationBurden) * lic * Math.min(2, Math.pow(ctx.effPR / 0.63, 1.5 * world.assumptions.lawlessCost))
          * (domin > 0.6 ? 0.6 : 1);
        if (g === 'vice' && pol.vicePolicy === 'licensed') p *= 0.5;
        if (rand(world) < p) {
          foundFirm(world, ctx, g, own === 'coop' ? 'coop' : 'private');
          st.lastEntryT = world.t;
        }
      }
    }
    // слияния и поглощения
    if (own !== 'coop' && fs.length >= 2 && rand(world) < 0.015 + 0.03 * clamp((pol.antitrustThreshold - 0.4) / 0.6, 0, 1) * (own === 'licensed' ? 2.2 : 1)) { // без антимонопольного закона поглощения идут вдвое-втрое чаще
      const priv = fs.filter(f => f.owner === 'private');
      if (priv.length >= 2) {
        priv.sort((a, b) => firmValue(b, ctx) - firmValue(a, ctx));
        const buyer = priv[0];
        let target = null;
        for (const f of priv) {
          if (f === buyer) continue;
          if (!target || f.profitMargin < target.profitMargin) target = f;
        }
        if (target && buyer.profitMargin > 0.02) {
          const price = 1.35 * firmValue(target, ctx); // премия продавцу
          const shareAfter = buyer.marketShare + target.marketShare;
          if (shareAfter <= pol.antitrustThreshold + 1e-9 && firmValue(buyer, ctx) > 1.3 * price && rand(world) < 0.7) {
            acquire(world, ctx, buyer, target, price, shareAfter);
          }
        }
      }
    }
    // принудительное дробление
    if (pol.antitrustBreakup && own !== 'state') {
      for (const f of fs) {
        if (f.alive && f.owner === 'private' && f.marketShare > pol.antitrustThreshold + 0.02 && world.t - f.lastSplitT > 24 && f.capital > 2 * ind.entryCost * 0.3) {
          splitFirm(world, ctx, f);
          break;
        }
      }
    }
  }
}

function acquire(world, ctx, buyer, target, price, shareAfter) {
  const hh = world.households;
  let sum = 0;
  for (const id in target.holders) { const h = hh[id - 1]; if (h && h.shares[target.id] > 0) sum += h.shares[target.id]; }
  // платёж: часть деньгами, остальное — акциями покупателя (обмен акциями)
  const buffer = 1.3 * (buyer.wageBill + buyer.inputUsed + 20);
  const cashPart = Math.max(0, Math.min(price * 0.6, buyer.cash - buffer));
  const sharePart = price - cashPart;
  const bEquity = Math.max(1, firmValue(buyer, ctx));
  const phi = sum > 0 ? sharePart / (bEquity + sharePart) : 0;
  if (sum > 0) {
    if (phi > 0) for (const id in buyer.holders) { const o = hh[id - 1]; if (o && o.shares[buyer.id]) o.shares[buyer.id] *= 1 - phi; }
    for (const id in target.holders) {
      const h = hh[id - 1];
      if (!(h && h.shares[target.id] > 0)) continue;
      const frac = h.shares[target.id] / sum;
      if (cashPart > 0) pay(world, buyer, h, cashPart * frac, 'acquisitions');
      if (phi > 0) { h.shares[buyer.id] = (h.shares[buyer.id] || 0) + phi * frac; buyer.holders[h.id] = true; }
    }
  }
  takeShares(world, target);
  if (target.cash > 0) pay(world, target, buyer, target.cash, 'acquisitions');
  buyer.capital += target.capital * 0.88; // издержки интеграции: часть активов теряется при слиянии
  buyer.debt += target.debt; target.debt = 0;
  buyer.inventory += target.inventory;
  for (const k in target.inputStock) buyer.inputStock[k] = (buyer.inputStock[k] || 0) + target.inputStock[k];
  for (const h of ctx.workers[target.id] || []) { if (h.employerId === target.id) h.employerId = buyer.id; }
  for (const p in target.employees) buyer.employees[p] = (buyer.employees[p] || 0) + target.employees[p];
  buyer.demandEMA += target.demandEMA;
  buyer.share += target.share;
  buyer.marketShare = shareAfter;
  buyer.acquired.push(target.name, ...target.acquired);
  target.alive = false; target.deadT = world.t; target.output = 0; target.inventory = 0; target.employees = {};
  addEvent(world, 'merger', `Фирма ${q(buyer.name)} проглотила фирму ${q(target.name)}: доля рынка ${Math.round(shareAfter * 100)}%`, { buyer: buyer.id, target: target.id, share: shareAfter });
}

function splitFirm(world, ctx, f) {
  const hh = world.households;
  const names = new Set(world.firms.map(x => x.name));
  const g = f.industry;
  const n = makeFirm(world.nextFirmId++, g);
  n.name = splitName(f.name, names);
  n.owner = f.owner; n.bornT = world.t;
  const half = x => x * 0.5;
  n.capital = half(f.capital); f.capital = half(f.capital);
  n.productivity = f.productivity; n.sizeRef = f.sizeRef;
  n.price = f.price; n.priceFree = f.priceFree; n.unitCost = f.unitCost; n.markup = f.markup;
  const c = half(f.cash);
  if (c > 0) pay(world, f, n, c, 'acquisitions');
  n.debt = half(f.debt); f.debt = half(f.debt);
  n.inventory = half(f.inventory); f.inventory = half(f.inventory);
  for (const k in f.inputStock) { n.inputStock[k] = half(f.inputStock[k]); f.inputStock[k] = half(f.inputStock[k]); n.inputCost[k] = f.inputCost[k]; }
  n.demandEMA = n.orders = half(f.demandEMA); f.demandEMA = half(f.demandEMA);
  n.share = half(f.share); f.share = half(f.share);
  n.marketShare = half(f.marketShare); f.marketShare = half(f.marketShare);
  n.wageOffer = { ...f.wageOffer };
  n.output = half(f.output); f.output = half(f.output);
  n.target = half(f.target || 0);
  n.capacity = half(f.capacity || 0);
  // работники и владельцы
  const ws = ctx.workers[f.id] || [];
  ws.forEach((h, i) => { if (i % 2) { h.employerId = n.id; n.employees[h.profession] = (n.employees[h.profession] || 0) + 1; f.employees[h.profession]--; } });
  for (const id in f.holders) { const h = hh[id - 1]; if (h && h.shares[f.id] > 0) { h.shares[n.id] = h.shares[f.id]; n.holders[id] = true; } }
  f.lastSplitT = world.t; n.lastSplitT = world.t;
  world.firms.push(n); ctx.by[g].push(n); ctx.F[n.id] = n;
  addEvent(world, 'breakup', `Фирма ${q(f.name)} принудительно разделена: у монополии появился брат-близнец ${q(n.name)}`, { firm: f.id, newFirm: n.id });
}

/** Чистка давно умерших фирм (раз в год). */
export function cleanup(world, ctx) {
  if (world.t % 12 !== 5) return;
  const keep = [];
  for (const f of world.firms) {
    if (!f.alive && world.t - (f.deadT ?? 0) > 24) continue;
    keep.push(f);
  }
  world.firms = keep;
}
