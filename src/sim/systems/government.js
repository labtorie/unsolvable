// Государство: трансферты, жалованье, долг и эмиссия, коррупция, тень, преступность, инфраструктура,
// внешний сектор (курс, мировые цены, движение капитала).
import { pay, mint, burn } from '../ledger.js';
import { rand, randNormal, randInt } from '../rng.js';
import { NEEDS } from '../schema.js';
import { GOODS, IND, P } from './params.js';
import { clamp, addEvent, safePay } from './util.js';
import { incomeTax, avgMarginal } from './tax.js';
import { skillFactor } from './labor.js';

const REV_KINDS = ['tax_income', 'tax_payroll', 'tax_corp', 'tax_vat', 'tax_excise', 'tax_wealth', 'tax_inheritance', 'tax_dividend', 'tax_rent', 'tax_carbon', 'tariffs', 'robot_tax', 'ftt'];
const SPEND_KINDS = ['transfers_pension', 'transfers_unemployment', 'transfers_ubi', 'transfers_poverty', 'gov_wages', 'gov_procurement', 'subsidies', 'gov_interest', 'automation_subsidy', 'retraining', 'bailouts'];

/** Сколько иностранных денег страна реально может привлечь в этом месяце: на счёте abroad и, в связанном мире, у соседей на руках. */
const foreignFunds = ab => (ab.plan ? Math.max(0, Math.min(ab.cash, ab.avail ?? 0)) : ab.cash);

export function worldPrices(world, ctx) {
  const ab = world.abroad;
  if (ab.plan) return;   // связанный мир: цены складываются из цен соседей (neighbors.js), а не из экзогенного процесса
  for (const g of GOODS) {
    if (!IND[g].tradable) continue;
    // мировые цены тоже растут на ~2% в год (мировая инфляция), иначе внутренняя инфляция выдавливает всех импортом
    const base = (world.basePrice[g] || 1) * 0.97 * Math.pow(1.02, world.t / 12) * (ab.drift?.[g] ?? 1);
    const vol = g === 'mining' ? 0.03 : 0.012;
    const cur = ab.worldPrice[g] || base;
    const rev = -0.02 * (Math.log(cur) - Math.log(base));
    ab.worldPrice[g] = cur * Math.exp(rev + vol * randNormal(world, 0, 1));
  }
}

