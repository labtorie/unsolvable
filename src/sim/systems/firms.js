// Фирмы: планирование выпуска и цены, зарплаты, производство, финансы.
import { pay, mint, burn } from '../ledger.js';
import { rand, randNormal } from '../rng.js';
import { IND, GOODS, P } from './params.js';
import { baseMarkup, capacity, eff, laborNeed, unitCostEst } from './core.js';
import { clamp, safePay, addEvent } from './util.js';
import { incomeTax, corpRate } from './tax.js';
import { skillFactor } from './labor.js';

/** Высота входного барьера отрасли 0..1 (для наценки). */
export function entryBarrier(world, ctx, g) {
  const ind = IND[g];
  const pol = world.policies;
  const lic = pol.industry[g].ownership === 'licensed' && !pol.industry[g].planned ? 0.25 : 0;
  return clamp(((Math.log(ind.entryCost) - Math.log(10)) / (Math.log(400) - Math.log(10))) * 0.55
    + 0.3 * pol.regulationBurden + lic + 0.15 * (1 - ctx.effPR), 0, 1);
}

/** Наценка: растёт с долей рынка и трудностью входа. */
export function markupFor(f, ctx) {
  const ind = IND[f.industry];
  const share = f.marketShare || 0;
  const barrier = ctx.barrier[f.industry];
  let m = baseMarkup(ind) + 0.75 * Math.max(0, share - 0.12) * (0.35 + 0.65 * barrier) + 0.08 * barrier;
  if (f.owner === 'state') m = 0.02;
  else if (f.owner === 'coop') m *= 0.7;
  // ценовая конкуренция при простаивающих мощностях: наценка сжимается
  return clamp(m, 0, 1.4);
}

export function planFirms(world, ctx) {
  const pol = world.policies;
  const A = world.assumptions;
  for (const f of world.firms) {
    if (!f.alive) continue;
    const g = f.industry, ind = IND[g], ip = pol.industry[g];
    const cap = capacity(f, world, ctx);
    const uc = unitCostEst(f, world, ctx);
    f.unitCost = f.unitCost > 0 ? f.unitCost * 0.5 + uc * 0.5 : uc;
    const planned = f.owner === 'state' && ip.planned;
    const share = f.marketShare || 0;
    f.markup = markupFor(f, ctx);
    // давление спроса
    const supply = (f.supplyPrev || 0) + 1e-9;
    const pr = f.supplyPrev > 0 ? clamp(f.orders / supply - 1, -0.3, 0.5) : 0;
    let target = f.unitCost * (1 + f.markup) * (1 + 0.4 * pr) / (1 + ip.subsidy);
    // конкуренция с импортом идёт через долю рынка (логит по цене), а не через принудительное снижение цены
    // сырьё продаётся по мировой цене: когда она выше издержек, возникает рента
    if (ctx.expParity[g] > 0 && !planned) target = Math.max(target, Math.min(0.97 * ctx.expParity[g], 2 * target));
    if (planned) {
      if (f.price <= 0 || (world.t + f.id) % 12 === 0) f.priceFree = f.unitCost * 1.02;
    } else {
      f.priceFree += 0.3 * (target - f.priceFree);
    }
    f.priceFree = clamp(f.priceFree, 0.05 * (world.basePrice[g] || 1), 50 * (world.basePrice[g] || 1) * Math.max(1, ctx.cpi));
    const capP = ip.priceCap > 0 ? ip.priceCap * f.unitCost : Infinity;
    f.price = Math.min(f.priceFree, capP);

    // выпуск
    let tq;
    if (planned) {
      if (f.planTarget <= 0 || (world.t + f.id) % 12 === 0) {
        const nF = Math.max(1, ctx.by[g].length);
        const plannedShare = ctx.plannedCount / GOODS.length;
        const err = randNormal(world, 0, 0.1 * A.planError * (1 + 3 * plannedShare));
        f.planTarget = (0.5 * (ctx.satDemand[g] / nF) + 0.5 * Math.max(f.orders, 0)) * 1.03 * (1 + err);
        f.planErr = err;
      }
      tq = f.planTarget;
    } else {
      const exp = f.demandEMA;
      tq = exp;
      if (g in P.retention) tq += clamp(0.3 * (0.25 * exp - f.inventory), -0.2 * exp, 0.2 * exp);
      else tq = Math.max(tq * 1.1, f.orders * 1.04);
      if (f.util > 0.95 && f.orders > f.output) tq = Math.max(tq, f.orders * 1.08);
      if (f.owner === 'private' && share > 0.35) tq *= 1 - 0.35 * clamp((share - 0.35) / 0.65, 0, 1);
      if (f.price < f.unitCost * 0.95) tq *= 0.8;
    }
    if (g === 'vice' && pol.vicePolicy === 'banned') tq = 0;
    f.target = clamp(tq, 0, cap);
    f.capacity = cap;
  }
}

