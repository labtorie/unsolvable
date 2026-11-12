// Демография: возраст, пенсия, смерть и наследники.
import { rand, randInt, randNormal } from '../rng.js';
import { hazard } from './params.js';
import { P, SKILLED } from './params.js';
import { PROF_IDS } from './core.js';
import { clamp, safePay, addEvent } from './util.js';
import { pay } from '../ledger.js';
import { wealthOf } from './households.js';

function emigration(world, ctx) {
  const pol = world.policies;
  if (!pol.emigrationAllowed) return;
  const hh = world.households;
  // уезжают квалифицированные, если жизнь дома хуже, чем снаружи (покрытие базовых нужд, безработица, репрессии)
  const living = 1 - ctx.povertyShare;
  const push = Math.max(0, 0.75 - living) + Math.max(0, ctx.unemployment - 0.12) + 0.3 * pol.repression + 0.2 * Math.max(0, world.gov.crime - 0.35);
  const p = 0.0004 + 0.02 * push;
  let gone = 0;
  for (const h of hh) {
    if (h.status === 'retired' || h.age > 55 || !(h.skill > 0.6) || !(SKILLED[h.profession] > 0.5)) continue;
    const pi = p + 0.02 * Math.max(0, 0.5 - (h.satisfaction ?? 0.5)) * (pol.repression + 0.5);
    if (rand(world) >= pi) continue;
    if (h.cash > 0) pay(world, h, world.abroad, h.cash, 'capital_flight');
    h.status = 'unemployed'; h.employerId = null; h.wage = 0; h.retrain = null;
    h.age = 22; h.skill = clamp(0.3 + 0.3 * rand(world), 0.1, 0.8); h.health = 0.85; h.jobSearch = 0;
    h.profession = rand(world) < 0.6 ? 'manual' : 'service';
    for (const id in h.shares) { const f = ctx.F[id]; if (f) delete f.holders[h.id]; }
    h.shares = {};
    if (h.bonds > 0) { world.gov.debt = Math.max(0, world.gov.debt - h.bonds); h.bonds = 0; }
    gone++;
  }
  if (gone >= 3 && world.t % 6 === 0) addEvent(world, 'brain_drain', 'Специалисты уезжают к соседям: у них, говорят, и зарплата выше, и пресса скучнее', { n: gone });
}

export function demography(world, ctx) {
  const pol = world.policies;
  const hh = world.households;
  const gov = world.gov;
  const month = world.t % 12;
  const ret = pol.retirementAge;
  emigration(world, ctx);
  for (const h of hh) {
    // пенсионный статус
    if (h.age >= ret) {
      if (h.status !== 'retired') {
        h.status = 'retired'; h.employerId = null; h.wage = 0; h.retrain = null;
      }
    } else if (h.status === 'retired') {
      h.status = 'unemployed'; h.jobSearch = 0;
    }
    if (h.birth !== month) continue;
    h.age++;
    const nm = h.needsMet;
    const poorF = (nm.food ?? 1) < 0.6 ? 1.5 : 1;
    const p = clamp(hazard(h.age) * (1.9 - 1.2 * h.health) * poorF, 0, 0.9);
    if (rand(world) < p) replaceWithHeir(world, ctx, h);
  }
}

function replaceWithHeir(world, ctx, h) {
  const pol = world.policies;
  const gov = world.gov;
  const wealth = wealthOf(h, ctx);
  const medW = Math.max(1, world.calib.carry.medWealth || 1);
  const taxable = Math.max(0, wealth - 2 * medW);
  const due = pol.inheritanceTax * taxable * ctx.cmp;
  if (due > 0) safePay(world, h, gov, due, 'tax_inheritance');
  const rich = clamp(wealth / (6 * medW), 0, 1);
  const wasSelf = h.status === 'self' && Object.keys(h.shares).length > 0;
  h.parentClassId = h.classId;
  const prevProf = h.profession;
  const parentSkill = h.skill;
  h.age = 20;
  h.status = 'unemployed'; h.employerId = null; h.wage = 0; h.retrain = null; h.jobSearch = 0;
  if (wasSelf && rand(world) < 0.6) { h.status = 'self'; const own = Object.keys(h.shares); h.employerId = own.length ? Number(own[0]) : null; }
  h.health = 0.85;
  // профессия: чаще как у родителя; образование и доход открывают квалифицированные
  const access = ctx.eduAccess;
  let prof = prevProf;
  const keep = SKILLED[prevProf] > 0.5 ? 0.65 : 0.45;
  if (rand(world) > keep + 0.2 * rich) {
    const L = world.labor;
    let tot = 0;
    const wt = {};
    for (const p of PROF_IDS) {
      if (p === 'official') continue;
      const lf = L[p].employed + L[p].unemployed + 1;
      wt[p] = (L[p].employed + 1) * (1 + 6 * (L[p].vacancies || 0) / lf) * (1 - 0.5 * L[p].unemployed / lf);
      tot += wt[p];
    }
    let r = rand(world) * tot;
    prof = 'manual';
    for (const p of PROF_IDS) { if (p === 'official') continue; r -= wt[p]; if (r <= 0) { prof = p; break; } }
  }
  if (prof === 'official') prof = 'clerical';
  if (SKILLED[prof] > 0.5 && prevProf !== prof) {
    const ok = 0.45 + 0.5 * access * (0.35 + 0.65 * rich);
    if (rand(world) > ok) prof = rand(world) < 0.5 ? 'service' : 'manual';
  }
  h.profession = prof;
  h.skill = clamp(0.3 * parentSkill + 0.25 * rand(world) + 0.45 * (0.25 + 0.6 * ctx.eduCov * (0.5 + 0.5 * access)) + 0.1 * rich - 0.05 + 0.1 * (ctx.carry.qEdu || 0), 0.05, 0.98);
}
