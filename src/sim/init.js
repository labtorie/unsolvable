// Начальное население и фирмы. Старт должен быть близок к равновесию модели.
import { INDUSTRIES, NEEDS, PROFESSIONS, makeHousehold, makeFirm, createWorld, createPolicies } from './schema.js';
import { tick } from './tick.js';
import { rand, randNormal, randInt } from './rng.js';
import { totalCash } from './ledger.js';
import { firmName } from './names.js';
import { IND, GOODS, P, PRESETS, PROF_WAGE, SKILLED, hazard, effOwnership } from './systems/params.js';
import { baseMarkup, scaleMult, eff, laborNeed, headcount, envCommon } from './systems/core.js';
import { clamp, median } from './systems/util.js';
import { computeEnv } from './systems/core.js';
import { entryBarrier, markupFor } from './systems/firms.js';
import { unitCostEst } from './systems/core.js';

const DEF_POL = createPolicies();
const PROF_IDS = PROFESSIONS.map(p => p.id);

// Выживаемость по возрасту (Гомпертц) — для стационарной возрастной структуры.


function sampleAges(world, n) {
  const surv = [];
  let s = 1;
  for (let a = 20; a <= 95; a++) { surv.push(s); s *= Math.exp(-hazard(a)); }
  const ages = [];
  while (ages.length < n) {
    const a = 20 + randInt(world, 76);
    if (rand(world) < surv[a - 20]) ages.push(a);
  }
  return ages;
}

/** Цены при данных зарплатах (фиксированная точка по цепочкам поставок). */
function solvePrices(wages, payroll, prodOf) {
  const p = {};
  for (const g of GOODS) p[g] = 10;
  for (let it = 0; it < 80; it++) {
    const capUnit = P.capUnitMult * (0.65 * p.manufacturing + 0.35 * p.construction);
    for (const g of GOODS) {
      const ind = IND[g];
      let c = 0;
      for (const pr in ind.labor) c += (ind.labor[pr] / 100 / prodOf[g]) * wages[pr] * (1 + payroll);
      for (const k in ind.inputs) c += ind.inputs[k] * p[k];
      c += (P.delta * capUnit * ind.capitalPerUnit) / prodOf[g];
      p[g] = c * (1 + baseMarkup(ind));
    }
  }
  return p;
}

export function populate(world, opts = {}) {
  // калибровка по факту: пробный мир живёт несколько месяцев, по заказам подгоняем спрос по отраслям
  const preset = opts.preset || world.preset;
  const mult = {};
  for (const g of GOODS) mult[g] = 1;
  if (!opts.noCalibrate) {
    for (let pass = 0; pass < 4; pass++) {
      const w2 = createWorld({ seed: world.seed, preset });
      if (world.hardBudget) w2.hardBudget = true;   // пробный мир калибруется по тем же правилам, что и игровой
      w2.policies = structuredClone(world.policies);
      buildWorld(w2, { ...opts, preset }, mult);
      const out0 = {}, ord = {};
      for (const g of GOODS) { out0[g] = 0; ord[g] = 0; }
      for (const f of w2.firms) out0[f.industry] += f.output;
      for (let k = 0; k < 7; k++) {
        tick(w2);
        if (k >= 2) for (const f of w2.firms) if (f.alive) ord[f.industry] += f.orders / 5;
        for (const f of w2.firms) if (!f.alive) { /* погибшие в расчёт не идут */ }
      }
      for (const g of GOODS) if (out0[g] > 0) mult[g] *= Math.min(2.5, Math.max(0.25, Math.pow(ord[g] / out0[g], 0.9)));
    }
  }
  buildWorld(world, { ...opts, preset }, mult);
  if (opts.warmup > 0) settle(world, opts.warmup);
  return world;
}

