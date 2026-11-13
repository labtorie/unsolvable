// Один месяц симуляции. Порядок фаз:
// среда → структура собственности → планы фирм → труд → зарплаты → производство → торговля
// → финансы фирм → госрасходы и трансферты → домохозяйства → финансирование бюджета → внешний сектор
// → вход/слияния/банкротства → качество государства → демография → показатели.
import { FLOW_KINDS } from './schema.js';
import { IND, GOODS, P, effOwnership } from './systems/params.js';
import { computeEnv, indexFirms } from './systems/core.js';
import { recount, adjustLabor } from './systems/labor.js';
import { planFirms, payWages, produce, firmFinance, entryBarrier, bankPayout } from './systems/firms.js';
import { prepTrade, runMarkets } from './systems/market.js';
import { governmentSpending, governmentFinance, governmentBooks, governmentQuality, externalSector, worldPrices, monetaryStabilizer } from './systems/government.js';
import { applyOwnership, entryAndStructure, cleanup } from './systems/structure.js';
import { householdFinance } from './systems/households.js';
import { demography } from './systems/demography.js';
import { computeStats } from './systems/stats.js';
import { techPhase } from './systems/tech.js';
import { financePhase } from './systems/finance.js';
import { petitionsPhase, phenomenaPhase } from './systems/society.js';
import { NEEDS } from './schema.js';
import { clamp } from './systems/util.js';
import { beginMonth, endMonth } from './neighbors.js';

const CARRY0 = { secEff: 0.8, eduCov: 0.7, avgHealth: 0.8, povertyShare: 0.1, techGrowth: 0.001, nxEMA: 0, medWealth: 1000, pollIdx: 0.4, unemployment: 0.06 };

function buildCtx(world) {
  const pol = world.policies;
  const gov = world.gov;
  const st = world.stats;
  const N = world.households.length;
  const carry = (world.calib.carry ||= { ...CARRY0 });
  for (const k in CARRY0) if (carry[k] === undefined) carry[k] = CARRY0[k];
  const ctx = {
    N, carry,
    F: [], by: null, workers: [],
    tax: new Float64Array(N),
    medWage: Math.max(1, st.medianWage), avgWage: Math.max(1, st.avgWage),
    cpi: st.cpi || 1,
    inflM: clamp(Math.pow(1 + (st.inflation || 0), 1 / 12) - 1, -0.02, 0.06),
    gdpM: Math.max(1, st.gdp),
    cmp: gov.taxCompliance,
    price: {}, pFree: {},
    avgHealth: carry.avgHealth, pollIdx: carry.pollIdx, secEff: carry.secEff, eduCov: carry.eduCov,
    povertyShare: carry.povertyShare, unemployment: carry.unemployment,
    techGrowth: carry.techGrowth, nxEMA: carry.nxEMA,
    leak: 0, infraDelivered: 0, sciDelivered: 0, forcedPrint: 0, stateDiv: 0, privatizationProceeds: 0, defaultsNow: 0,
    firedNow: 0, strikes: 0, rentCollected: 0, blackTurnover: 0, tradeBalance: 0, exportsValue: 0, importsValue: 0, adminWages: 0,
    wealthRate: pol.wealthTax,
  };
  ctx.floor = pol.minWage * P.baseWage * (world.calib.wbar || 1);
  ctx.eduAccess = clamp(0.2 + 0.8 * carry.eduCov + 0.15 * (carry.qEdu || 0), 0.2, 1.3);
  ctx.benefit = (pol.unemploymentBenefit + pol.ubi) * ctx.avgWage;
  ctx.basicBasket = st.basicBasketCost;
  for (const g of GOODS) ctx.price[g] = world.markets[g].price;
  const cu = P.capUnitMult * (0.65 * ctx.price.manufacturing + 0.35 * ctx.price.construction);
  world.calib.capUnit = world.calib.capUnit > 0 ? 0.85 * world.calib.capUnit + 0.15 * cu : cu;
  ctx.capUnit = world.calib.capUnit;
  // банковская ставка
  const bank = world.bank;
  ctx.effPR = clamp(pol.propertyRights * (1 - 0.5 * gov.crime) * (1 - 0.4 * clamp(world.shock.expropriation, 0, 1)), 0.05, 1);
  // контракты без судов и защиты собственности — дороже кредит
  bank.rate = pol.cbRate + 0.02 + clamp((bank.defRate || 0) * 0.4, 0, 0.03) + 0.05 * Math.max(0, 0.63 - ctx.effPR) * world.assumptions.lawlessCost;
  ctx.rateM = bank.rate / 12;
  {
    // цель по ценам растёт на ~2% в год (меньше, если ЦБ держит ставку выше нейтральной)
    const calib = world.calib;
    // без мандата центробанк цены не ведёт: цель замораживается
    const g = pol.cbMandate === 'none' ? 1 : Math.pow(1 + pol.inflationTarget, 1 / 12) * (1 - 0.3 * (pol.cbRate - 0.05) / 12);
    calib.pStar = (calib.pStar || 1) * g;
    // целевая денежная масса: нормальные остатки × целевой уровень цен × потенциальный выпуск (рост производительности)
    const mStar = (calib.rb0 || 0) * calib.pStar * (calib.gdp0 || 1) * (calib.techIdx || 1);
    ctx.creditMult = 1;
  }
  ctx.cutK = 1 - clamp(gov.cut || 0, 0, 0.98);
  ctx.plannedCount = 0;
  for (const g of GOODS) if (pol.industry[g].planned) ctx.plannedCount++;
  return ctx;
}

