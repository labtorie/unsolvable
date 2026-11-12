// Рынки товаров: потребление домохозяйств, закупки фирм (b2b, инвестиции), госзакупки,
// импорт, экспорт, потолки цен, чёрный рынок.
import { NEEDS } from '../schema.js';
import { pay } from '../ledger.js';
import { rand, randInt } from '../rng.js';
import { IND, GOODS, P } from './params.js';
import { clamp, DUMMY, makePool, safePay } from './util.js';

const NN = NEEDS.length;
const NEED_OF = {};
NEEDS.forEach((n, i) => { NEED_OF[n.good] = i; });
const MODE_KEY = { health: 'healthMode', education: 'educationMode', security: 'securityMode' };
const BUDGET_KEY = { health: 'healthBudget', education: 'educationBudget', security: 'securityBudget' };
const FREE_NEEDS = ['health', 'education', 'security'];
const BM_MULT = 1.8;

function importAllowed(world, ctx, g) {
  const ind = IND[g];
  if (!ind.tradable) return false;
  const pol = world.policies;
  if (g === 'vice' && pol.vicePolicy === 'banned') return false;
  return world.abroad.worldPrice[g] > 0;
}

/** Цены импорта и допуск (до планирования фирм). */
export function prepTrade(world, ctx) {
  const pol = world.policies;
  ctx.impPrice = {};
  ctx.impAllowed = {};
  ctx.expParity = {};
  for (const g of GOODS) {
    const ip = pol.industry[g];
    let ok = importAllowed(world, ctx, g);
    const pI = ok ? world.abroad.worldPrice[g] * world.abroad.fx * (1 + ip.tariff) : 0;
    // при потолке цены ниже импортной цены импортёры не продают
    if (ok && ip.priceCap > 0) {
      const avgUC = ctx.by[g].length ? ctx.by[g].reduce((a, f) => a + f.unitCost, 0) / ctx.by[g].length : 0;
      if (pI > ip.priceCap * avgUC) ok = false;
    }
    ctx.impAllowed[g] = ok;
    const d = ip.exportDuty;
    ctx.expParity[g] = IND[g].resource && IND[g].tradable && d < 0.98 && world.abroad.worldPrice[g] > 0 ? world.abroad.worldPrice[g] * world.abroad.fx * (1 - d) : 0;
    ctx.impPrice[g] = ok ? pI : 0;
  }
}

function sellerWeights(world, ctx, g, mk) {
  const sellers = [];
  const fs = ctx.by[g];
  let capSum = 0, pw = 0;
  for (const f of fs) {
    const cap = Math.max(f.capacity || 0, 1e-6);
    capSum += cap; pw += cap * f.price;
  }
  const pmean = capSum > 0 ? pw / capSum : (world.markets[g].price || 1);
  const eps = P.priceEps;
  const rows = [];
  let tot = 0;
  for (const f of fs) {
    const cap = Math.max(f.capacity || 0, 1e-6);
    const w = cap * Math.exp(-eps * (f.price / pmean - 1));
    rows.push(w); tot += w;
  }
  // импорт как ещё один продавец
  let wImp = 0;
  const st = world.ind[g];
  if (ctx.impAllowed[g]) {
    const pI = ctx.impPrice[g];
    wImp = st.impK * capSum * Math.exp(-eps * (pI / pmean - 1));
    tot += wImp;
  }
  const lam = 1 - P.shareInertia;
  let ssum = 0;
  fs.forEach((f, i) => {
    const w = tot > 0 ? rows[i] / tot : 1 / fs.length;
    f.share = f.share > 0 ? P.shareInertia * f.share + lam * w : w;
    ssum += f.share;
  });
  const impShare = tot > 0 ? wImp / tot : 0;
  st.impShare = st.impShare >= 0 && st.impShare != null ? P.shareInertia * st.impShare + lam * impShare : impShare;
  ssum += st.impShare;
  mk.pmean = pmean;
  mk.sellers = fs;
  mk.s = fs.map(f => f.share / ssum);
  mk.sImp = ctx.impAllowed[g] ? st.impShare / ssum : 0;
  // котировка цены для покупателей
  let q = 0;
  fs.forEach((f, i) => { q += mk.s[i] * f.price; });
  if (ctx.impAllowed[g]) q += mk.sImp * ctx.impPrice[g];
  const sumS = mk.s.reduce((a, b) => a + b, 0) + mk.sImp;
  mk.quote = sumS > 0 ? q / sumS : (world.markets[g].price || ctx.price[g] || 1);
  mk.capSum = capSum;
}