/** Трансферты, жалованье чиновникам, проценты по долгу. */
export function governmentSpending(world, ctx) {
  const pol = world.policies;
  const A = world.assumptions;
  const gov = world.gov;
  const hh = world.households;
  const N = hh.length;
  const avgW = ctx.avgWage;
  const med = ctx.medWage;
  const cmp = ctx.cmp;
  const basket = ctx.basicBasket;
  const rentCit = pol.rentDistribution === 'citizens' ? ctx.rentCollected / N : 0;
  if (pol.rentDistribution === 'fund') gov.fund += ctx.rentCollected;

  // голосовые для частных схем здравоохранения и образования
  let voucher = 0;
  if (pol.healthMode === 'private') voucher += 0.5 * pol.healthBudget * ctx.gdpM;
  if (pol.educationMode === 'private') voucher += 0.5 * pol.educationBudget * ctx.gdpM;
  let poor = 0;
  if (voucher > 0) for (const h of hh) if (h.netIncome < 0.6 * med) poor++;
  const vEach = poor > 0 ? (voucher * ctx.cutK) / poor : 0;

  let leakPaid = 0;
  const officials = [];
  for (let i = 0; i < N; i++) {
    const h = hh[i];
    let tr = 0;
    if (h.status === 'retired') {
      const a = pol.pensionLevel * avgW * ctx.cutK;
      if (a > 0) { pay(world, gov, h, a, 'transfers_pension'); tr += a; }
    } else if (h.status === 'unemployed') {
      const a = pol.unemploymentBenefit * avgW * ctx.cutK * (h.jobSearch > 12 ? 0.6 : 1); // долгое пособие урезается
      if (a > 0) { pay(world, gov, h, a, 'transfers_unemployment'); tr += a; }
    }
    if (pol.ubi > 0) { const a = pol.ubi * avgW * ctx.cutK; pay(world, gov, h, a, 'transfers_ubi'); tr += a; }
    if (rentCit > 0) { pay(world, gov, h, rentCit, 'transfers_ubi'); tr += rentCit; }
    if (vEach > 0 && h.netIncome < 0.6 * med) { pay(world, gov, h, vEach, 'transfers_poverty'); tr += vEach; }
    h.incomeBySource.transfer += tr;
    if (h.employerId === 0 && h.status === 'employed') officials.push(h);
  }
  // доплата до минимального дохода
  if (pol.minIncomeGuarantee > 0) {
    const floorInc = pol.minIncomeGuarantee * basket * ctx.cutK;
    for (let i = 0; i < N; i++) {
      const h = hh[i];
      const inc = h.incomeBySource.wage + h.incomeBySource.capital + h.incomeBySource.transfer + h.incomeBySource.business - ctx.tax[i];
      if (inc < floorInc) {
        const a = floorInc - inc;
        pay(world, gov, h, a, 'transfers_poverty');
        h.incomeBySource.transfer += a;
      }
    }
  }
  // жалованье чиновникам
  for (const h of officials) {
    const w = world.labor.official.wage * skillFactor(h);
    h.wage = w;
    pay(world, gov, h, w * ctx.cutK, 'gov_wages');
    h.incomeBySource.wage += w;
    const t = incomeTax(pol.incomeTaxBrackets, med, w);
    if (t > 0) ctx.tax[h.id - 1] += safePay(world, h, gov, t * cmp, 'tax_income');
    else if (t < 0) { pay(world, gov, h, -t, 'transfers_poverty'); h.incomeBySource.transfer += -t; }
  }
  ctx.adminWages = officials.reduce((a, h) => a + h.wage, 0);
  // оседание части расходов у чиновников
  const leak = Math.min(ctx.leak, Math.max(0, gov.cash));
  if (leak > 0 && officials.length) {
    // чем выше должность в жалованье, тем больше доля
    let ws = 0;
    for (const h of officials) ws += h.wage * h.wage;
    for (const h of officials) {
      const part = (leak * h.wage * h.wage) / ws;
      pay(world, gov, h, part, 'corruption');
      h.incomeBySource.business += part;
      leakPaid += part;
    }
  }
  ctx.leakPaid = leakPaid;

  // проценты по долгу
  const ann = Math.max(1, ctx.gdpM * 12);
  const dg = gov.debt / ann;
  gov.interestRate = pol.cbRate + 0.01 + 0.08 * Math.max(0, dg - 0.6);
  const interest = (gov.debt * gov.interestRate) / 12;
  if (interest > 0) {
    let bs = 0;
    for (const h of hh) bs += h.bonds;
    const fr = gov.debt > 0 ? Math.min(1, (gov.debtAbroad || 0) / gov.debt) : 0;
    const toAbroad = interest * fr;
    if (toAbroad > 0) pay(world, gov, world.abroad, toAbroad, 'gov_interest');
    const hhPart = interest - toAbroad;
    if (bs > 0) {
      for (const h of hh) {
        if (h.bonds <= 0) continue;
        const a = (hhPart * h.bonds) / bs;
        pay(world, gov, h, a, 'gov_interest');
        h.incomeBySource.capital += a;
      }
    }
  }
}