/** Прогрев: мир живёт несколько месяцев, пока переходные процессы старта не затихнут; затем часы и базы сбрасываются. */
function settle(world, months) {
  for (let i = 0; i < months; i++) tick(world);
  world.firms = world.firms.filter(f => f.alive);
  for (const f of world.firms) { f.bornT = 0; f.lastSplitT = -99; f.lossMonths = 0; f.deadT = null; }
  world.t = 0;
  world.events = [];
  for (const k in world.flows) world.flows[k] = 0;
  for (const g of GOODS) world.basePrice[g] = world.markets[g].price;
  const st = world.stats, c = world.calib;
  c.capUnit = P.capUnitMult * (0.65 * world.basePrice.manufacturing + 0.35 * world.basePrice.construction);
  for (const p in world.labor) { world.labor[p].w0 = world.labor[p].wage; world.labor[p].rel = 1; }
  c.wbar = 1; c.pStar = 1; c.techIdx = 1; c.lnRb = 0; c.emiEMA = 0;
  c.rb0 = world.moneySupply / Math.max(1, st.gdpReal);
  c.gdp0 = st.gdpReal;
  st.cpi = 1; st.inflation = 0; st.gdpGrowth = 0;
  world.hist = { cpi: [1], gdpReal: [st.gdpReal] };
  world.bank.defRate = 0; world.bank.defaults = 0;
  world.gov.cut = 0;
  world.shock.expropriation = 0;
}