function satDemand(world, ctx) {
  const S = world.calib.demandScale;
  const N = world.households.length;
  const d = {};
  for (const g of GOODS) d[g] = 0;
  for (const n of NEEDS) d[n.good] += N * S * n.sat * (n.basic ? 1 : 1.15);
  for (const g of GOODS) {
    const ind = IND[g];
    let capSum = 0;
    for (const f of ctx.by[g]) capSum += (f.capacity || 0);
    for (const k in ind.inputs) d[k] += ind.inputs[k] * capSum * 0.85;
  }
  ctx.satDemand = d;
}

/** Один месяц страны вместе с соседями: клиринг цен и заказов → тик страны → тики соседей → зеркальные проводки на границе. */
export function tick(world) {
  const linked = world.neighbors && world.neighbors.length;
  if (linked) beginMonth(world);
  tickCore(world);
  if (linked) endMonth(world);
  return world;
}

/** Один месяц одной страны (соседи в нём не участвуют: у них своя заграница — через world.abroad.plan). */
export function tickCore(world) {
  world.t++;
  for (const k of FLOW_KINDS) world.flows[k] = 0;
  const ctx = buildCtx(world);
  for (const h of world.households) {
    const s = h.incomeBySource;
    s.wage = 0; s.capital = 0; s.transfer = 0; s.business = 0;
  }
  for (const f of world.firms) f.capex = 0;
  world.shock.expropriation *= 0.985;
  indexFirms(world, ctx);
  computeEnv(world, ctx);
  recount(world, ctx);
  worldPrices(world, ctx);
  prepTrade(world, ctx);
  applyOwnership(world, ctx);
  indexFirms(world, ctx);
  ctx.barrier = {};
  for (const g of GOODS) ctx.barrier[g] = entryBarrier(world, ctx, g);
  ctx.labWage = {};
  for (const p in world.labor) ctx.labWage[p] = world.labor[p].wage;
  satDemand(world, ctx);
  planFirms(world, ctx);
  adjustLabor(world, ctx);
  recount(world, ctx);
  payWages(world, ctx);
  produce(world, ctx);
  runMarkets(world, ctx);
  ctx.indUtil = {};
  for (const g of GOODS) { let o = 0, c = 0; for (const f of ctx.by[g]) if (f.alive) { o += f.orders; c += f.capacity; } ctx.indUtil[g] = c > 0 ? o / c : 0; }
  firmFinance(world, ctx);
  techPhase(world, ctx);       // вторая волна: исследования, лицензии, внедрение, платформы, переобучение
  financePhase(world, ctx);    // вторая волна: оценка фирм, вложения фирм друг в друга, кредиты клиентам, залоги, обвалы
  bankPayout(world, ctx);
  governmentSpending(world, ctx);
  householdFinance(world, ctx);
  governmentFinance(world, ctx);
  monetaryStabilizer(world, ctx);
  ctx.avgMargin = 0;
  { let r = 0, p = 0; for (const f of world.firms) if (f.alive) { r += f.revenue; p += f.profit; } ctx.avgMargin = r > 0 ? p / r : 0; }
  externalSector(world, ctx);
  entryAndStructure(world, ctx);
  governmentQuality(world, ctx);
  demography(world, ctx);
  world.bank.defRate = (world.bank.defRate || 0) * 0.97 + (world.bank.loans > 0 ? ctx.defaultsNow / world.bank.loans : 0);
  computeStats(world, ctx);
  governmentBooks(world, ctx);
  if (!world.lite) {
    petitionsPhase(world, ctx);  // вторая волна: обращения к власти
    phenomenaPhase(world, ctx);  // вторая волна: журнал явлений
  }
  cleanup(world, ctx);
  return world;
}