/** Рефинансирование: покрытие нехватки денег фондом, займом у населения или печатным станком. */
export function governmentFinance(world, ctx) {
  const pol = world.policies;
  const gov = world.gov;
  const hh = world.households;
  const N = hh.length;
  const outlays = Math.max(1, ctx.gdpM * 0.25);
  const buffer = 0.3 * outlays;
  const free = gov.cash - gov.fund;
  let shortage = buffer - free;
  let unmet = 0;
  if (shortage > 0) {
    const use = Math.min(shortage, gov.fund);
    gov.fund -= use; shortage -= use;
  }
  if (shortage > 0) {
    const m = pol.deficitMonetization;
    const printed = m * shortage;
    if (printed > 0) mint(world, gov, printed, 'emission');
    let need = shortage - printed;
    if (need > 0) {
      let got = 0;
      const lenders = [];
      for (const h of hh) {
        const ex = h.cash - 1.5 * Math.max(h.netIncome, 0.5 * ctx.medWage);
        if (ex > 0) lenders.push([h, ex]);
      }
      let totalEx = 0;
      for (const [, ex] of lenders) totalEx += ex;
      const frac = totalEx > 0 ? Math.min(0.7, need / totalEx) : 0;
      for (const [h, ex] of lenders) {
        const a = ex * frac;
        if (a > 0) { pay(world, h, gov, a, 'gov_borrowing'); h.bonds += a; gov.debt += a; got += a; }
      }
      need -= got;
      // иностранные покупатели облигаций (если капитал не заперт)
      const ab = world.abroad;
      if (need > 1e-6 && pol.capitalControls < 1 && foreignFunds(ab) > 0) {
        const a = Math.min(need, 0.5 * foreignFunds(ab) * (1 - pol.capitalControls));
        if (a > 0) { pay(world, ab, gov, a, 'gov_borrowing'); gov.debt += a; gov.debtAbroad = (gov.debtAbroad || 0) + a; need -= a; if (ab.plan) ab.avail -= a; }
      }
      unmet = Math.max(0, need);
    }
  } else if (free > 2.5 * buffer && gov.debt <= 0.1 * 12 * ctx.gdpM) {
    // профицит без долга: излишки возвращаются гражданам (бюджетный дивиденд), иначе казна выкачивает деньги из экономики
    const r = 0.2 * (free - 2.5 * buffer);
    if (r > 0) {
      const each = r / N;
      for (const h of hh) { pay(world, gov, h, each, 'transfers_ubi'); h.incomeBySource.transfer += each; }
      gov.rebate = (gov.rebate || 0) + r;
      ctx.rebate = r;
    }
  } else if (free > 2.5 * buffer && gov.debt > 0) {
    const r = Math.min(gov.debt - 0.1 * 12 * ctx.gdpM, 0.25 * (free - 2.5 * buffer));
    let bs = 0;
    for (const h of hh) bs += h.bonds;
    const fr = gov.debt > 0 ? (gov.debtAbroad || 0) / gov.debt : 0;
    if (fr > 0 && r > 0) {
      const ra = Math.min(r * fr, gov.debtAbroad, Math.max(0, gov.cash));
      pay(world, gov, world.abroad, ra, 'repayments'); gov.debtAbroad -= ra; gov.debt -= ra;
    }
    if (bs > 0 && r > 0) {
      const k = Math.min(1, r / bs);
      for (const h of hh) {
        if (h.bonds <= 0) continue;
        const a = h.bonds * k;
        pay(world, gov, h, a, 'repayments');
        h.bonds -= a;
      }
      gov.debt -= bs * k;
    }
  }
  // нет денег и нет покупателей долга: расходы режутся (секвестр), новые деньги не появляются
  const outlayEst = Math.max(1, gov.spending || outlays);
  if (unmet > 1e-6) gov.cut = clamp(Math.max(gov.cut || 0, unmet / outlayEst), 0, 0.98);
  else gov.cut = (gov.cut || 0) * 0.6 < 0.01 ? 0 : (gov.cut || 0) * 0.6;
  if (gov.cut > 0.05 && world.t - (world.calib.lastCutEvent ?? -99) >= 6) {
    world.calib.lastCutEvent = world.t;
    addEvent(world, 'sequester', `Казна пуста: расходы урезаны на ${Math.round(gov.cut * 100)}%`, { cut: gov.cut });
  }
  // дефолт
  const ann = Math.max(1, ctx.gdpM * 12);
  if (gov.debt / ann > 3.5 || (gov.interestRate * gov.debt / 12 > 0.55 * Math.max(1, gov.revenue) && gov.debt / ann > 1.2)) {
    for (const h of hh) h.bonds *= 0.6;
    gov.debt *= 0.6; gov.debtAbroad = (gov.debtAbroad || 0) * 0.6;
    world.shock.expropriation += 0.4;
    addEvent(world, 'default', 'Государство объявило дефолт по облигациям: держатели получили 60 копеек за рубль и урок финансовой грамотности', { debt: gov.debt });
    gov.defaults = (gov.defaults || 0) + 1;
  }
  world.calib.emiEMA = 0.85 * (world.calib.emiEMA || 0) + 0.15 * ((world.flows.emission || 0) / Math.max(1, world.moneySupply));
}

