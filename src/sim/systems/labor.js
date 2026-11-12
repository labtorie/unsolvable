// Рынок труда: пересчёт занятости, предложения зарплат, увольнения, найм, переобучение.
import { PROFESSIONS } from '../schema.js';
import { rand, randInt } from '../rng.js';
import { IND, P, PROF_WAGE, SKILLED } from './params.js';
import { PROF_IDS, laborNeed, headcount, eff } from './core.js';
import { clamp, safePay } from './util.js';

const SUBS = { care: ['service', 'clerical'], clerical: ['service', 'manager'], service: ['manual', 'clerical'], manual: ['service'], manager: ['clerical'], creative: ['clerical', 'service'], engineer: ['manager'] };

export function skillFactor(h) { return 0.7 + 0.6 * h.skill; }

/** Занятость из состояния домохозяйств (источник истины — hh.employerId). */
export function recount(world, ctx) {
  for (const f of world.firms) { f.employees = {}; }
  const workers = ctx.workers; // id фирмы → массив hh
  workers.length = 0;
  const L = world.labor;
  for (const p of PROF_IDS) { L[p].employed = 0; L[p].unemployed = 0; }
  let officials = 0;
  for (const h of world.households) {
    if (h.status === 'employed') {
      L[h.profession].employed++;
      if (h.employerId === 0) { officials++; continue; }
      const f = ctx.F[h.employerId];
      if (!f || !f.alive) { h.status = 'unemployed'; h.employerId = null; h.wage = 0; continue; }
      f.employees[h.profession] = (f.employees[h.profession] || 0) + 1;
      (workers[f.id] || (workers[f.id] = [])).push(h);
    } else if (h.status === 'unemployed') {
      L[h.profession].unemployed++;
    }
  }
  ctx.officials = officials;
}

function targetOfficials(world, ctx) {
  const pol = world.policies;
  let planned = 0, state = 0;
  for (const id in pol.industry) {
    if (pol.industry[id].planned) planned++;
    if (pol.industry[id].ownership === 'state' || pol.industry[id].planned) state++;
  }
  const share = 0.012 + 0.03 * pol.taxAdmin + 0.02 * pol.regulationBurden + 0.015 * pol.repression + 0.006 * planned + 0.002 * state
    + 0.0005 * (pol.subsidyCount || 0);
  return Math.round(ctx.N * share * 1);
}

