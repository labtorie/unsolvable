// Показатели мира (поля stats «заполняет ядро») и переносимые между месяцами величины.
import { NEEDS, PROFESSIONS } from '../schema.js';
import { IND, P } from './params.js';
import { clamp, median } from './util.js';

export function computeStats(world, ctx) {
  const st = world.stats;
  const hh = world.households;
  const N = hh.length;
  const S = world.calib.demandScale;
  const carry = world.calib.carry;

  // ВВП по производству
  let gdp = 0, real = 0;
  for (const f of world.firms) {
    if (!f.alive) continue;
    const ind = IND[f.industry];
    let va = f.output * f.price - f.inputUsed;
    let vr = f.output * world.basePrice[f.industry];
    for (const k in ind.inputs) vr -= ind.inputs[k] * f.output * world.basePrice[k];
    gdp += va; real += vr;
  }
  const admin = ctx.adminWages || 0;
  gdp += admin;
  // ИПЦ
  let num = 0, den = 0, basic = 0;
  for (const n of NEEDS) {
    const w = S * n.sat;
    const p = world.markets[n.good].price;
    num += w * p; den += w * world.basePrice[n.good];
    if (n.basic) {
      // стоимость корзины из своего кармана: бесплатные государственные услуги в неё не входят
      let share = 1;
      if (n.id === 'health') share = world.policies.healthMode === 'private' ? 1 : world.policies.healthMode === 'mixed' ? 0.5 : 0;
      if (n.id === 'security') share = world.policies.securityMode === 'private' ? 1 : 0;
      basic += w * p * share;
    }
  }
  const cpi = den > 0 ? num / den : 1;
  real += admin / Math.max(0.3, cpi);
  const h = world.hist;
  const gp = (carry.gdpSmooth ?? gdp);
  carry.gdpSmooth = 0.7 * gp + 0.3 * gdp;
  h.cpi.push(cpi); h.gdpReal.push(real);
  if (h.cpi.length > 13) { h.cpi.shift(); h.gdpReal.shift(); }
  const L = h.cpi.length;
  const infl = L > 1 ? Math.pow(cpi / h.cpi[0], 12 / (L - 1)) - 1 : 0;
  const g0 = h.gdpReal.slice(0, 3), g1 = h.gdpReal.slice(-3);
  const m0 = g0.reduce((a, b) => a + b, 0) / g0.length, m1 = g1.reduce((a, b) => a + b, 0) / g1.length;
  const growth = L > 6 ? Math.pow(m1 / Math.max(1e-9, m0), 12 / Math.max(1, L - 3)) - 1 : 0;

  // труд
  let emp = 0, unemp = 0, selfN = 0, wsum = 0, wsumAll = 0;
  const wages = [];
  const byProf = {};
  for (const p of PROFESSIONS) byProf[p.id] = { employed: 0, unemployed: 0, avgWage: 0, gig: 0 };
  let gigN = 0;
  let svcSum = 0, secSum = 0, eduSum = 0, hSum = 0, pov = 0;
  for (const x of hh) {
    if (x.status === 'employed') { emp++; wages.push(x.wage); wsum += x.wage; byProf[x.profession].employed++; byProf[x.profession].avgWage += x.wage; }
    else if (x.status === 'unemployed') { unemp++; byProf[x.profession].unemployed++; }
    else if (x.status === 'self') selfN++;
    else if (x.status === 'gig') { emp++; gigN++; wages.push(x.wage); wsum += x.wage; byProf[x.profession].employed++; byProf[x.profession].gig++; byProf[x.profession].avgWage += x.wage; }
    wsumAll += x.incomeBySource.wage;
    const nm = x.needsMet;
    svcSum += (nm.security ?? 0) + (nm.health ?? 0) + (nm.education ?? 0);
    secSum += nm.security ?? 0; eduSum += nm.education ?? 0; hSum += x.health;
    const bf = ((nm.food ?? 0) + (nm.housing ?? 0) + (nm.energy ?? 0)) / 3;
    if (bf < 0.75) pov++;
  }
  for (const p in byProf) if (byProf[p].employed) byProf[p].avgWage /= byProf[p].employed;
  const lf = emp + unemp + selfN;
  st.gdp = gdp;
  st.gdpReal = real;
  st.gdpGrowth = growth;
  st.cpi = cpi;
  st.inflation = infl;
  st.unemployment = lf > 0 ? unemp / lf : 0;
  st.avgWage = emp ? wsum / emp : 0;
  st.medianWage = wages.length ? median(wages) : st.medianWage;
  st.wageShare = gdp > 0 ? wsumAll / gdp : 0;
  st.basicBasketCost = basic;
  st.tradeBalance = ctx.tradeBalance || 0;
  st.population = N * P.popFactor;
  st.employmentByProfession = byProf;
  st.gigShare = emp ? gigN / emp : 0;

  carry.secEff = secSum / N;
  carry.svcMet = svcSum / (3 * N);
  carry.eduCov = eduSum / N;
  carry.avgHealth = hSum / N;
  carry.povertyShare = pov / N;
  carry.techGrowth = ctx.techGrowthNext ?? carry.techGrowth;
  carry.nxEMA = ctx.nxEMA || 0;
  carry.unemployment = st.unemployment;
  carry.pollIdx = clamp(world.resources.pollution / Math.max(1e-9, world.calib.pollRef || 1), 0, 1.5);
}