/** Выплата зарплат (со вычетом налогов). Фирма при нехватке денег занимает у банка (госфирма — получает дотацию). */
export function payWages(world, ctx) {
  const pol = world.policies;
  const cmp = ctx.cmp;
  const gov = world.gov;
  const tax = ctx.tax;
  for (const f of world.firms) {
    if (!f.alive) continue;
    const workers = ctx.workers[f.id];
    if (!workers) { f.wageBill = 0; continue; }
    let bill = 0;
    for (const h of workers) {
      const w = Math.max((f.wageOffer[h.profession] || 0) * skillFactor(h), ctx.floor);
      h.wage = w; bill += w;
    }
    f.wageBill = bill;
    const need = bill * (1 + pol.payrollTax * cmp) * 1.02;
    if (f.cash < need) {
      if (f.owner === 'state') pay(world, gov, f, need - f.cash, 'subsidies');
      else borrow(world, ctx, f, need - f.cash + 0.1 * bill);
    }
    const ratio = need > 0 ? Math.min(1, f.cash / need) : 1;
    for (const h of workers) {
      const w = h.wage * ratio;
      pay(world, f, h, w, 'wages');
      h.incomeBySource.wage += w;
      const t = incomeTax(pol.incomeTaxBrackets, ctx.medWage, w);
      if (t > 0) {
        const paid = safePay(world, h, gov, t * cmp, 'tax_income');
        tax[h.id - 1] += paid;
      } else if (t < 0) {
        pay(world, gov, h, -t, 'transfers_poverty');
        h.incomeBySource.transfer += -t;
      }
    }
    safePay(world, f, gov, bill * ratio * pol.payrollTax * cmp, 'tax_payroll');
  }
}

export function creditRoom(world, ctx, f) {
  if (f.owner === 'state') return 0;
  const val = f.capital * ctx.capUnit;
  const lim = 0.5 * val * (0.4 + 0.6 * ctx.effPR) - f.debt;
  const bank = world.bank;
  // потолок кредитования: доля целевой денежной массы (банки не раздувают кредит выше нормы), ужесточается резервами
  const c = world.calib;
  const mStar = (c.rb0 || 0) * (c.pStar || 1) * (c.gdp0 || 1) * (c.techIdx || 1) * P.moneyNorm;
  const maxLoans = (1 - world.policies.bankReserve) * Math.max(0.3 * world.moneySupply, 0.75 * mStar) * clamp(1 - 4 * (world.policies.cbRate - 0.05), 0.4, 1.4);
  const bankRoom = maxLoans - bank.loans;
  if (f.lossMonths >= 5) return 0;
  return Math.max(0, Math.min(lim, bankRoom));
}

export function borrow(world, ctx, f, amount) {
  const a = Math.min(amount, creditRoom(world, ctx, f));
  if (!(a > 0)) return 0;
  mint(world, f, a, 'loans');
  world.bank.loans += a;
  f.debt += a;
  return a;
}

export function repay(world, f, amount) {
  const a = Math.min(amount, f.debt, f.cash);
  if (!(a > 0)) return 0;
  burn(world, f, a, 'repayments');
  world.bank.loans -= a;
  f.debt -= a;
  return a;
}