function buildWorld(world, opts, mult) {
  const N = opts.households || 500;
  const presetKey = PRESETS[opts.preset] ? opts.preset : (PRESETS[world.preset] ? world.preset : 'industrial');
  const preset = PRESETS[presetKey];
  world.preset = presetKey;
  const pol = world.policies;
  const A_RET = pol.retirementAge;

  // ── зарплаты и цены
  const wages = {};
  for (const pr of PROF_IDS) wages[pr] = P.baseWage * PROF_WAGE[pr];
  const prodOf = {};
  for (const g of GOODS) prodOf[g] = preset.prod * (g === 'agri' ? Math.pow(preset.land, 0.4) : 1);
  const p0 = solvePrices(wages, pol.payrollTax, prodOf);

  // ── возрасты: сколько пенсионеров
  const ages = sampleAges(world, N);
  const retired = ages.filter(a => a >= A_RET).length;
  const M = N - retired;
  const self = Math.round(0.07 * N);
  const unempTarget = Math.round(0.06 * N);
  const admin = Math.round(0.03 * N);
  const targetJobs = M - self - unempTarget - admin;

  // ── объём производства по отраслям (с учётом импорта/экспорта)
  const imp = preset.imp, exp = preset.exp;
  const capUnit0 = P.capUnitMult * (0.65 * p0.manufacturing + 0.35 * p0.construction);
  function outputs(S) {
    const hhDem = {};
    for (const g of GOODS) hhDem[g] = 0;
    for (const n of NEEDS) hhDem[n.good] += N * S * n.sat * (n.basic ? 1 : 1.2);
    const y = {};
    for (const g of GOODS) y[g] = hhDem[g];
    for (let it = 0; it < 80; it++) {
      const tot = {};
      for (const g of GOODS) tot[g] = hhDem[g];
      let K = 0;
      for (const i of GOODS) {
        for (const k in IND[i].inputs) tot[k] += IND[i].inputs[k] * y[i];
        K += (y[i] * (i in P.retention ? 1.45 : 1.9) * IND[i].capitalPerUnit) / prodOf[i];
      }
      const invValue = P.delta * K * capUnit0; // замещающие вложения в деньгах
      tot.manufacturing += (invValue * 0.65) / p0.manufacturing;
      tot.construction += (invValue * 0.35) / p0.construction;
      for (const g of GOODS) {
        const s0 = imp[g] || 0, e0 = exp[g] || 0;
        y[g] = (tot[g] * mult[g] * (1 - s0)) / (1 - e0);
      }
    }
    return y;
  }
  function plan(S) {
    const y = outputs(S);
    const plans = [];
    let total = 0;
    for (const ind of INDUSTRIES) {
      const n = Math.max(1, Math.round(ind.initialFirms * (opts.firmScale || 1)));
      const ws = [];
      let sum = 0;
      for (let i = 0; i < n; i++) { const w = Math.pow(i + 1, -0.3); ws.push(w); sum += w; }
      const hr = ind.id in P.retention ? 1.45 : 1.9; // нехранимое нужно держать с запасом под пики
      const caps = ws.map(w => (y[ind.id] * w / sum) * hr);
      const ref = caps.reduce((a, b) => a + b, 0) / n;
      for (let i = 0; i < n; i++) {
        const out = (y[ind.id] * ws[i]) / sum;
        const sm = ind.scale ? clamp(Math.pow(clamp(caps[i] / ref, 0.25, 40), 0.15 * ind.scale), 0.8, 1.7) : 1;
        const e = prodOf[ind.id] * sm;
        for (const pr in ind.labor) { const h = (out * ind.labor[pr]) / 100 / e; total += h < 0.4 ? 0 : Math.max(1, Math.ceil(h - 0.25)); }
        plans.push({ ind, out, cap: caps[i], sm });
      }
    }
    return { y, plans, total };
  }
  let S = 1.2, pl = plan(S);
  for (let it = 0; it < 8; it++) { S *= targetJobs / Math.max(1, pl.total); pl = plan(S); }
  world.calib.demandScale = S;

  // ── фирмы (капитал подбирается так, чтобы мощность была ровно плановой)
  const names = new Set();
  const firms = [];
  const byInd = {};
  for (const g of GOODS) byInd[g] = [];
  const unit = { env: Object.fromEntries(GOODS.map(g => [g, 1])) };
  for (const pn of pl.plans) {
    const ind = pn.ind;
    const f = makeFirm(world.nextFirmId++, ind.id);
    // собственник по рычагам старта (как после applyOwnership): отличие от умолчания — «государство»/«план» → госфирмы, «кооператив» → артели,
    // «смешанная» → крупнейшая фирма — «национальный чемпион» (иначе государство в первый же месяц откроет её само, за 3 капитала).
    // Умолчание (в нём госрежим у охраны описывает полицию и суд) стартовое население не меняет.
    const ipN = pol.industry[ind.id], ipD = DEF_POL.industry[ind.id];
    const eo = effOwnership(ipN);
    f.owner = effOwnership(ipD) === eo && !!ipN.planned === !!ipD.planned ? 'private'
      : eo === 'state' || eo === 'coop' ? eo : eo === 'mixed' && !byInd[ind.id].length ? 'state' : 'private';
    f.name = firmName(world, ind.id, names, f.owner); names.add(f.name);
    f.productivity = clamp(prodOf[ind.id] * (0.93 + 0.14 * rand(world)), 0.4, 2);
    f.capital = (pn.cap * ind.capitalPerUnit) / (f.productivity * pn.sm);
    f._cap = pn.cap; f._out = pn.out;
    firms.push(f);
    byInd[ind.id].push(f);
  }
  for (let it = 0; it < 4; it++) {
    for (const g of GOODS) {
      const fs = byInd[g];
      const cpu = IND[g].capitalPerUnit;
      const ref = fs.reduce((a, f) => a + f.capital / cpu, 0) / fs.length;
      for (const f of fs) { f.sizeRef = ref; f.capital = (f._cap * cpu) / (f.productivity * scaleMult(f, world)); }
    }
  }
  const jobsByProf = {};
  for (const pr of PROF_IDS) jobsByProf[pr] = 0;
  for (const f of firms) {
    const e = eff(f, world, unit);
    const need = laborNeed(f, f._out, e);
    f._need = {};
    for (const pr in need) { const c = headcount(need[pr]); if (c) { f._need[pr] = c; jobsByProf[pr] += c; } f.employees[pr] = 0; }
  }

  // ── население: возраст, профессии, статусы
  const hh = [];
  for (let i = 0; i < N; i++) {
    const h = makeHousehold(i + 1);
    h.age = ages[i];
    h.birth = i % 12;
    hh.push(h);
  }
  world.households = hh;
  world.nextHouseholdId = N + 1;
  const totalJobsProf = { ...jobsByProf };
  totalJobsProf.official = (totalJobsProf.official || 0) + admin;
  const profList = [];
  for (const pr of PROF_IDS) for (let i = 0; i < totalJobsProf[pr]; i++) profList.push(pr);
  const shuffled = (arr) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = randInt(world, i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const working = shuffled(hh.filter(h => h.age < A_RET));
  const retiredHh = hh.filter(h => h.age >= A_RET);
  const selfHh = working.splice(0, self);
  const employedHh = working.splice(0, Math.min(working.length, profList.length));
  const unempHh = working;
  const pl2 = shuffled(profList);
  const byProf = {};
  for (const pr of PROF_IDS) byProf[pr] = [];
  employedHh.forEach((h, i) => { h.profession = pl2[i]; byProf[h.profession].push(h); });
  const randProf = () => pl2[randInt(world, pl2.length)];
  for (const h of unempHh) { h.profession = randProf(); h.status = 'unemployed'; }
  for (const h of retiredHh) { h.profession = randProf(); h.status = 'retired'; }
  const selfProfs = ['service', 'manual', 'manager', 'clerical', 'service'];
  for (const h of selfHh) { h.profession = selfProfs[randInt(world, selfProfs.length)]; h.status = 'self'; }
  for (const h of hh) {
    const sk = SKILLED[h.profession] ? 0.62 : 0.48;
    h.skill = clamp(randNormal(world, sk, 0.17), 0.05, 0.98);
    h.health = clamp(randNormal(world, 0.8, 0.1) - (h.age > 60 ? 0.12 : 0), 0.3, 1);
  }

  for (const f of firms) {
    const ind = IND[f.industry];
    f.price = f.priceFree = p0[ind.id];
    f.unitCost = f.price / (1 + baseMarkup(ind));
    f.markup = baseMarkup(ind);
    f.output = f.demandEMA = f.orders = f.sales = f._out;
    f.revenue = f._out * f.price;
    f.profitMargin = f.markup / (1 + f.markup);
    f.profit = f.revenue * f.profitMargin;
    f.util = f._out / f._cap;
    for (const pr in ind.labor) f.wageOffer[pr] = wages[pr];
    f.inventory = ind.id in P.retention ? f._out * 0.25 : 0;
    for (const k in ind.inputs) { f.inputStock[k] = ind.inputs[k] * f._out * 1.45; f.inputCost[k] = p0[k]; }
  }
  world.firms = firms;
  for (const g of GOODS) {
    const tot = byInd[g].reduce((a, f) => a + f.output, 0);
    for (const f of byInd[g]) f.share = f.marketShare = f.output / tot;
  }
  // найм
  for (const f of firms) {
    for (const pr in f._need) {
      for (let i = 0; i < f._need[pr]; i++) {
        const h = byProf[pr].pop();
        if (!h) break;
        h.status = 'employed'; h.employerId = f.id;
        f.employees[pr]++;
      }
    }
    delete f._need; delete f._cap; delete f._out;
  }
  for (const pr of PROF_IDS) for (const h of byProf[pr]) h.status = 'unemployed';
  let needAdm = admin;
  for (const h of hh) {
    if (needAdm <= 0) break;
    if (h.status === 'unemployed' && h.profession === 'official') { h.status = 'employed'; h.employerId = 0; needAdm--; }
  }
  for (const h of hh) {
    if (needAdm <= 0) break;
    if (h.status === 'unemployed') { h.profession = 'official'; h.status = 'employed'; h.employerId = 0; needAdm--; }
  }

  // ── зарплаты: нормируем так, чтобы медиана была базовой
  const fById = new Map(firms.map(f => [f.id, f]));
  for (const h of hh) {
    if (h.status !== 'employed') continue;
    const base = h.employerId === 0 ? wages.official : fById.get(h.employerId).wageOffer[h.profession];
    h.wage = base * (0.7 + 0.6 * h.skill);
  }
  const empWages = hh.filter(h => h.status === 'employed').map(h => h.wage);
  const medW = median(empWages);
  const wmul = P.baseWage / medW;
  for (const h of hh) h.wage *= wmul;
  for (const f of firms) for (const pr in f.wageOffer) f.wageOffer[pr] *= wmul;
  for (const pr of PROF_IDS) wages[pr] *= wmul;
  const pn2 = solvePrices(wages, pol.payrollTax, prodOf);
  world.basePrice = { ...pn2 };
  world.calib.capUnit = P.capUnitMult * (0.65 * pn2.manufacturing + 0.35 * pn2.construction);
  world.calib.medianBase = P.baseWage;
  for (const f of firms) {
    f.wageBill = 0;
    for (const pr in f.employees) f.wageBill += f.employees[pr] * f.wageOffer[pr];
  }
  const avgW0 = empWages.reduce((a, b) => a + b, 0) / empWages.length * wmul;

  // ── цены по реальной формуле издержек: цена старта — равновесие модели (ИПЦ = 1)
  {
    const cx = { env: null, floor: pol.minWage * P.baseWage, labWage: { ...wages }, price: { ...pn2 }, cmp: world.gov.taxCompliance,
      capUnit: world.calib.capUnit, rateM: 0.07 / 12, effPR: 0.7 * 0.9, avgHealth: 0.8, pollIdx: 0.4, by: byInd, barrier: {} };
    world.resources.reserves = world.resources.reservesInit = Math.max(500, byInd.mining.reduce((a, f) => a + f.output, 0) * 12 * preset.reserveYears);
    world.calib.envRef = 1;
    world.calib.envRef = envCommon(world, cx);
    world.calib.land0 = preset.land; world.resources.land = preset.land;
    computeEnv(world, cx);
    for (const g of GOODS) cx.barrier[g] = entryBarrier(world, cx, g);
    for (let it = 0; it < 60; it++) {
      for (const g of GOODS) {
        let num = 0, den = 0;
        for (const f of byInd[g]) {
          const uc = unitCostEst(f, world, cx);
          f.unitCost = uc;
          f.markup = markupFor(f, cx);
          f.price = f.priceFree = uc * (1 + f.markup);
          num += f.price * f.output; den += f.output;
        }
        cx.price[g] = num / den;
      }
      cx.capUnit = P.capUnitMult * (0.65 * cx.price.manufacturing + 0.35 * cx.price.construction);
    }
    for (const g of GOODS) { pn2[g] = cx.price[g]; world.basePrice[g] = cx.price[g]; }
    world.calib.capUnit = cx.capUnit;
    for (const f of firms) {
      f.revenue = f.output * f.price;
      f.profitMargin = f.markup / (1 + f.markup);
      f.profit = f.revenue * f.profitMargin;
      for (const k in f.inputCost) f.inputCost[k] = pn2[k];
    }
  }

  // ── деньги, собственность
  const wl = hh.map(() => Math.exp(randNormal(world, 0, 0.95)));
  const wlMean = wl.reduce((a, b) => a + b, 0) / N;
  hh.forEach((h, i) => {
    const w = wl[i] / wlMean;
    const inc = h.status === 'employed' ? h.wage : h.status === 'retired' ? pol.pensionLevel * avgW0 : 0.5 * avgW0;
    h.cash = inc * (P.cashMult || 1) * (0.5 + 0.2 * w + 0.6 * Math.max(0, w - 1.5));
    h.income = inc; h.netIncome = inc * 0.85;
    h.incomeBySource = { wage: h.status === 'employed' ? h.wage : 0, capital: 0, transfer: h.status === 'retired' ? inc : 0, business: 0 };
  });
  const wealthW = hh.map((h, i) => Math.pow(wl[i], 1.6) * (h.status === 'retired' ? 1.3 : 1));
  const cum = []; let acc = 0;
  for (const w of wealthW) { acc += w; cum.push(acc); }
  const pickWealthy = () => {
    const r = rand(world) * acc; let lo = 0, hi = cum.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < r) lo = mid + 1; else hi = mid; }
    return hh[lo];
  };
  const selfList = hh.filter(h => h.status === 'self');
  let selfPtr = 0;
  const smallInd = new Set(['agri', 'services', 'construction', 'vice']);
  for (const f of firms) {
    if (f.owner !== 'private') continue;   // у государственных и кооперативных фирм нет частных акционеров
    const owners = [], fracs = [];
    if (smallInd.has(f.industry) && selfList.length) {
      const k = 2 + randInt(world, 3);
      for (let i = 0; i < k; i++) { const h = selfList[selfPtr++ % selfList.length]; if (!owners.includes(h)) { owners.push(h); fracs.push(0.7 / k); } }
    }
    const remaining = 1 - fracs.reduce((a, b) => a + b, 0);
    const k2 = 2 + randInt(world, 6);
    const ws = []; let sw = 0;
    for (let i = 0; i < k2; i++) { const w = -Math.log(1 - rand(world)); ws.push(w); sw += w; }
    for (let i = 0; i < k2; i++) {
      const h = pickWealthy();
      const idx = owners.indexOf(h);
      if (idx >= 0) fracs[idx] += (remaining * ws[i]) / sw;
      else { owners.push(h); fracs.push((remaining * ws[i]) / sw); }
    }
    owners.forEach((h, i) => { h.shares[f.id] = (h.shares[f.id] || 0) + fracs[i]; f.holders[h.id] = true; });
  }
  for (const h of hh) if (h.status === 'self') {
    const own = Object.keys(h.shares);
    h.employerId = own.length ? Number(own[0]) : null;
  }

  // ── деньги фирм, долги, банк
  let loans = 0;
  for (const f of firms) {
    f.cash = f.output * f.unitCost * 1.2 + 20;
    f.debt = 0.05 * f.capital * world.calib.capUnit;
    f.capexBudget = P.delta * f.capital * world.calib.capUnit;
    loans += f.debt;
    f.vacancies = {};
  }
  world.bank.loans = loans;
  world.bank.rate = 0.07;
  world.bank.cash = 0;

  // ── ВВП (оценка) и госбюджет
  let gdp = 0;
  for (const f of firms) {
    let va = f.output * f.price;
    for (const k in IND[f.industry].inputs) va -= IND[f.industry].inputs[k] * f.output * pn2[k];
    gdp += va;
  }
  gdp += admin * wages.official;
  const gst = world.stats;
  gst.gdp = gdp; gst.gdpReal = gdp; gst.cpi = 1; gst.avgWage = avgW0; gst.medianWage = P.baseWage;
  gst.population = N * P.popFactor;
  gst.unemployment = unempTarget / Math.max(1, N - retired);
  world.gov.debt = 0.1 * gdp * 12;
  world.gov.cash = 0.08 * gdp;
  const rich = hh.map((h, i) => ({ h, w: wealthW[i] })).sort((a, b) => b.w - a.w).slice(0, Math.round(N * 0.25));
  const rsum = rich.reduce((a, r) => a + r.w, 0);
  for (const r of rich) r.h.bonds = (world.gov.debt * r.w) / rsum;

  // ── внешний мир
  world.abroad.fx = 1;
  world.abroad.cash = 0;
  for (const g of GOODS) {
    if (!IND[g].tradable) continue;
    world.abroad.worldPrice[g] = pn2[g] * 0.97 * (preset.ratio[g] || 1);
  }
  let importsValue = 0;
  for (const g of GOODS) if (IND[g].tradable) importsValue += (imp[g] || 0) * pl.y[g] * pn2[g];
  world.abroad.reserves = 6 * importsValue;

  // ── отрасли: состояние
  for (const ind of INDUSTRIES) {
    const g = ind.id;
    const tot = byInd[g].reduce((a, f) => a + f.output, 0);
    const s0 = ind.tradable ? imp[g] || 0 : 0;
    const e0 = ind.tradable ? exp[g] || 0 : 0;
    const r = (world.abroad.worldPrice[g] || pn2[g]) / pn2[g];
    world.ind[g] = {
      profitMargin: 0.08, ownershipApplied: world.policies.industry[g].ownership,
      impK: s0 / Math.max(0.01, 1 - s0), expBase: ind.tradable ? (e0 * tot) / Math.pow(Math.max(0.3, r), 2) : 0,
      lastEntryT: -99, hhi: 0,
    };
    let hhi = 0; for (const f of byInd[g]) hhi += f.share * f.share;
    world.markets[g] = { price: pn2[g], demand: tot, sold: tot, shortage: 0, imports: s0 * tot, exports: e0 * tot, hhi, firms: byInd[g].length };
    world.ind[g].hhi = hhi;
  }
  for (const pr of PROF_IDS) world.labor[pr] = { wage: wages[pr], w0: wages[pr], rel: 1, employed: 0, unemployed: 0, vacancies: 0, u: 0 };
  world.calib.wbar = 1;
  const miningOut = byInd.mining.reduce((a, f) => a + f.output, 0);
  world.resources.reserves = world.resources.reservesInit = Math.max(500, miningOut * 12 * preset.reserveYears);
  world.resources.land = preset.land;
  world.calib.land0 = preset.land;
  world.resources.pollution = 0;

  let em0 = 0;
  for (const f of firms) em0 += f.output * (IND[f.industry].pollution || 0) * P.pollutionScale * (1 - 0.5 * pol.regulationBurden);
  world.resources.pollution = em0 * 125;
  world.calib.pollRef = em0 * 125 * 2.5;
  world.calib.carry = { secEff: 0.8, eduCov: 0.7, avgHealth: 0.8, povertyShare: 0.1, techGrowth: 0.001, nxEMA: 0, medWealth: 1000, pollIdx: 0.4, unemployment: 0.06 };
  world.moneySupply = totalCash(world);
  world.calib.rb0 = world.moneySupply / Math.max(1, gst.gdpReal);
  world.calib.lnRb = 0;
  world.calib.pStar = 1;
  world.calib.gdp0 = gst.gdpReal;
  world.t = 0;
  return world;
}