export function adjustLabor(world, ctx) {
  const pol = world.policies;
  const A = world.assumptions;
  const hh = world.households;
  const L = world.labor;
  const floor = ctx.floor;
  const uf = 1 + 0.2 * (pol.unionPower - 0.3) * A.unionBargaining * (pol.strikeRight ? 1 : 0.6);

  // 1. переобучение
  for (const h of hh) {
    if (h.retrain) {
      h.retrain.left--;
      if (h.retrain.left <= 0) {
        h.profession = h.retrain.to;
        h.skill = clamp(h.skill * 0.7 + 0.12, 0.1, 0.9);
        h.retrain = null;
        h.jobSearch = 0;
      }
    }
  }

  // 2. рыночные зарплаты: общий уровень + относительные зарплаты профессий (ограничены)
  const infl = ctx.inflM;
  let uAll = 0, vAll = 0, lfAll = 1;
  for (const p of PROF_IDS) { const lm = L[p]; uAll += lm.unemployed; vAll += lm.vacancies || 0; lfAll += lm.employed + lm.unemployed; }
  const uA = uAll / lfAll, vA = vAll / lfAll;
  const calib = world.calib;
  // количественная привязка: избыток реальных денежных остатков (сверх нормы) тянет зарплаты и цены вверх
  const rbNow = world.moneySupply / Math.max(1, ctx.cpi * Math.max(1, world.stats.gdpReal));
  if (!(calib.rb0 > 0)) calib.rb0 = rbNow;
  calib.lnRb = 0.92 * (calib.lnRb ?? 0) + 0.08 * Math.log(rbNow / calib.rb0);
  // печатный станок: каждый процент эмиссии от массы денег толкает зарплаты и цены вверх (подушка — сглаженная доля эмиссии)
  const money = clamp(0.4 * (calib.emiEMA || 0), 0, 0.05);
  // в плановой экономике зарплаты назначаются сверху: рыночные сигналы почти не двигают их
  const admin = 1 - 0.98 * (ctx.plannedCount / 12);
  // номинальный якорь: уровень зарплат тянется к целевому (цель по ценам ~2% в год × накопленный рост производительности);
  // выше ставка ЦБ — ниже цель по ценам (см. tick.js)
  calib.techIdx = (calib.techIdx || 1) * (1 + ctx.techGrowth);
  const wTarget = (calib.pStar || 1) * calib.techIdx;
  let sr = 0, se = 0;
  for (const p of PROF_IDS) { sr += L[p].rel * L[p].employed; se += L[p].employed; }
  const relMean = se > 0 ? sr / se : 1; // средний уровень зарплат = индекс × средняя относительная зарплата
  // якорь цен работает только при мандате центробанка; без него уровень зарплат определяет рынок труда
  const raw = clamp(0.03 * Math.log(wTarget / ((calib.wbar || 1) * relMean)), -0.004, 0.006);
  // в спаде якорь не тянет зарплаты вверх (центробанк по ценам не борется с безработицей), вниз тянет всегда
  const slack = clamp(1 - (uA - 0.07) * 12, 0, 1);
  const level = pol.cbMandate === 'none' ? 0 : (raw > 0 ? slack * raw : raw);
  calib.wbar = (calib.wbar || 1) * (1 + admin * (clamp(0.1 * (vA - 0.006) - 0.1 * Math.max(0, uA - 0.13), -0.003, 0.004) + money + level + (0.3 + 0.2 * clamp((infl - 0.01) / 0.04, 0, 1)) * infl) + ctx.techGrowth); // ожидания: при высокой инфляции цены гонятся друг за другом
  for (const p of PROF_IDS) {
    const lm = L[p];
    const lf = lm.employed + lm.unemployed + 1;
    const vr = (lm.vacancies || 0) / lf, ur = lm.unemployed / lf;
    lm.rel = clamp((lm.rel || 1) * (1 + admin * clamp(0.1 * (vr - 0.006 - Math.max(0, ur - 0.08)), -0.004, 0.004)), 0.55, 2.2);
    lm.u = ur;
  }
  for (const p of PROF_IDS) {
    const lm = L[p];
    lm.wage = Math.max((lm.w0 || lm.wage) * calib.wbar * lm.rel, 0.9 * ctx.basicBasket);
    if (p === 'official') lm.wage = pol.officialPay * ctx.avgWage * 0.95;
  }

  // 3. потребность фирм: найм/увольнение
  const vac = {};
  for (const p of PROF_IDS) vac[p] = [];
  let vacTotal = {};
  for (const p of PROF_IDS) vacTotal[p] = 0;
  const empTotal = {};
  for (const p of PROF_IDS) empTotal[p] = L[p].employed - (p === 'official' ? ctx.officials : 0) + 0;
  for (const f of world.firms) {
    if (!f.alive) continue;
    const ind = IND[f.industry];
    const ip = pol.industry[f.industry];
    const e = eff(f, world, ctx);
    const need = laborNeed(f, f.target, e);
    const planned = f.owner === 'state' && ip.planned;
    const noFire = planned || f.owner === 'coop';
    const margin = f.profitMargin;
    const prevVac = f.vacancies || {};
    f.vacancies = {};
    for (const p in ind.labor) {
      const des = headcount(need[p]);
      const have = f.employees[p] || 0;
      // предложение зарплаты
      const share = have / (empTotal[p] + L[p].unemployed + 1);
      // монопсония: доля фирмы среди работодателей профессии и концентрация отрасли; профсоюзы ослабляют
      const mdown = 1 - (0.35 * Math.pow(share, 1.2) + 0.3 * Math.max(0, (world.ind[f.industry].hhi || 0) - 0.35)) * (1 - 0.8 * pol.unionPower * A.unionBargaining * 0.5);
      const prof = 1 + 0.5 * clamp(margin - 0.08, -0.08, 0.2) * pol.unionPower * A.unionBargaining;
      let tgt = L[p].wage * mdown * uf * prof * (pol.strikeRight ? 1 : 0.96);
      const prevOffer = f.wageOffer[p] || L[p].wage;
      if (prevVac[p] > 0.5) tgt *= 1.04;
      let offer = prevOffer + 0.35 * (tgt - prevOffer);
      if (offer * 0.7 < floor) offer = Math.max(offer, floor / 0.85);
      f.wageOffer[p] = offer;
      if (have > des + 1 && !noFire) {
        // увольнение лишних (наименее квалифицированных)
        const list = (ctx.workers[f.id] || []).filter(h => h.profession === p).sort((a, b) => a.skill - b.skill);
        const n = have - des;
        for (let i = 0; i < n && i < list.length; i++) {
          const h = list[i];
          const sev = pol.firingCost * h.wage;
          if (sev > 0) h.incomeBySource.wage += safePay(world, f, h, sev, 'wages');
          h.status = 'unemployed'; h.employerId = null; h.wage = 0; h.jobSearch = 0;
          f.employees[p]--;
          L[p].employed--; L[p].unemployed++;
          ctx.firedNow++;
        }
      } else if (des > have && f.lossMonths < 3) {
        f.vacancies[p] = des - have;
        vac[p].push(f);
        vacTotal[p] += des - have;
      }
    }
  }

  // 4. аппарат: чиновники
  const offT = targetOfficials(world, ctx);
  ctx.officialsTarget = offT;
  let offN = ctx.officials;
  if (offN > offT) {
    let k = offN - offT;
    for (const h of hh) {
      if (k <= 0) break;
      if (h.employerId === 0 && h.status === 'employed' && rand(world) < 0.3) {
        h.status = 'unemployed'; h.employerId = null; h.wage = 0; h.jobSearch = 0; k--; L.official.employed--; L.official.unemployed++;
      }
    }
  }
  const govVac = Math.max(0, offT - offN);

  // 5. сопоставление ищущих работу
  const bene = ctx.benefit;
  const byProf = {};
  for (const p of PROF_IDS) byProf[p] = [];
  for (const h of hh) {
    if (h.status === 'unemployed' && !h.retrain && h.age < pol.retirementAge) { byProf[h.profession].push(h); h.jobSearch++; }
  }
  const leftover = [];
  for (const p of PROF_IDS) {
    const seekers = byProf[p];
    if (!seekers.length) continue;
    const vs = vac[p].map(f => ({ f, n: f.vacancies[p], w: f.wageOffer[p] })).sort((a, b) => b.w - a.w);
    let govN = p === 'official' ? govVac : 0;
    // случайный порядок, затем лучшие ищущие первыми ловят лучшие места
    const active = seekers.filter(() => rand(world) < P.frictions).sort((a, b) => b.skill - a.skill);
    let vi = 0;
    for (const h of active) {
      const sf = skillFactor(h);
      while (vi < vs.length && vs[vi].n <= 0) vi++;
      if (vi >= vs.length && govN <= 0) break;
      let placed = false;
      if (vi < vs.length) {
        const v = vs[vi];
        const wage = Math.max(v.w * sf, floor);
        if (wage >= bene * 0.8) {
          h.status = 'employed'; h.employerId = v.f.id; h.wage = wage; h.jobSearch = 0;
          v.n--; v.f.employees[p] = (v.f.employees[p] || 0) + 1; placed = true;
        }
      }
      if (!placed && govN > 0) {
        const wage = pol.officialPay * ctx.avgWage * sf * 0.95;
        if (wage >= bene * 0.8) { h.status = 'employed'; h.employerId = 0; h.wage = wage; h.jobSearch = 0; govN--; placed = true; }
      }
    }
    for (const v of vs) if (v.n > 0) leftover.push({ p, ...v });
    // переводы в госаппарат из смежных профессий
    if (p === 'clerical' || p === 'manager') {
      if (govN > 0) for (const h of seekers) {
        if (govN <= 0) break;
        if (h.status === 'unemployed' && rand(world) < 0.25) {
          h.profession = 'official'; h.status = 'employed'; h.employerId = 0; h.wage = pol.officialPay * ctx.avgWage * skillFactor(h) * 0.95; h.jobSearch = 0; govN--;
        }
      }
    }
  }
  // незакрытые вакансии: берут людей смежных профессий с доучиванием на месте (хуже квалификация)
  for (const v of leftover) {
    const subs = SUBS[v.p];
    if (!subs) continue;
    for (const sp of subs) {
      if (v.n <= 0) break;
      for (const h of byProf[sp]) {
        if (v.n <= 0) break;
        if (h.status !== 'unemployed' || h.retrain || rand(world) > 0.4) continue;
        const sk = h.skill * 0.9;
        const wage = Math.max(v.w * (0.7 + 0.6 * sk), floor);
        if (wage < bene * 0.8) continue;
        h.profession = v.p; h.skill = sk;
        h.status = 'employed'; h.employerId = v.f.id; h.wage = wage; h.jobSearch = 0;
        v.f.employees[v.p] = (v.f.employees[v.p] || 0) + 1; v.n--;
      }
    }
  }

  // 6. смена профессии у долго безработных
  const access = ctx.eduAccess;
  const tightness = {};
  for (const p of PROF_IDS) tightness[p] = Math.max(0, (vacTotal[p] - L[p].unemployed) / (L[p].employed + L[p].unemployed + 1));
  for (const h of hh) {
    if (h.status !== 'unemployed' || h.retrain || h.jobSearch < 3 || h.age >= pol.retirementAge - 5) continue;
    const lm = L[h.profession];
    if (lm.u < 0.06 && h.jobSearch < 9) continue;
    const pr = 0.05 * access * clamp((62 - h.age) / 40, 0.1, 1) * (h.cash > 8 * h.wage ? 1.5 : 1);
    if (rand(world) >= pr) continue;
    let best = null, bw = 0;
    for (const q of PROF_IDS) {
      if (q === h.profession || q === 'official') continue;
      if (SKILLED[q] > 0.5 && h.skill < 0.55) continue;
      const w = (0.02 + tightness[q] * 8) * (1 - L[q].u) * Math.sqrt(PROF_WAGE[q]);
      if (w > bw && rand(world) < 0.7) { bw = w; best = q; }
    }
    if (best) h.retrain = { to: best, left: Math.round((10 + (SKILLED[best] ? 8 : 0)) / Math.max(0.3, access)) };
  }

  for (const p of PROF_IDS) L[p].vacancies = vacTotal[p];
}