/** Производство: ограничено мощностью, трудом и запасом сырья. */
export function produce(world, ctx) {
  const pol = world.policies;
  const A = world.assumptions;
  let totalPollution = 0;
  const plannedCount = ctx.plannedCount;
  for (const f of world.firms) {
    if (!f.alive) continue;
    const ind = IND[f.industry];
    const e = eff(f, world, ctx);
    const cap = f.capacity || capacity(f, world, ctx);
    let q = f.target;
    // забастовки: недовольные работники при праве на забастовку и сильных профсоюзах останавливают часть выпуска и выбивают прибавку
    if (f.strikeLeft > 0) {
      f.strikeLeft--;
      q *= 0.45;
      ctx.strikes++;
    } else if (pol.strikeRight && pol.unionPower > 0 && f.owner !== 'state') {
      const ws = ctx.workers[f.id];
      if (ws && ws.length >= 2) {
        let sat = 0;
        for (const h of ws) sat += h.satisfaction ?? 0.5;
        sat /= ws.length;
        if (sat < 0.45 && rand(world) < 0.25 * pol.unionPower * A.unionBargaining * (0.45 - sat) / 0.45 + 0.01 * pol.unionPower * (sat < 0.45 ? 1 : 0)) {
          f.strikeLeft = 1 + (rand(world) < 0.5 ? 1 : 0);
          for (const p2 in f.wageOffer) f.wageOffer[p2] *= 1 + 0.04 * (0.5 + pol.unionPower);
          q *= 0.45;
          ctx.strikes++;
          if (ctx.strikes <= 2 && f.output > 40) addEvent(world, 'strike', `На фирме «${f.name}» забастовка: рабочие вспомнили, что они не винтики`, { firm: f.id });
        }
      }
    }
    // труд: ограничение по профессиям с заметной потребностью
    const need = laborNeed(f, q, e);
    let lf = 1;
    for (const p in need) {
      if (need[p] >= 0.75) lf = Math.min(lf, ((f.employees[p] || 0) + 0.3) / need[p]);
    }
    q *= Math.min(1, lf);
    // сырьё
    let inputUsedValue = 0;
    // сырьё: при нехватке выпуск падает, но не до нуля (кустарные заменители), иначе цепочки поставок схлопываются
    // ограничение — по доле стоимости каждого вида сырья: нехватка мелкой статьи почти не мешает, крупной — мешает сильно
    let inFactor = 1;
    {
      let wsum = 0, short = 0;
      for (const k in ind.inputs) {
        const a = ind.inputs[k];
        const w = a * (ctx.price[k] || 1);
        const have = f.inputStock[k] || 0;
        const r = a * q > 0 ? Math.min(1, have / (a * q)) : 1;
        wsum += w; short += w * (1 - r);
      }
      if (wsum > 0) inFactor = 1 - short / wsum;
    }
    if (inFactor < 1) q *= 0.4 + 0.6 * inFactor;
    q = Math.max(0, Math.min(q, cap));
    if (!(q > 0)) q = 0;
    for (const k in ind.inputs) {
      const use = Math.min(ind.inputs[k] * q * (inFactor < 1 ? inFactor : 1), f.inputStock[k] || 0);
      f.inputStock[k] -= use;
      inputUsedValue += use * (f.inputCost[k] || ctx.price[k] || 1);
    }
    f.inputUsed = inputUsedValue;
    f.output = q;
    f.util = cap > 0 ? q / cap : 0;
    f.supplyPrev = (f.inventory * (P.retention[f.industry] ?? 0)) + q;
    f.inventoryStart = f.inventory * (P.retention[f.industry] ?? 0);
    f.inventory = f.inventoryStart + q;
    const pl = ind.pollution ? q * ind.pollution * P.pollutionScale * (1 - 0.5 * pol.regulationBurden) * (1 - 0.6 * pol.carbonTax) : 0;
    totalPollution += pl;
    if (ind.resource) world.resources.reserves = Math.max(0, world.resources.reserves - q);
    // производительность: технологический дрейф; у планового сектора — упадок стимулов
    if (f.owner === 'state' && pol.industry[f.industry].planned) {
      f.productivity *= 1 - 0.0004 * A.stateInefficiency * (0.5 + plannedCount / GOODS.length);
      f.productivity = Math.max(0.65, f.productivity);
    } else {
      const slow = f.owner === 'state' ? 0.5 : f.owner === 'coop' ? 0.8 : 1;
      f.productivity = Math.min(4, f.productivity * (1 + ctx.techGrowth * slow * (1 - 0.4 * Math.max(0, (f.marketShare || 0) - 0.5))));
    }
  }
  world.resources.pollution = world.resources.pollution * 0.992 + totalPollution;
}