/** Итоги месяца по бюджету. */
export function governmentBooks(world, ctx) {
  const gov = world.gov;
  const f = world.flows;
  const rev = {}, sp = {};
  let r = 0, s = 0;
  for (const k of REV_KINDS) { rev[k] = f[k] || 0; r += rev[k]; }
  rev.dividends = ctx.stateDiv || 0; r += rev.dividends;
  rev.acquisitions = ctx.privatizationProceeds || 0; r += rev.acquisitions;
  for (const k of SPEND_KINDS) { sp[k] = f[k] || 0; s += sp[k]; }
  sp.corruption = ctx.leakPaid || 0; s += sp.corruption;
  gov.revenueByKind = rev;
  gov.spendingByKind = sp;
  gov.revenue = r;
  gov.spending = s;
  gov.balance = r - s;
}

/** Коррупция, тень, собираемость, преступность, инфраструктура. Вызывается в конце месяца. */
export function governmentQuality(world, ctx) {
  const pol = world.policies;
  const A = world.assumptions;
  const gov = world.gov;
  const gdpM = Math.max(1, ctx.gdpM);
  // ── коррупция
  let stateOut = 0, totalOut = 0;
  for (const f of world.firms) {
    if (!f.alive) continue;
    const v = f.output * f.price;
    totalOut += v;
    if (f.owner === 'state') stateOut += v;
  }
  const stateShare = stateOut / Math.max(1, totalOut);
  let lic = 0;
  for (const g of GOODS) if (pol.industry[g].ownership === 'licensed') lic++;
  const dist = 0.6 * clamp(gov.spending / gdpM, 0, 1) + 0.5 * stateShare + 0.4 * lic / GOODS.length;
  const pay_ = clamp((pol.officialPay - 0.5) / 1.5, 0, 1);
  const corrT = clamp((0.06 + 0.9 * dist) * (1 - 0.35 * pol.pressFreedom) * (1 - 0.35 * pol.courtsIndependence) * (1 - 0.25 * pay_) * (1 + 0.15 * pol.repression) * (1 + 0.4 * ctx.blackTurnover / gdpM) * (pol.elections === 'none' ? 1.15 : pol.elections === 'managed' ? 1.07 : 1), 0.02, 0.95);
  gov.corruption += 0.03 * (corrT - gov.corruption);
  // ── тень и собираемость
  const burden = pol.payrollTax + 0.7 * avgMarginal(pol.incomeTaxBrackets) + 0.4 * pol.corpTax + 0.3 * pol.vat + 0.1 * Math.max(0, pol.minWage - 0.5) + 0.25 * pol.regulationBurden
    + 0.25 * pol.wealthTax * 10 + 0.1 * pol.dividendTax;
  // что граждане получают взамен налогов: госуслуги, независимые суды, честность чиновников — терпимость к налогам выше
  const svc = ctx.carry.svcMet ?? 0.9;
  const quality = 0.45 * svc + 0.3 * pol.courtsIndependence + 0.25 * (1 - gov.corruption);
  const tolerance = 0.14 + 0.3 * quality * A.servicesTrust;
  const excess = Math.max(0, burden - tolerance);
  let shT = 0.04 + A.evasionSensitivity * 1.1 * Math.pow(excess, 1.1);
  // сильная налоговая служба резко снижает уклонение, слабая — почти не мешает
  shT *= clamp(1.9 - 1.7 * pol.taxAdmin * A.taxEnforcement, 0.2, 2) * (1 + 0.5 * gov.corruption);
  shT = clamp(shT, 0.02, 0.85);
  gov.shadowShare += 0.04 * (shT - gov.shadowShare);
  gov.taxCompliance = clamp((0.7 + 0.3 * pol.taxAdmin) * (1 - gov.shadowShare), 0.05, 1);
  // ── преступность
  const pov = ctx.povertyShare;
  const bm = ctx.blackTurnover / gdpM;
  // мотивы: бедность и безработица; сдерживание: реально поставленная безопасность (государственная или частная — частную
  // покупают те, у кого есть деньги), суды, защита собственности, репрессии; беззаконие усиливает всё
  const motive = 0.5 * pov + 0.6 * ctx.unemployment + 0.2;
  const deter = clamp(0.45 * ctx.secEff * (1 - 0.4 * gov.corruption) + 0.25 * pol.courtsIndependence + 0.2 * pol.propertyRights + 0.3 * pol.repression, 0, 1);
  const lawGap = 1 - 0.5 * pol.courtsIndependence - 0.5 * pol.propertyRights; // при умолчаниях 0.35
  const lawless = Math.max(0.7, 1 + 1.6 * A.lawlessCost * (lawGap - 0.35));
  // репрессии подавляют именно уличную преступность (чёрный рынок и коррупция от них не исчезают)
  const crimeT = clamp(((0.06 + 0.9 * motive * (1 - 0.8 * deter)) * lawless * (1 - 0.6 * pol.repression) + 0.4 * bm), 0.02, 0.97);
  gov.crime += 0.04 * (crimeT - gov.crime);
  // ── инфраструктура
  const rel = ctx.infraDelivered / gdpM / 0.02;
  const tgt = 0.6 + 0.4 * Math.min(2.2, Math.pow(Math.max(0, rel), 0.6));
  gov.infrastructure = clamp(gov.infrastructure + 0.03 * (tgt - gov.infrastructure), 0.4, 1.5);
  // ── технологический рост
  const sciRel = Math.min(5, ctx.sciDelivered / gdpM / 0.005);
  // накопленный научный задел: годами копится и годами выветривается
  ctx.carry.sciIdx = 0.99 * (ctx.carry.sciIdx ?? 1) + 0.01 * sciRel;
  ctx.techGrowthNext = 0.0002 + 0.00035 * ctx.carry.sciIdx + 0.00015 * clamp(ctx.eduCov, 0, 1) + 0.0001 * Math.min(1, ctx.carry.qEdu || 0);
}