export function runMarkets(world, ctx) {
  const pol = world.policies;
  const A = world.assumptions;
  const gov = world.gov;
  const hh = world.households;
  const N = hh.length;
  const S = world.calib.demandScale;
  const med = Math.max(1, ctx.medWage);
  const cmp = ctx.cmp;

  for (const f of world.firms) { f.sales = 0; f.revenue = 0; f.orders = 0; f.exportsQty = 0; }
  const MK = {};
  for (const g of GOODS) { MK[g] = {}; sellerWeights(world, ctx, g, MK[g]); }

  // ── потребность домохозяйств
  const dem = new Float64Array(N * NN);
  const freeQ = new Float64Array(N * NN);
  const basePD = new Float64Array(NN);
  const unitCost = new Float64Array(NN);   // цена за единицу с налогами для покупателя
  const vatRate = new Float64Array(NN);
  const pmult = pol.vicePolicy === 'licensed' ? 1.12 : 1;
  const blackGood = {};
  for (let n = 0; n < NN; n++) {
    const nd = NEEDS[n];
    const g = nd.good;
    const ip = pol.industry[g];
    const rel = (MK[g].quote / Math.max(1e-9, ctx.cpi * world.basePrice[g]));
    const eta = nd.basic ? 0.2 : 0.8;
    basePD[n] = clamp(Math.pow(Math.max(rel, 0.05), -eta), 0.35, 1.5);
    let v = pol.vat * cmp;
    if (nd.id === 'food' && pol.vatFoodExempt) v = 0;
    if (nd.id === 'health' || nd.id === 'education' || nd.id === 'security') v = 0;
    vatRate[n] = v;
    let q = MK[g].quote * pmult * (nd.id === 'vice' ? 1 + pol.exciseVice * cmp : 1);
    if (g === 'vice' && pol.vicePolicy === 'banned') q = world.basePrice.vice * ctx.cpi * BM_MULT;
    unitCost[n] = q * (1 + v);
    blackGood[g] = (g === 'vice' && pol.vicePolicy === 'banned');
  }
  // дробное население: показатели порядка очерёдности
  // бесплатные блага: госзакупки
  const govBuy = {};
  const freeCov = new Float64Array(NN);   // доля покрытия потребности
  const freeElig = new Float64Array(NN);  // 0 — всем, 1 — только бедным
  for (const key of FREE_NEEDS) {
    const n = NEED_OF[key === 'health' ? 'health' : key === 'education' ? 'education' : 'security'];
    const nd = NEEDS[n];
    const g = nd.good;
    const mode = pol[MODE_KEY[g]];
    freeCov[n] = 0;
    if (g === 'security' ? mode === 'private' : mode === 'private') continue;
    const budget = pol[BUDGET_KEY[g]] * ctx.gdpM * ctx.cutK;
    const leakF = clamp(gov.corruption * 0.5 * A.corruptionLeak, 0, 0.8);
    const Q = (budget * (1 - leakF)) / Math.max(1e-9, MK[g].quote);
    let D = 0;
    const elig = mode === 'mixed' && g !== 'security';
    for (let i = 0; i < N; i++) {
      const h = hh[i];
      if (elig && !(h.netIncome < med * 1.1)) continue;
      D += S * nd.sat * basePD[n];
    }
    const room = g === 'security' ? 1 : 1.12; // сверх покрытия потребности деньги идут в качество услуг
    const buyQ = D > 0 ? Math.min(Q, room * D) : 0;
    freeCov[n] = D > 0 ? Math.min(1, buyQ / D) : 0;
    freeElig[n] = elig ? 1 : 0;
    govBuy[g] = { q: buyQ, leakF, budget };
    if (g === 'health') world.calib.carry.qHealth = D > 0 ? Math.max(0, buyQ / D - 1) : 0;
    if (g === 'education') world.calib.carry.qEdu = D > 0 ? Math.max(0, buyQ / D - 1) : 0;
  }

  // с ростом производительности растут и желания: «новые товары» в нематериальных и необязательных потребностях
  const tb = Math.pow(Math.max(1, world.calib.techIdx || 1), 0.9);
  let Bbasic = 0, Bnon = 0;
  for (let n = 0; n < NN; n++) { const c = S * NEEDS[n].sat * basePD[n] * unitCost[n]; if (NEEDS[n].basic) Bbasic += c; else Bnon += c * tb; }
  // ── бюджеты домохозяйств и спрос
  const blackDem = new Float64Array(N * NN);
  for (let i = 0; i < N; i++) {
    const h = hh[i];
    const y = Math.max(1, h.netIncome);
    const ratio = Math.max(1, y / med);
    const theta = clamp(0.85 - 0.08 * Math.log(ratio), 0.35, 0.85);
    let budget = Math.max(0, h.cash) * theta;
    const lux = clamp((0.93 * Math.max(y, 0.03 * h.cash) - Bbasic) / Bnon, 1, 3.5);
    for (let n = 0; n < NN; n++) {
      const nd = NEEDS[n];
      const sat = S * nd.sat;
      const base = sat * basePD[n] * (nd.basic ? 1 : lux * tb);
      let free = 0;
      if (freeCov[n] > 0 && (!freeElig[n] || h.netIncome < med * 1.1)) free = Math.min(base, sat * basePD[n] * freeCov[n]);
      freeQ[i * NN + n] = free;
      const priv = base - free;
      if (priv <= 0) continue;
      const q = Math.min(priv, budget / unitCost[n]);
      if (q <= 0) continue;
      budget -= q * unitCost[n];
      if (blackGood[nd.good]) blackDem[i * NN + n] = q; else dem[i * NN + n] = q;
    }
  }

  // ── спрос фирм (сырьё, инвестиции) и прочих покупателей
  const reqs = {};
  for (const g of GOODS) reqs[g] = [];
  const invShare = P.invGoods;
  for (const f of world.firms) {
    if (!f.alive) continue;
    const ind = IND[f.industry];
    const planned = Math.max(f.output, f.demandEMA, f.target || 0);
    let cashLeft = f.cash * 0.75;
    for (const k in ind.inputs) {
      let want = ind.inputs[k] * planned * 1.45 - (f.inputStock[k] || 0);
      if (want <= 0) continue;
      const cost = MK[k].quote;
      want = Math.min(want, cashLeft / Math.max(1e-9, cost));
      if (want <= 0) continue;
      cashLeft -= want * cost;
      reqs[k].push({ f, q: want, t: 0 });
    }
    if (f.capexBudget > 0) {
      const b = Math.min(f.capexBudget, Math.max(0, f.cash * 0.8 - 0));
      for (const g in invShare) {
        const q = (b * invShare[g]) / Math.max(1e-9, MK[g].quote);
        if (q > 0) reqs[g].push({ f, q, t: 1 });
      }
    }
    f.capexBudget = 0;
  }
  // госзакупки инфраструктуры и науки
  const infraBudget = pol.infrastructureBudget * ctx.gdpM * ctx.cutK;
  const sciBudget = pol.scienceBudget * ctx.gdpM * ctx.cutK;
  const leakF = clamp(gov.corruption * 0.5 * A.corruptionLeak, 0, 0.8);
  const govOther = {
    construction: { q: (infraBudget * (1 - leakF)) / Math.max(1e-9, MK.construction.quote), leakF, tag: 'infra' },
    tech: { q: (sciBudget * (1 - leakF)) / Math.max(1e-9, MK.tech.quote), leakF, tag: 'science' },
  };

  // ── экспорт: спрос заграницы
  const exportQ = {};
  for (const g of GOODS) {
    const ind = IND[g];
    exportQ[g] = 0;
    if (!ind.tradable) continue;
    const ip = pol.industry[g];
    const d = ip.exportDuty;
    if (d >= 0.98) continue;
    if (g === 'vice' && pol.vicePolicy === 'banned') continue;
    const tau = d / (1 - d);
    const wp = world.abroad.worldPrice[g];
    const ratio = (wp * world.abroad.fx) / (MK[g].quote * (1 + tau));
    exportQ[g] = world.ind[g].expBase * clamp(Math.pow(ratio, 2), 0, 4);
  }

  // ── очистка рынков
  const stats = { exportsValue: 0, importsValue: 0 };
  for (const h of hh) h.needsMet = {};
  let blackTurnover = 0;
  const bmFrac = clamp(0.8 - 0.9 * ctx.secEff, 0.1, 0.9);
  const blackPool = makePool();
  const capByGood = {};
  const capPool = makePool(); // теневая выручка производителей товаров под потолком цены
  let bmShareSum = 0;

  for (const g of GOODS) {
    const ind = IND[g];
    const mk = MK[g];
    const ip = pol.industry[g];
    const n = NEED_OF[g];
    // суммарный спрос по типам
    let Dhh = 0;
    if (n !== undefined) for (let i = 0; i < N; i++) Dhh += dem[i * NN + n];
    let Dgov = 0, Dfirm = 0, Dcap = 0;
    if (govBuy[g]) Dgov += govBuy[g].q;
    if (govOther[g]) Dgov += govOther[g].q;
    for (const r of reqs[g]) { if (r.t === 0) Dfirm += r.q; else Dcap += r.q; }
    const Dexp = exportQ[g];
    const D = Dhh + Dgov + Dfirm + Dcap + Dexp;
    const st = world.markets[g];
    const sellers = mk.sellers;
    const ns = sellers.length;
    const avail = new Float64Array(ns);
    const sold = new Float64Array(ns);
    for (let k = 0; k < ns; k++) avail[k] = sellers[k].inventory;
    let soldImp = 0;
    let R = D;
    const w = mk.s;
    const impOn = mk.sImp > 0;
    const impLimit = D * (ip.tariff < 1 ? 1 : Math.min(0.6, 4 * mk.sImp + 0.03)); // запретительная пошлина: импорт только «на подхвате»
    for (let round = 0; round < 4 && R > 1e-9; round++) {
      let Ws = impOn ? mk.sImp : 0;
      for (let k = 0; k < ns; k++) if (avail[k] > 1e-9) Ws += w[k];
      if (Ws <= 0) break;
      let given = 0;
      for (let k = 0; k < ns; k++) {
        if (avail[k] <= 1e-9) continue;
        const q = Math.min(avail[k], (R * w[k]) / Ws);
        sold[k] += q; avail[k] -= q; given += q;
        if (round === 0) sellers[k].orders += D * w[k];
      }
      if (impOn) { const q = Math.min((R * mk.sImp) / Ws, Math.max(0, impLimit - soldImp)); soldImp += q; given += q; }
      R -= given;
    }
    let delivered = D - R;
    const fill = D > 1e-12 ? delivered / D : 1;
    let grossDom = 0;
    for (let k = 0; k < ns; k++) grossDom += sold[k] * sellers[k].price;
    const pI = ctx.impPrice[g] || 0;
    const wpFx = (world.abroad.worldPrice[g] || 0) * world.abroad.fx;
    const grossImp = soldImp * pI;
    const gross = grossDom + grossImp;
    const pAvg = delivered > 1e-12 ? gross / delivered : mk.quote;

    // платежи покупателей в пулы по типам
    const pools = { hh: makePool(), firm: makePool(), cap: makePool(), gov: makePool(), exp: makePool() };
    // домохозяйства
    let hhDelivered = 0;
    if (n !== undefined) {
      const nd = NEEDS[n];
      const vat = vatRate[n];
      const exc = nd.id === 'vice' ? pol.exciseVice * cmp : 0;
      const pmul = nd.id === 'vice' && pol.vicePolicy === 'licensed' ? 1.12 : 1;
      for (let i = 0; i < N; i++) {
        const h = hh[i];
        let q = dem[i * NN + n] * fill;
        if (q > 0) {
          const price = pAvg * pmul;
          let cost = q * price;
          const tot = cost * (1 + vat + exc);
          if (tot > h.cash) { const k = h.cash / tot; q *= k; cost *= k; }
          if (cost > 0) {
            pay(DUMMY, h, pools.hh, cost, 'consumption');
            if (vat > 0) pay(world, h, gov, cost * vat, 'tax_vat');
            if (exc > 0) pay(world, h, gov, cost * exc, 'tax_excise');
            hhDelivered += q;
          }
        }
        const fr = freeQ[i * NN + n] * fill;
        let tot = q + fr;
        // чёрный рынок: потолок цен, запрет
        if (blackGood[g]) {
          const bq = blackDem[i * NN + n] * bmFrac;
          if (bq > 0) {
            const bp = world.basePrice.vice * ctx.cpi * BM_MULT;
            let c = bq * bp;
            const cc = Math.min(c, h.cash);
            const k = c > 0 ? cc / c : 0;
            if (cc > 0) { pay(DUMMY, h, blackPool, cc, 'black_market'); blackTurnover += cc; tot += bq * k; }
          }
        } else if (ip.priceCap > 0 && fill < 0.995 && dem[i * NN + n] > 0) {
          const unmet = dem[i * NN + n] * (1 - fill) * bmFrac;
          const bp = Math.max(mk.quote, sellers.length ? sellers.reduce((a, f) => a + f.priceFree, 0) / sellers.length : mk.quote) * BM_MULT;
          let c = unmet * bp;
          const cc = Math.min(c, Math.max(0, h.cash) * 0.9);
          const k = c > 0 ? cc / c : 0;
          if (cc > 0) { pay(DUMMY, h, capPool, cc, 'black_market'); capByGood[g] = (capByGood[g] || 0) + cc; blackTurnover += cc; tot += unmet * k; }
        }
        h.needsMet[nd.id] = clamp(tot / (S * nd.sat), 0, 1);
      }
    }
    // фирмы: сырьё и капитал
    let firmDel = 0, capDel = 0;
    for (const r of reqs[g]) {
      const q = r.q * fill;
      const cost = Math.min(q * pAvg, r.f.cash);
      if (cost <= 0) continue;
      const qd = q * (cost / (q * pAvg));
      if (r.t === 0) {
        pay(DUMMY, r.f, pools.firm, cost, 'b2b');
        const old = r.f.inputStock[g] || 0;
        r.f.inputCost[g] = ((r.f.inputCost[g] || pAvg) * old + cost) / Math.max(1e-9, old + qd);
        r.f.inputStock[g] = old + qd;
        firmDel += qd;
      } else {
        pay(DUMMY, r.f, pools.cap, cost, 'investment');
        r.f.capital += cost / ctx.capUnit;
        r.f.capex += cost;
        capDel += qd;
      }
    }
    // государство
    let govCost = 0;
    if (Dgov > 0) {
      const q = Dgov * fill;
      govCost = q * pAvg;
      pay(DUMMY, gov, pools.gov, govCost, 'gov_procurement');
      const lf = (govBuy[g]?.leakF ?? govOther[g]?.leakF ?? 0);
      if (lf > 0) ctx.leak += govCost * lf / (1 - lf);
      if (govOther[g]) {
        const share = govOther[g].q / Dgov;
        if (govOther[g].tag === 'infra') ctx.infraDelivered += govCost * share;
        if (govOther[g].tag === 'science') ctx.sciDelivered += govCost * share;
      }
    }
    // экспорт
    let expCost = 0, expQ = 0, duty = 0;
    if (Dexp > 0) {
      expQ = Dexp * fill;
      expCost = expQ * pAvg;
      const d = ip.exportDuty;
      const tau = d / (1 - d);
      pay(DUMMY, world.abroad, pools.exp, expCost, 'exports');
      duty = expCost * tau;
      if (duty > 0) pay(world, world.abroad, gov, duty, 'tariffs');
    }

    // выплаты из пулов продавцам
    const kinds = [['hh', 'consumption'], ['firm', 'b2b'], ['cap', 'investment'], ['gov', 'gov_procurement'], ['exp', 'exports']];
    for (const [key, kind] of kinds) {
      const pool = pools[key];
      if (!(pool.cash > 1e-12)) continue;
      const amt = pool.cash;
      for (let k = 0; k < ns; k++) {
        if (sold[k] <= 0) continue;
        const part = (amt * sold[k] * sellers[k].price) / gross;
        if (part > 0) { pay(world, pool, sellers[k], part, kind); sellers[k].revenue += part; }
      }
      if (grossImp > 0) {
        const partI = (amt * grossImp) / gross;
        const goods = partI * (wpFx / pI);
        const tariffPart = partI - goods;
        pay(world, pool, world.abroad, goods, 'imports');
        pay(world, pool, gov, tariffPart, 'tariffs');
        stats.importsValue += goods;
      }
      pool.cash = Math.abs(pool.cash) < 1e-7 ? 0 : pool.cash;
    }
    for (let k = 0; k < ns; k++) { sellers[k].sales += sold[k]; sellers[k].inventory -= sold[k]; if (sellers[k].inventory < 0) sellers[k].inventory = 0; }
    stats.exportsValue += expCost;

    // сводка рынка
    const dom = sold.reduce((a, b) => a + b, 0);
    st.demand = D - Dexp;
    st.sold = delivered - expQ;
    st.shortage = D > 1e-9 ? clamp(1 - fill, 0, 1) : 0;
    st.imports = soldImp;
    st.exports = expQ;
    if (delivered > 1e-9) st.price = pAvg;
    st.firms = ns;
    let hhi = 0;
    if (dom > 1e-9) {
      for (let k = 0; k < ns; k++) { const s = sold[k] / dom; hhi += s * s; sellers[k].marketShare = s; }
    } else { for (let k = 0; k < ns; k++) sellers[k].marketShare = ns ? 1 / ns : 0; hhi = ns ? 1 / ns : 0; }
    st.hhi = hhi;
    world.ind[g].hhi = hhi;
    ctx.price[g] = st.price;
    ctx.pFree[g] = mk.quote;
  }

  // чёрный рынок: выручка уходит подпольным посредникам и чиновникам
  // теневая выручка производителей при потолке цен: они продают часть выпуска из-под полы по рыночной цене
  for (const g in capByGood) {
    const fs = MK[g].sellers.filter(f => f.alive && f.output > 0);
    let tw = 0;
    for (const f of fs) tw += f.output;
    if (!(tw > 0)) continue;
    const a = Math.min(capByGood[g], capPool.cash);
    for (const f of fs) { const part = (a * f.output) / tw; pay(world, capPool, f, part, 'black_market'); f.revenue += part; }
  }
  if (capPool.cash > 1e-9) { pay(DUMMY, capPool, blackPool, capPool.cash, 'black_market'); } // не нашлось производителей — деньги достаются дельцам
  capPool.cash = 0;
  if (blackPool.cash > 0) {
    const total = blackPool.cash;
    const bribe = total * clamp(gov.corruption, 0, 1) * 0.3;
    const offs = [];
    for (const h of hh) if (h.employerId === 0 && h.status === 'employed') offs.push(h);
    let rest = total;
    if (offs.length && bribe > 0) {
      for (const o of offs) { pay(world, blackPool, o, bribe / offs.length, 'corruption'); o.incomeBySource.business += bribe / offs.length; }
      rest -= bribe;
    }
    // дельцы: несколько случайных домохозяйств, выигрывают самые богатые из выбранных
    const cand = [];
    for (let k = 0; k < 14; k++) cand.push(hh[randInt(world, N)]);
    cand.sort((a, b) => b.cash - a.cash);
    const top = cand.slice(0, 5);
    for (const o of top) { pay(world, blackPool, o, rest / top.length, 'black_market'); o.incomeBySource.business += rest / top.length; }
    blackPool.cash = 0;
  }
  ctx.blackTurnover = blackTurnover;
  ctx.tradeBalance = stats.exportsValue - stats.importsValue;
  ctx.exportsValue = stats.exportsValue;
  ctx.importsValue = stats.importsValue;
}