/** Финансы фирмы после торгов: налоги, процент, инвестиции, дивиденды, долги. */
export function firmFinance(world, ctx) {
  const pol = world.policies;
  const A = world.assumptions;
  const gov = world.gov;
  const bank = world.bank;
  const hh = world.households;
  const cmp = ctx.cmp;
  const dl = P.delta;
  const taxFactor = clamp(1 - 0.6 * A.taxDrag * ((pol.corpTax - 0.2) * 1.5 + (pol.dividendTax - 0.1) * 0.6 + (ctx.wealthRate) * 8), 0.15, 1.3);
  ctx.rentCollected = 0;
  // воры: самые бедные трудоспособные домохозяйства (кражи у фирм — перевод денег через ledger)
  let thieves = null;
  if (world.gov.crime > 0.05) {
    thieves = hh.filter(h => h.status !== 'retired').sort((a, b) => a.netIncome - b.netIncome).slice(0, Math.max(3, Math.round(hh.length * 0.08)));
  }
  for (const f of world.firms) {
    if (!f.alive) continue;
    const g = f.industry, ind = IND[g], ip = pol.industry[g];
    if (thieves && f.revenue > 0 && f.owner !== 'state') {
      const loss = f.revenue * 0.07 * Math.max(0, world.gov.crime - 0.1) * A.crimeDamage * (1 - 0.5 * ctx.secEff);
      const paid = safePay(world, f, thieves[(f.id + world.t) % thieves.length], loss, 'black_market');
      f.revenue -= paid;
      thieves[(f.id + world.t) % thieves.length].incomeBySource.business += paid;
    }
    // субсидии
    if (ip.subsidy > 0 && f.revenue > 0) {
      const amt = ip.subsidy * f.revenue * ctx.cutK;
      pay(world, gov, f, amt, 'subsidies');
      f.revenue += amt;
      const leak = amt * gov.corruption * 0.5 * A.corruptionLeak;
      ctx.leak += leak;
    }
    // процент
    const share = f.marketShare || 0;
    const rate = Math.max(0.01, bank.rate - 0.02 * share) / 12;
    const interest = safePay(world, f, bank, f.debt * rate, 'interest');
    // амортизация
    const dep = dl * f.capital * ctx.capUnit;
    f.capital *= 1 - dl;
    // экологический налог
    let carbon = 0;
    if (pol.carbonTax > 0 && ind.pollution) {
      carbon = safePay(world, f, gov, pol.carbonTax * ind.pollution * 0.15 * (ctx.price[g] || 1) * f.output * (1 - 0.6 * pol.carbonTax), 'tax_carbon');
    }
    let pre = f.revenue - f.wageBill * (1 + pol.payrollTax * cmp) - f.inputUsed - dep - interest - carbon;
    // рента
    let rent = 0;
    if (ind.resource && pol.resourceRent > 0) {
      const base = Math.max(0, f.revenue - f.output * f.unitCost * 0.95);
      rent = safePay(world, f, gov, pol.resourceRent * base * cmp, 'tax_rent');
      ctx.rentCollected += rent;
      pre -= rent;
    }
    let tax = 0;
    if (pre > 0 && f.owner !== 'state') {
      tax = safePay(world, f, gov, corpRate(pol, share, true) * pre * cmp, 'tax_corp');
    }
    f.profit = pre - tax;
    const rev = Math.max(f.revenue, 1e-9);
    f.profitMargin = clamp(f.profitMargin * 0.9 + 0.1 * (f.profit / rev), -1, 1);
    const monthlyCost = Math.max(f.wageBill * (1 + pol.payrollTax) + f.inputUsed, 0.8 * f.target * f.unitCost) + 20;
    const buffer = 1.3 * monthlyCost;
    if (f.owner !== 'state' && f.profit < 0 && (f.cash < 0.5 * buffer || f.debt > 0.1 * f.capital * ctx.capUnit)) f.lossMonths++; else f.lossMonths = Math.max(0, f.lossMonths - 1);

    // спрос и доля
    f.demandEMA = 0.4 * f.demandEMA + 0.6 * f.orders;

    // государственные фирмы: мягкое бюджетное ограничение; инвестиции в замещение и рост оплачивает бюджет
    if (f.owner === 'state') {
      if (f.cash < 0.5 * buffer) pay(world, gov, f, 0.5 * buffer - f.cash, 'subsidies');
      const repl = dl * f.capital * ctx.capUnit;
      const shortage = world.markets[g].shortage;
      const grow = shortage > 0.15 ? 0.003 * f.capital * ctx.capUnit * (ip.planned ? 1.5 : 0.8) : 0;
      const want = repl + grow;
      if (f.cash < buffer + want) pay(world, gov, f, buffer + want - f.cash, 'subsidies');
      f.capexBudget = want;
      const ex = Math.max(0, f.cash - buffer - want);
      const rem = 0.8 * ex; // прибыль госпредприятий идёт в бюджет (при плане — это и есть главный доход казны)
      if (rem > 0) { pay(world, f, gov, rem, 'dividends'); ctx.stateDiv += rem; }
      continue;
    }

    // долг: целевое плечо зависит от стоимости кредита; сверх цели гасим, ниже цели — занимаем
    const capVal = f.capital * ctx.capUnit;
    // банки подстраивают кредит под целевую денежную массу: M* = нормальные остатки × целевой уровень цен × реальный выпуск
    const lev = 0.06 * clamp(1 - 5 * (bank.rate - 0.07), 0.2, 2.5) * (0.6 + 0.4 * ctx.effPR) * ctx.creditMult;
    const dTarget = lev * capVal;
    if (f.debt > dTarget) {
      if (f.cash > buffer) repay(world, f, Math.min(f.debt - dTarget, 0.25 * (f.cash - buffer) + 0.1 * (f.debt - dTarget)));
    } else if (f.profitMargin > 0 && f.lossMonths === 0) {
      borrow(world, ctx, f, 0.08 * (dTarget - f.debt));
    }
    let avail = Math.max(0, f.cash - buffer);
    // инвестиции: замещение + рост
    const repl = dl * f.capital * ctx.capUnit;
    let growth = 0;
    const cap = f.capacity || 1;
    if (f.util > 0.93 && f.orders > 0.98 * cap && (ctx.indUtil[g] > 0.92 || world.markets[g].shortage > 0.03) && (f.profitMargin > 0.01 || world.markets[g].shortage > 0.05) && f.lossMonths === 0) {
      const gap = 0.2 * clamp(f.orders * 1.1 / cap - 1, 0, 0.06);
      growth = gap * f.capital * ctx.capUnit * taxFactor * Math.min(2, Math.pow(ctx.effPR / 0.63, 1.5 * A.lawlessCost)) * (f.owner === 'coop' ? 0.6 : 1);
    }
    let want = repl + growth;
    if (want > avail && growth > 0 && f.profitMargin > 0.02) {
      avail += borrow(world, ctx, f, want - avail);
    }
    f.capexBudget = Math.min(want, avail);
    avail -= f.capexBudget;
    // дивиденды
    let div = (f.owner === 'coop' ? 0.9 : 0.5) * avail;
    if (div > 1 && f.profitMargin > -0.02) payDividends(world, ctx, f, div);
  }
}