/** Внешний сектор: курс, резервы, движение капитала. */
export function externalSector(world, ctx) {
  const pol = world.policies;
  const gov = world.gov;
  const ab = world.abroad;
  const hh = world.households;
  const gdpM = Math.max(1, ctx.gdpM);
  ab.lastTrade = { imports: ctx.importsValue || 0, exports: ctx.exportsValue || 0, duty: ctx.exportDuty || 0 };   // для клиринга соседей
  // ── движение капитала: бегство капитала при худших, чем в базовом сценарии, условиях
  const pr = 1 - ctx.effPR;
  const push = 6 * pol.wealthTax + 0.5 * Math.max(0, pol.corpTax - 0.2) + 0.4 * Math.max(0, pol.dividendTax - 0.1) + 0.25 * Math.max(0, pol.inheritanceTax - 0.2)
    + 1.0 * Math.max(0, pr - 0.45) * world.assumptions.lawlessCost + 0.4 * Math.max(0, gov.crime - 0.35) + 0.5 * world.shock.expropriation + 0.3 * Math.max(0, gov.shadowShare - 0.25);
  let capNet = 0;
  {
    // фоновый вывод части сбережений за границу (диверсификация) + бегство при плохих условиях
    const rate = (0.002 + clamp((push - 0.02) * 0.03, 0, 0.02)) * (1 - pol.capitalControls);
    if (rate > 0) {
      for (const h of hh) {
        const ex = h.cash - 10 * Math.max(h.netIncome, ctx.medWage);
        if (ex > 0) capNet -= safePay(world, h, ab, ex * rate, 'capital_flight');
      }
    }
  }
  if (foreignFunds(ab) > 0 && push <= 0.1) {
    // возврат капитала и иностранные вложения: чем больше денег накопилось за границей, тем охотнее они возвращаются
    const over = Math.max(0, ab.cash / (2 * gdpM) - 1);
    const amt = foreignFunds(ab) * clamp(0.03 + 0.3 * over, 0, 0.3) * (1 - 0.7 * pol.capitalControls) * (ab.plan ? (pol.foreignInvestment === 'banned' ? 0 : pol.foreignInvestment === 'limited' ? 0.4 : 1) : 1);
    let cand = world.firms.filter(f => f.alive && f.owner === 'private' && f.util > 0.8);
    if (!cand.length) cand = world.firms.filter(f => f.alive && f.owner === 'private');
    if (amt > 0 && cand.length) {
      const each = amt / cand.length;
      for (const f of cand) pay(world, ab, f, each, 'investment');
      capNet += amt;
      if (ab.plan) ab.avail -= amt;
    }
  }
  ctx.capitalNet = capNet; // отрицательное — отток
  // ── курс
  const nx = (ctx.tradeBalance + Math.min(0, capNet)) / gdpM;
  ctx.nxEMA = 0.6 * (ctx.nxEMA || 0) + 0.4 * nx;
  ab.nx = ctx.nxEMA;
  if (pol.fxRegime === 'float' || ab.pegBroken) {
    ab.peg = 0;
    let lf = Math.log(ab.fx) + clamp(-0.3 * ctx.nxEMA, -0.025, 0.025) - 0.015 * Math.log(ab.fx);
    // связанный мир: номинальный курс следует за уровнем цен относительно соседей (паритет покупательной способности), а торговый баланс двигает
    // только реальный курс (дефицит — реальное обесценивание, профицит — укрепление), причём в ограниченных пределах. Иначе дефицит гонит курс
    // вверх без конца, импорт дорожает, цены растут вслед за курсом, дефицит не уходит — и так до гиперинфляции
    const ref = ab.pppRef || 1;
    if (ab.plan) {
      ab.rer = clamp((ab.rer || 0) * 0.985 + clamp(-0.6 * ctx.nxEMA, -0.03, 0.03), -0.6, 0.6);
      const target = Math.log(Math.max(0.05, ctx.cpi / ref)) + Math.log(ab.fxCal || 1) + ab.rer;
      lf = Math.log(ab.fx) + 0.25 * (target - Math.log(ab.fx));
      ab.fx = clamp(Math.exp(lf), 0.05, 1e7);
    } else if (ab.pegBroken) {
      // после слома привязки свободный курс догоняет внутренние цены (паритет покупательной способности): без этого импорт дешевел бы при любой инфляции
      lf = Math.log(ab.fx) + clamp(-0.3 * ctx.nxEMA, -0.025, 0.025) + clamp(0.06 * (Math.log(Math.max(0.3, ctx.cpi)) - Math.log(ab.fx)), -0.02, 0.1);
      ab.fx = clamp(Math.exp(lf), 0.5, 1e6);
    } else ab.fx = clamp(Math.exp(lf), 0.5, 2.5);
    if (pol.fxRegime === 'fixed') {
      // курс отпущен после слома привязки: резервы копятся заново, и когда их хватает на полгода импорта при неотрицательном сальдо, власти снова фиксируют курс
      ab.reserves += ctx.tradeBalance / ab.fx + capNet / ab.fx * 0.5;
      if (ab.reserves > 6 * Math.max(1, ctx.importsValue / ab.fx) && ctx.nxEMA >= 0) { ab.pegBroken = false; ab.peg = ab.fx; }
    }
  } else {
    if (!ab.peg) ab.peg = ab.fx;
    ab.fx = ab.peg;
    ab.reserves += ctx.tradeBalance / ab.fx + capNet / ab.fx * 0.5;
    if (ab.reserves < 0) {
      // резервы кончились: привязку не удержать, курс сначала обваливается на 40%, затем плавает, пока резервы не восстановятся
      ab.fx *= 1.4; ab.peg = 0; ab.pegBroken = true;
      ab.reserves = 2 * Math.abs(ctx.importsValue || 1) / ab.fx;
      addEvent(world, 'devaluation', 'Резервы кончились, и фиксированный курс устал быть фиксированным: валюта подешевела на 40%', { fx: ab.fx });
    }
  }
}

