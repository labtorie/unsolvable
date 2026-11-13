// Владение акциями: кто чем владеет (домохозяйства, другие фирмы, пенсионный фонд) и что с этим делают
// при выпуске акций, дивидендах, закрытии, дроблении, поглощении.
//
// Три вида владельцев ('k'):
//   'h' — домохозяйство: h.shares[firmId] = доля 0..1; на стороне фирмы f.holders[hhId] = true
//   'f' — другая фирма:  a.stakes[firmId] = доля;       на стороне фирмы f.stakeHolders[ownerFirmId] = true
//   'p' — пенсионный фонд: world.finance.pensionFund.stakes[firmId]; на стороне фирмы f.stakeHolders[0] = true
// Доли всех владельцев одной фирмы в сумме дают 1 (выпуск акций разбавляет всех поровну).
import { pay } from '../ledger.js';
import { safePay } from './util.js';

export const FUND = 0;   // ключ пенсионного фонда в f.stakeHolders (id фирм и домохозяйств начинаются с 1)

const mapOf = (k, o) => (k === 'h' ? o.shares : o.stakes);

export function holdingOf(k, o, f) { return mapOf(k, o)[f.id] || 0; }

export function setHolding(k, o, f, v) {
  const m = mapOf(k, o);
  if (v > 1e-9) {
    m[f.id] = v;
    if (k === 'h') f.holders[o.id] = true; else f.stakeHolders[k === 'p' ? FUND : o.id] = true;
  } else {
    delete m[f.id];
    if (k === 'h') delete f.holders[o.id]; else delete f.stakeHolders[k === 'p' ? FUND : o.id];
  }
}
export function addHolding(k, o, f, d) { setHolding(k, o, f, holdingOf(k, o, f) + d); }

/** Все действующие владельцы фирмы: { list: [{ k, o, fr }], sum }. Заодно чистит устаревшие записи. */
export function ownersOf(world, ctx, f) {
  const list = [];
  let sum = 0;
  const hh = world.households;
  for (const id in f.holders) {
    const h = hh[id - 1];
    const s = h && h.shares[f.id];
    if (s > 0) { list.push({ k: 'h', o: h, fr: s }); sum += s; } else delete f.holders[id];
  }
  for (const id in f.stakeHolders) {
    if (+id === FUND) {
      const p = world.finance.pensionFund;
      const s = p.stakes[f.id];
      if (s > 0) { list.push({ k: 'p', o: p, fr: s }); sum += s; } else delete f.stakeHolders[id];
      continue;
    }
    const a = ctx.F[id];
    const s = a && a.alive && a.stakes[f.id];
    if (s > 0) { list.push({ k: 'f', o: a, fr: s }); sum += s; } else delete f.stakeHolders[id];
  }
  return { list, sum };
}

/** Рыночная цена фирмы для сделок: оценка инвесторов, а до первой оценки — балансовая. */
export function priceOf(f, ctx) {
  if (f.value > 0) return f.value;
  return Math.max(0.15 * f.capital * ctx.capUnit, f.capital * ctx.capUnit * 0.7 + f.cash - f.debt);
}

/** Привести доли всех владельцев к сумме 1 (после ухода одного из них). */
export function renorm(world, ctx, f) {
  const { list, sum } = ownersOf(world, ctx, f);
  if (!(sum > 0) || Math.abs(sum - 1) < 1e-9) return;
  for (const x of list) setHolding(x.k, x.o, f, x.fr / sum);
}

/** Разбавить всех владельцев: выпущено долю phi новых акций. */
export function dilute(world, ctx, f, phi) {
  if (!(phi > 0)) return;
  const { list } = ownersOf(world, ctx, f);
  for (const x of list) setHolding(x.k, x.o, f, x.fr * (1 - phi));
}

/** Налог на финансовые сделки: сколько нужно заплатить сверх суммы сделки. */
export function fttRate(world) { return world.policies.financialTransactionTax || 0; }
export function payFtt(world, buyer, amount) {
  const r = fttRate(world);
  if (!(r > 0)) return 0;
  return safePay(world, buyer, world.gov, amount * r, 'ftt');
}

/**
 * Новый выпуск акций фирмы f: покупатель (k, buyer) вносит деньги в фирму по рыночной цене, все прежние владельцы разбавляются.
 * flow — вид потока ('equity_purchases'). Возвращает { amt, phi }.
 */
export function issueShares(world, ctx, f, k, buyer, amount, flow = 'equity_purchases') {
  const r = fttRate(world);
  let amt = Math.min(amount, buyer.cash / (1 + r));
  if (!(amt > 1e-9)) return { amt: 0, phi: 0 };
  const V = Math.max(priceOf(f, ctx), 0.1 * f.capital * ctx.capUnit, 1);
  payFtt(world, buyer, amt);
  pay(world, buyer, f, amt, flow);
  const phi = amt / (V + amt);
  dilute(world, ctx, f, phi);
  addHolding(k, buyer, f, phi);
  f.raised += phi;
  f.reserve += 0.9 * amt;
  return { amt, phi };
}

/**
 * Выплата владельцам из кассы фирмы: всем пропорционально долям.
 * taxed — удерживать налог на дивиденды с домохозяйств. Возвращает выплаченное.
 */
export function payOwners(world, ctx, f, amount, taxed) {
  amount = Math.min(amount, f.cash);
  if (!(amount > 1e-9)) return 0;
  const { list, sum } = ownersOf(world, ctx, f);
  if (!(sum > 0)) return 0;
  const pol = world.policies;
  f.divPaid += amount;
  const rec = (ctx.divRecv ||= {});
  for (const x of list) {
    const part = (amount * x.fr) / sum;
    if (x.k === 'h') {
      const h = x.o;
      pay(world, f, h, part, 'dividends');
      if (taxed) {
        const t = safePay(world, h, world.gov, pol.dividendTax * part * ctx.cmp, 'tax_dividend');
        ctx.tax[h.id - 1] += t;
      }
      if (h.status === 'self') h.incomeBySource.business += part; else h.incomeBySource.capital += part;
    } else if (x.k === 'f') {
      pay(world, f, x.o, part, 'dividends');
      rec[x.o.id] = (rec[x.o.id] || 0) + part;
    } else {
      pay(world, f, x.o, part, 'dividends');
    }
  }
  return amount;
}

/** Снять все доли фирмы у всех владельцев (национализация, закрытие, поглощение): владельцы остаются ни с чем. */
export function clearHoldings(world, ctx, f) {
  const { list } = ownersOf(world, ctx, f);
  for (const x of list) setHolding(x.k, x.o, f, 0);
  f.holders = {};
  f.stakeHolders = {};
}

/** Фирма a уходит (закрылась или поглощена): её доли в других фирмах снимаются; осиротевшие дочерние фирмы достаются её владельцам. */
export function dropOwnStakes(world, ctx, a) {
  const hhOwners = ownersOf(world, ctx, a).list.filter(x => x.k === 'h');
  let hs = 0;
  for (const x of hhOwners) hs += x.fr;
  for (const id in a.stakes) {
    const b = ctx.F[id];
    delete a.stakes[id];
    if (!b) continue;
    delete b.stakeHolders[a.id];
    if (b.parent === a.id) b.parent = 0;
    if (!b.alive) continue;
    const { sum } = ownersOf(world, ctx, b);
    if (sum > 1e-9) renorm(world, ctx, b);
    else if (hs > 0) for (const x of hhOwners) setHolding('h', x.o, b, x.fr / hs);
  }
}