function payDividends(world, ctx, f, amount) {
  const gov = world.gov;
  const hh = world.households;
  const pol = world.policies;
  amount = Math.min(amount, f.cash);
  if (f.owner === 'foreign') {
    const t = pol.dividendTax * amount * ctx.cmp;
    safePay(world, f, gov, t, 'tax_dividend');
    pay(world, f, world.abroad, amount - t, 'capital_flight');
    return;
  }
  if (f.owner === 'coop') {
    const ws = ctx.workers[f.id];
    if (!ws || !ws.length) return;
    const each = amount / ws.length;
    for (const h of ws) {
      pay(world, f, h, each, 'dividends');
      h.incomeBySource.capital += each;
    }
    return;
  }
  let sum = 0;
  const hs = f.holders;
  for (const id in hs) { const h = hh[id - 1]; const s = h && h.shares[f.id]; if (s > 0) sum += s; else delete hs[id]; }
  if (!(sum > 0)) return;
  const cmp = ctx.cmp;
  for (const id in hs) {
    const h = hh[id - 1];
    const part = (amount * h.shares[f.id]) / sum;
    pay(world, f, h, part, 'dividends');
    const t = safePay(world, h, gov, pol.dividendTax * part * cmp, 'tax_dividend');
    ctx.tax[h.id - 1] += t;
    if (h.status === 'self') h.incomeBySource.business += part; else h.incomeBySource.capital += part;
  }
}

/** Банк раздаёт накопленные процентные доходы финансовым фирмам (а если их нет — всем домохозяйствам поровну). */
export function bankPayout(world, ctx) {
  const bank = world.bank;
  const amt = bank.cash;
  if (!(amt > 1e-9)) return;
  const fs = ctx.by.finance.filter(f => f.alive);
  if (fs.length) {
    let w = 0;
    for (const f of fs) w += f.capital;
    for (const f of fs) { pay(world, bank, f, (amt * f.capital) / w, 'interest'); }
  } else {
    const hh = world.households;
    for (const h of hh) { pay(world, bank, h, amt / hh.length, 'interest'); h.incomeBySource.capital += amt / hh.length; }
  }
}