/**
 * Денежная стабилизация: когда безработица выше естественной, центробанк раздаёт новые деньги домохозяйствам
 * с доходом ниже медианы (вертолёт по правилу). Ставка ЦБ выше нейтральной гасит стимул, ниже — усиливает.
 * Это единственный канал, возвращающий экономику к занятости после спада: без него она застревает на низком спросе.
 */
export function monetaryStabilizer(world, ctx) {
  const pol = world.policies;
  if (pol.cbMandate === 'none') return;
  // цена: инфляция ниже цели (дефляция) — стимул при любом мандате с целью по ценам; занятость — только при двойном мандате
  const gapP = Math.max(0, pol.inflationTarget - world.stats.inflation - 0.012);
  const gapU = pol.cbMandate === 'dual' ? Math.max(0, ctx.carry.unemployment - 0.08) : 0;
  // дефляция при перегретом рынке труда — от роста производительности, а не от нехватки денег: раздача денег в такой момент
  // лишь раздувает спрос на труд, поэтому реакция на ценовой разрыв включается по мере появления безработицы
  const slack = clamp((ctx.carry.unemployment - P.stabSlack0) / (P.stabSlack1 - P.stabSlack0), 0, 1);
  const gap = gapU + 1.0 * gapP * slack;
  if (!(gap > 0)) return;
  const stance = clamp(1 - 12 * (pol.cbRate - 0.05), 0, 1.6);
  // центробанк с мандатом на цены не раздаёт деньги, когда инфляция уже далеко выше цели: иначе безработица от внешней причины
  // (например, дешёвый импорт) запускает печать денег, цены растут, зарплаты и «пособие» за ними, и это не кончается
  const brake = clamp(1 - Math.max(0, world.stats.inflation - pol.inflationTarget - 0.03) / 0.08, 0, 1);
  const total = P.stabilizer * gap * ctx.avgWage * world.households.length * stance * brake;
  if (!(total > 0)) return;
  const rec = world.households.filter(h => h.netIncome < ctx.medWage * 0.9 && h.status !== 'retired');
  if (!rec.length) return;
  const each = total / rec.length;
  for (const h of rec) { mint(world, h, each, 'cb_stimulus'); h.incomeBySource.transfer += each; }
  if (total > 0.012 * world.moneySupply && world.t - (world.calib.lastStimEvent ?? -99) >= 12) {
    world.calib.lastStimEvent = world.t;
    addEvent(world, 'cb_stimulus', `Центробанк (безработица ${Math.round(ctx.carry.unemployment * 100)}%, инфляция ${(world.stats.inflation * 100).toFixed(1)}%) раздаёт населению новые деньги: ${Math.round(total).toLocaleString('ru-RU')} в месяц`, { total });
  }
}
