// Вторая волна: технологии (GDD 3.7). Вызывается из tick.js после firmFinance.
// Пишет: f.tech, f.research, f.platform, world.tech, hh.status 'gig', hh.platformId, hh.displacedT.
//
// Общие правила агентов, никаких «в год N случается X»:
//  1. Раз в месяц фирма-разработчик (IT или крупная фирма с НИОКР) выбирает проект по выгоде: где клиенты тратят больше всего денег
//     на конкретную профессию (зарплата × люди × надбавки за МРОТ, профсоюзы, увольнения и дефицит). Инженеры берутся из общего рынка труда
//     (f.tech.staff читает labor.js), прочие траты идут поток 'research'. Шанс успеха растёт с вложениями, инженерами и накопленными технологиями.
//  2. Готовую технологию покупают лицензией, если экономия (зарплаты × cut − выходное пособие − налог на роботов + субсидия) больше платы.
//     Крупные внедряют первыми. Внедрение меняет f.tech.labor / f.tech.prod, увольнения делает labor.js (и помечает displacedT).
//  3. Платформа — фирма IT со своей долей рынка отрасли (users), сетевой эффект и комиссия; мелкие продавцы платят комиссию,
//     часть работников обслуги и мелких самозанятых становятся подрядчиками (status 'gig').
import { PROFESSIONS } from '../schema.js';
import { pay } from '../ledger.js';
import { rand, randInt } from '../rng.js';
import { techName } from '../names.js';
import { IND } from './params.js';
import { PROF_IDS } from './core.js';
import { clamp, addEvent, safePay } from './util.js';
import { incomeTax } from './tax.js';

// Насколько профессия поддаётся автоматизации (доля, которую способна заменить типичная технология — до умножения на допущение).
const TRACT = { manual: 0.85, clerical: 0.9, service: 0.55, care: 0.12, engineer: 0.08, manager: 0.25, creative: 0.12, official: 0 };
// Отрасли, где платформа может встать между продавцами и покупателями, и «подёнщицкая» профессия там.
const PLAT_IND = { services: 1, construction: 0.15, vice: 0.12, agri: 0.1 };
const GIG_PROF = { services: 'service', construction: 'manual', vice: 'service', agri: null };
const PHASE = 24;                // месяцев, за которые внедрённая автоматизация доходит до полной силы
const PLAT_MAX = 0.85;           // потолок доли рынка, идущей через платформы
const RES_K = 0.005;            // прогресс проекта на инженеро-месяц
const LABEL = Object.fromEntries(PROFESSIONS.map(p => [p.id, p.label]));
const LABEL_GEN = { manual: 'физического труда', clerical: 'рутинного офисного труда', service: 'обслуживания', care: 'заботы', engineer: 'инженеров', manager: 'управленцев', creative: 'творческих', official: 'чиновников' };
const q = s => '«' + s + '»';

function ev(world, type, text, data, prio = 0) {
  const T = world.tech;
  if (T.evT !== world.t) { T.evT = world.t; T.evN = 0; }
  if (T.evN >= 2 + prio) return;
  T.evN++;
  addEvent(world, type, text, data);
}

function techById(world, id) {
  const L = world.tech.list;
  for (let i = L.length - 1; i >= 0; i--) if (L[i].id === id) return L[i];
  return null;
}

/** Ставка платы за лицензию (доля от экономии) в текущий момент; 0 — технология свободна. */
export function feeRate(world, ctx, t) {
  const pol = world.policies;
  if (world.t >= t.patentUntil) return 0;
  if (t.origin === 'state') return pol.openScience ? 0 : Math.min(t.fee, 0.12);
  if (t.origin === 'private') {
    const o = ctx.F[t.ownerFirmId];
    if (!o || !o.alive) return 0;
  }
  let r = t.fee;
  if (pol.compulsoryLicensing) r = Math.min(r, 0.12);
  if (t.origin === 'foreign' && pol.foreignTech === 'localize') r *= 1.4;
  return r;
}

function feeAccount(world, ctx, t) {
  if (t.origin === 'state') return world.gov;
  if (t.origin === 'foreign') return world.abroad;
  const o = ctx.F[t.ownerFirmId];
  return o && o.alive ? o : null;
}

// ───────────────────────── Таблица выгоды автоматизации ─────────────────────────

function marketTable(world, ctx) {
  const pol = world.policies, A = world.assumptions, L = world.labor;
  const tab = {};
  const indRev = {}, smallRev = {}, smallN = {};
  let totalRev = 0;
  const prem = {};
  for (const p of PROF_IDS) {
    const lm = L[p];
    const lf = lm.employed + lm.unemployed + 1;
    const tight = (lm.vacancies || 0) / lf;
    prem[p] = (1 + 0.5 * pol.unionPower * A.unionBargaining) * (1 + 0.05 * pol.firingCost) * (1 + 3 * tight)
      * (1 + 1.2 * clamp(ctx.floor / Math.max(1, lm.wage) - 0.45, 0, 1)) * (1 + 0.6 * clamp(lm.rel - 1, 0, 1));
  }
  for (const f of world.firms) {
    if (!f.alive || f.owner === 'state') continue;
    indRev[f.industry] = (indRev[f.industry] || 0) + f.revenue;
    smallRev[f.industry] = (smallRev[f.industry] || 0) + f.revenue * (1 - Math.min(0.8, 3 * (f.marketShare || 0)));
    if ((f.marketShare || 0) < 0.15) smallN[f.industry] = (smallN[f.industry] || 0) + 1;
    totalRev += f.revenue;
    const labor = IND[f.industry].labor;
    for (const p in labor) {
      const tr = TRACT[p];
      if (!tr) continue;
      const n = f.employees[p] || 0;
      if (n < 1) continue;
      const w = Math.max(f.wageOffer[p] || L[p].wage, ctx.floor);
      const key = f.industry + '|' + p;
      const e = tab[key] || (tab[key] = { ind: f.industry, p, v: 0 });
      e.v += n * w * tr * prem[p];
    }
  }
  const list = [];
  for (const k in tab) { const e = tab[k]; e.pay = e.v * 0.4 * Math.min(2, A.automationReach); list.push(e); }
  list.sort((a, b) => b.pay - a.pay);
  return { list, indRev, smallRev, smallN, totalRev };
}

function pickWeighted(world, arr, wf) {
  let tot = 0;
  for (const x of arr) tot += wf(x);
  if (!(tot > 0)) return null;
  let r = rand(world) * tot;
  for (const x of arr) { r -= wf(x); if (r <= 0) return x; }
  return arr[arr.length - 1];
}

// ───────────────────────── Создание технологии ─────────────────────────

function nextParent(world, kind, industry) {
  const T = world.tech;
  let best = null;
  for (const t of T.list) {
    if (t.kind === 'gpt' && T.gptBoost > 0.25 && rand(world) < 0.6) return t.id;
    if (t.kind === kind && (t.industry === industry || kind === 'gpt')) best = t;
  }
  return best ? best.id : null;
}

function createTech(world, ctx, o) {
  const T = world.tech, pol = world.policies, A = world.assumptions;
  const names = new Set(T.list.map(t => t.name));
  const kind = o.kind;
  const t = {
    id: T.nextId++, name: techName(world, kind, o.profession, names), kind, industry: o.industry, profession: o.profession || null,
    cut: 0, cuts: {}, prodGain: 0, ownerFirmId: o.owner ? o.owner.id : null, origin: o.origin, bornT: world.t,
    patentUntil: world.t, fee: 0, adopters: [], parentId: nextParent(world, kind, o.industry),
  };
  if (kind === 'automation') {
    const base = (0.16 + 0.18 * rand(world)) * Math.min(1.6, 0.6 + 0.4 * A.automationReach + 0.3 * (TRACT[o.profession] || 0.3));
    t.cut = clamp(base * Math.max(0.15, A.automationReach) / Math.max(1, 1.1 - 0.1 * A.automationReach), 0.08, 0.9);
    if (A.automationReach <= 0) t.cut = 0.08;
    t.cuts[o.profession] = t.cut;
  } else if (kind === 'productivity') {
    t.prodGain = 0.015 + 0.03 * rand(world);
  } else if (kind === 'gpt') {
    t.industry = '*';
    t.prodGain = 0.03 + 0.02 * rand(world);
    const c = clamp(0.14 * A.automationReach, 0.03, 0.4);
    t.profession = 'clerical';
    t.cut = c;
    t.cuts = { clerical: c, manager: 0.4 * c, creative: 0.3 * c, service: 0.3 * c };
  } else if (kind === 'product') {
    t.industry = 'tech';
    t.demandGain = 0.004 + 0.012 * rand(world);
    t.users = 0.02;
  } else if (kind === 'platform') {
    t.users = 0.02;
  }
  t.fee = origin2fee(o.origin, rand(world));
  if (o.origin === 'private') t.patentUntil = world.t + 12 * pol.patentYears;
  else if (o.origin === 'state') t.patentUntil = pol.openScience ? world.t : world.t + 12 * pol.patentYears;
  else t.patentUntil = world.t + 12 * pol.patentYears;
  T.list.push(t);
  T.count = T.list.length;
  if (kind === 'gpt') T.gptBoost += 1.8;
  return t;
}
function origin2fee(origin, r) { return origin === 'state' ? 0.12 + 0.05 * r : origin === 'foreign' ? 0.28 + 0.12 * r : 0.25 + 0.2 * r; }

function announce(world, t, firm) {
  const who = t.origin === 'foreign' ? 'из-за границы' : t.origin === 'state' ? 'в госинституте' : `у фирмы ${q(firm.name)}`;
  if (t.kind === 'gpt') {
    ev(world, 'tech_gpt', `Технология общего назначения ${q(t.name)} ${who}: применима почти везде, консультанты уже пишут «стратегию трансформации»`, { tech: t.id }, 1);
  } else if (t.kind === 'automation') {
    ev(world, 'tech_new', `Новая технология ${q(t.name)} ${who}: заменит около ${Math.round(t.cut * 100)}% труда (${LABEL_GEN[t.profession]}) в отрасли «${IND[t.industry]?.label || t.industry}». Работникам предлагают «развиваться»`, { tech: t.id });
  } else if (t.kind === 'productivity') {
    ev(world, 'tech_new', `${q(t.name)} ${who}: тот же труд, на ${Math.round(t.prodGain * 100)}% больше продукции. Куда денется выигрыш — вопрос политический`, { tech: t.id });
  } else if (t.kind === 'product') {
    ev(world, 'tech_new', `${q(t.name)} ${who}: люди внезапно обнаружили, что им это нужно. Спрос на разработчиков растёт`, { tech: t.id });
  }
}

// ───────────────────────── Исследования ─────────────────────────

function startProject(world, ctx, f, mk, st) {
  const pol = world.policies, A = world.assumptions, L = world.labor;
  const isTech = f.industry === 'tech';
  const engW = L.engineer.wage;
  // доступные виды проектов
  const ban = pol.techBan;
  const opts = [];
  const autoList = isTech ? mk.list : mk.list.filter(e => e.ind === f.industry);
  if (ban !== 'automation' && autoList.length) {
    const top = autoList.slice(0, 8);
    const e = pickWeighted(world, top, x => Math.pow(x.pay, 1.4));
    if (e) opts.push({ kind: 'automation', w: 1, ind: e.ind, p: e.p, exp: e.pay * 0.3 });   // все веса нулевые — проекта автоматизации нет
  }
  // повышение отдачи: отрасль по выручке
  {
    const inds = Object.keys(mk.indRev).filter(i => isTech || i === f.industry);
    const ind = pickWeighted(world, inds, i => mk.indRev[i]);
    if (ind) opts.push({ kind: 'productivity', w: 0.45, ind, exp: 0.03 * mk.indRev[ind] * 0.5 * 0.3 });
  }
  if (isTech) {
    opts.push({ kind: 'product', w: 0.7, ind: 'tech', exp: 0.008 * st.N * ctx.medWage * 0.5 });
    if (ban !== 'platforms' && ban !== 'all') {
      const cand = Object.keys(PLAT_IND).filter(i => mk.smallRev[i] > 0 && mk.smallN[i] >= 3);
      const ind = pickWeighted(world, cand, i => PLAT_IND[i] * mk.smallRev[i] * mk.smallN[i]);
      if (ind) {
        // там, где платформа уже победила, новичку почти нечего ловить (без обязательной совместимости)
        const lead = st.platUsers[ind] || 0;
        const w = 1.0 * (1 - (pol.interoperability ? 0.3 : 0.9) * lead / PLAT_MAX);
        if (w > 0.005 && !f.platform) opts.push({ kind: 'platform', w, ind, exp: 0.08 * mk.smallRev[ind] * 0.5 });
      }
    }
    if (st.nGpt === 0 || world.t - st.lastGpt > 240) opts.push({ kind: 'gpt', w: 0.09 * A.researchLuck, ind: '*', exp: 0.02 * mk.totalRev * 0.3 });
  }
  const o = pickWeighted(world, opts, x => x.w);
  if (!o) return false;
  // команда: чем больше выгода, тем больше инженеров, но не больше, чем позволяет касса
  const cost1 = engW * 1.35;
  // чем крупнее рынок по сравнению со стоимостью инженера, тем охотнее и щедрее фирма вкладывается
  const intensity = o.kind === 'automation' ? clamp(o.exp / cost1 / 0.7, 0.35, 2.5) : 1;
  if (rand(world) >= Math.min(1, 0.5 + 0.5 * intensity)) return false;
  let staff = clamp(Math.round(0.5 * o.exp / cost1), 1, o.kind === 'gpt' ? 10 : 7);
  const maxStaff = Math.max(Math.floor(0.35 * Math.max(0, f.revenue) / (1.25 * engW)), Math.floor(f.cash / (8 * 1.25 * engW)));
  staff = Math.min(staff, maxStaff);
  if (staff < 1) return false;
  f.research = {
    techKind: o.kind, industry: o.ind, profession: o.p || null, progress: 0, need: 0.7 + 1.1 * rand(world),
    spend: staff * 0.7 * engW * intensity, staff, months: 0,
    parentId: nextParent(world, o.kind, o.ind),
  };
  return true;
}

function stepProject(world, ctx, f, st) {
  const A = world.assumptions, pol = world.policies, L = world.labor, T = world.tech;
  const r = f.research;
  const engW = L.engineer.wage;
  r.months++;
  const cost = r.staff * engW * 1.3 + r.spend;
  if (f.cash < 1.0 * cost || (pol.techBan === 'all')) {
    // денег нет — проект стоит; долго стоящий закрывают
    if (r.months > 160 || f.cash < 0.3 * cost) f.research = null;
    return;
  }
  // прочие траты уходят учёным и инженерам (оборудование, подряды, гранты)
  if (st.sci.length) {
    const share = r.spend / 3;
    for (let k = 0; k < 3; k++) {
      const h = st.sci[randInt(world, st.sci.length)];
      const a = safePay(world, f, h, share, 'research');
      h.incomeBySource.business += a;
      st.spend += a;
    }
  }
  st.spend += r.staff * engW * 1.2;
  const fill = (f.employees.engineer || 0) >= r.staff ? 1 : 0.5;
  const known = st.kindCount[r.techKind] || 0;
  const effort = r.staff * fill + r.spend / (engW * 1.2);
  const boost = (1 + 0.08 * Math.min(8, known)) * (1 + T.gptBoost) * A.researchLuck * (0.6 + 0.8 * rand(world));
  r.progress += RES_K * effort * boost;
  if (r.techKind === 'automation' && pol.techBan === 'automation') r.progress -= 0; // изобретать можно, внедрять нельзя
  if (r.progress < r.need) return;
  // успех
  let t;
  if (r.techKind === 'platform') {
    if (pol.techBan === 'platforms') { f.research = null; return; }
    t = createTech(world, ctx, { kind: 'platform', industry: r.industry, owner: f, origin: 'private' });
    if (!f.platform) {
      f.platform = { industry: r.industry, users: 0.02, fee: 0.04, gig: 0, techId: t.id, income: 0, age: 0 };
      st.platUsers[r.industry] = Math.max(st.platUsers[r.industry] || 0, 0.02);
      ev(world, 'platform_new', `Фирма ${q(f.name)} запустила платформу ${q(t.name)} для отрасли «${IND[r.industry].label}»: «мы просто соединяем людей» (за небольшую комиссию)`, { tech: t.id, firm: f.id }, 1);
    }
  } else {
    t = createTech(world, ctx, { kind: r.techKind, industry: r.industry, profession: r.profession, owner: f, origin: 'private' });
    if (r.techKind === 'gpt') st.lastGpt = world.t;
    announce(world, t, f);
  }
  if (r.parentId && t.parentId == null) t.parentId = r.parentId;
  st.kindCount[t.kind] = (st.kindCount[t.kind] || 0) + 1;
  f.research = null;
  f.techCool = world.t + 4;
}

function researchPhase(world, ctx, st) {
  const pol = world.policies, A = world.assumptions, L = world.labor;
  if (pol.techBan === 'all') return;
  const patent = clamp(pol.patentYears / 15, 0, 1.6);
  const incent = (0.55 + 0.45 * patent) * (pol.compulsoryLicensing ? 0.8 : 1) * (pol.openScience ? 0.85 : 1) * (1 - 0.0 * 0);
  let mk = null;
  const engW = L.engineer.wage;
  for (const f of world.firms) {
    if (!f.alive || f.owner === 'state' || f.owner === 'coop') continue;
    if (f.research) { stepProject(world, ctx, f, st); continue; }
    if ((f.techCool || 0) > world.t) continue;
    const isTech = f.industry === 'tech';
    let p;
    if (isTech) p = 0.06;
    else if ((f.marketShare || 0) >= 0.18 && f.capital > 0) p = 0.006;
    else continue;
    p *= incent * Math.min(1.5, 0.5 + A.researchLuck * 0.5);
    if (rand(world) >= p) continue;
    if (f.cash < 5 * engW * 1.25) continue;
    if (!mk) mk = marketTable(world, ctx);
    startProject(world, ctx, f, mk, st);
  }
}

function sciencePhase(world, ctx, st) {
  const pol = world.policies, A = world.assumptions;
  if (pol.techBan === 'all') return;
  const sci = ctx.carry.sciIdx ?? 1;
  const mk = () => st.mk || (st.mk = marketTable(world, ctx));
  // госнаука
  if (rand(world) < 0.0032 * clamp(sci, 0, 3) * A.researchLuck * (1 + 0.5 * world.tech.gptBoost)) {
    const m = mk();
    const isAuto = rand(world) < 0.6 && pol.techBan !== 'automation' && m.list.length;
    let t;
    if (isAuto) {
      const e = pickWeighted(world, m.list.slice(0, 8), x => Math.pow(x.pay, 1.2));
      t = createTech(world, ctx, { kind: 'automation', industry: e.ind, profession: e.p, owner: null, origin: 'state' });
    } else {
      const inds = Object.keys(m.indRev);
      const ind = pickWeighted(world, inds, i => m.indRev[i]);
      if (!ind) return;
      t = createTech(world, ctx, { kind: 'productivity', industry: ind, owner: null, origin: 'state' });
    }
    st.kindCount[t.kind] = (st.kindCount[t.kind] || 0) + 1;
    ev(world, 'tech_state', `Госинститут разработал ${q(t.name)}${pol.openScience ? ' и выложил всем бесплатно' : ''}. Научный сотрудник просит премию, бухгалтер — смету`, { tech: t.id });
  }
  // иностранные технологии
  if (pol.foreignTech !== 'closed') {
    const open = pol.foreignTech === 'open' ? 1 : 0.6;
    if (world.neighbors?.length) {
      // связанный мир: технологию придумал конкретный сосед; с эмбарго и без их изобретений не придёт ничего
      const cands = [];
      for (const n of world.neighbors) {
        if (world.policies.tradeWith?.[n.id]?.embargo || n.world.policies.tradeWith?.home?.embargo) continue;
        for (const t0 of n.world.tech?.list || []) {
          if (t0.kind !== 'automation' && t0.kind !== 'productivity') continue;
          if (t0.origin === 'foreign' || world.xb.imported[n.id + ':' + t0.id]) continue;
          if (pol.techBan === 'automation' && t0.kind === 'automation') continue;
          cands.push({ n, t0 });
        }
      }
      if (cands.length && rand(world) < 0.0034 * open * A.researchLuck * Math.min(2, 0.4 + cands.length / 4)) {
        const { n, t0 } = cands[Math.floor(rand(world) * cands.length) % cands.length];
        world.xb.imported[n.id + ':' + t0.id] = true;
        const m = mk();
        const ind = t0.industry === '*' || !m.indRev[t0.industry] ? pickWeighted(world, Object.keys(m.indRev), i => m.indRev[i]) : t0.industry;
        if (ind) {
          const t = createTech(world, ctx, { kind: t0.kind, industry: ind, profession: t0.kind === 'automation' ? t0.profession : undefined, owner: null, origin: 'foreign' });
          t.fromCountry = n.id;
          st.kindCount[t.kind] = (st.kindCount[t.kind] || 0) + 1;
          ev(world, 'tech_foreign', `Из-за границы пришла технология ${q(t.name)}: сосед ${n.name} уже внедрил, теперь и нам предлагают (лицензия — за валюту)`, { tech: t.id, from: n.id });
        }
      }
    } else if (rand(world) < 0.0034 * open * A.researchLuck) {
      const m = mk();
      let t;
      if (rand(world) < 0.65 && pol.techBan !== 'automation' && m.list.length) {
        const e = pickWeighted(world, m.list.slice(0, 8), x => Math.pow(x.pay, 1.2));
        t = createTech(world, ctx, { kind: 'automation', industry: e.ind, profession: e.p, owner: null, origin: 'foreign' });
      } else {
        const ind = pickWeighted(world, Object.keys(m.indRev), i => m.indRev[i]);
        if (!ind) return;
        t = createTech(world, ctx, { kind: 'productivity', industry: ind, owner: null, origin: 'foreign' });
      }
      st.kindCount[t.kind] = (st.kindCount[t.kind] || 0) + 1;
      ev(world, 'tech_foreign', `Из-за границы пришла технология ${q(t.name)}: сосед внедрил, теперь и нам предлагают`, { tech: t.id });
    }
  }
}

// ───────────────────────── Внедрение ─────────────────────────

function adoptionPhase(world, ctx, st) {
  const pol = world.policies, T = world.tech, L = world.labor;
  if (pol.techBan === 'all') return;
  const wbar = world.calib.wbar || 1;
  const pay1 = 1 + pol.payrollTax * ctx.cmp;
  const slack = clamp(1 - 16 * (ctx.unemployment - 0.06), 0.03, 1);
  for (const t of T.list) {
    if (t.kind !== 'automation' && t.kind !== 'productivity' && t.kind !== 'gpt') continue;
    if (t.kind === 'automation' && pol.techBan === 'automation') continue;
    if (t.origin === 'foreign' && pol.foreignTech === 'closed') continue;
    const fr = feeRate(world, ctx, t);
    const acc = fr > 0 ? feeAccount(world, ctx, t) : null;
    const age = world.t - t.bornT;
    const noCuts = pol.techBan === 'automation'; // для технологии общего назначения: только отдача
    for (const f of world.firms) {
      if (!f.alive || f.owner === 'state' && pol.industry[f.industry].planned) continue;
      if (t.industry !== '*' && t.industry !== f.industry) continue;
      if (f.id === t.ownerFirmId) { /* владелец внедряет у себя без платы — ниже, как обычная фирма */ }
      if (f.tech.licenses.includes(t.id)) continue;
      const sizeScore = Math.min(1, 3 * (f.marketShare || 0));
      // крупные внедряют первыми, мелкие догоняют по мере удешевления и распространения
      // патентная плата бьёт по мелким сильнее: у них нет денег на лицензию и «масштаба», крупным она нипочём
      let p = ((0.008 + 0.0009 * Math.min(age, 120)) * (1 - Math.min(0.95, 2.2 * fr)) + 0.07 * sizeScore * (1 - 0.4 * fr)) * (fr === 0 ? 1.25 : 1);
      p *= slack; // при массовой безработице труд дешёв, а спрос слаб: внедрять невыгодно
      if (f.id === t.ownerFirmId) p = 0.2;
      if (!(rand(world) < p)) continue;
      // экономика внедрения
      let bCut = 0, sev = 0, ppl = 0;
      const people = {};
      if (!noCuts) {
        for (const pr in t.cuts) {
          const n = f.employees[pr] || 0, c = t.cuts[pr];
          const k = n * c;
          if (k < 0.55) continue;
          const w = Math.max(f.wageOffer[pr] || L[pr].wage, ctx.floor);
          bCut += n * w * pay1 * c;
          sev += pol.firingCost * w * k;
          people[pr] = k; ppl += k;
        }
      }
      let bProd = 0;
      if (t.prodGain > 0) bProd = t.prodGain * Math.max(0, f.revenue) * 0.5;
      const b = bCut + bProd;
      if (!(b > 0)) continue;
      const own = f.id === t.ownerFirmId;
      const feeM = own ? 0 : fr * b;
      const setup = own || fr === 0 ? 0 : 1.5 * b;
      const robot = pol.robotTax * bCut;
      const sub = pol.automationSubsidy * 12 * bCut * ctx.cutK;
      const net = b - feeM - robot - sev / 30 + sub / 30 - setup / 30;
      if (net < 0.12 * b) continue;
      if (setup > 0 && f.cash < 0.8 * setup) continue;
      // внедряем
      if (setup > 0 && acc) safePay(world, f, acc, setup, 'tech_licenses');
      if (sub > 0) safePay(world, world.gov, f, sub, 'automation_subsidy');
      // внедрение идёт постепенно (PHASE месяцев): цех не останавливают ради робота, люди уходят волной, а не разом
      const ph = f.tech.phase || (f.tech.phase = {});
      for (const pr in t.cuts) {
        if (!people[pr]) continue;
        const cur = f.tech.labor[pr] == null ? 1 : f.tech.labor[pr];
        const to = (ph[pr] ? ph[pr].to : cur) * (1 - t.cuts[pr]);
        ph[pr] = { to, step: (cur - to) / PHASE };
      }
      if (t.prodGain > 0) f.tech.prod *= 1 + t.prodGain;
      f.tech.licenses.push(t.id);
      f.tech.licBase[t.id] = bCut / wbar;
      f.tech.licBase[t.id + 'p'] = bProd / wbar;
      f.tech.maint = (f.tech.maint || 0) + 0.07 * ppl + (t.kind === 'gpt' ? 0.4 : 0.1);
      t.adopters.push(f.id);
      T.adoptions++;
    }
  }
}


/** Постепенное внедрение: множители труда снижаются к целевым, число вытесненных копится в f.tech.pend. */
function phasePhase(world, ctx) {
  const slack = clamp(1 - 16 * (ctx.unemployment - 0.06), 0, 1); // в спад увольнения откладывают
  for (const f of world.firms) {
    if (!f.alive) continue;
    const tc = f.tech;
    const ph = tc.phase;
    if (!ph) continue;
    let any = false;
    for (const p in ph) {
      const e = ph[p];
      const cur = tc.labor[p] == null ? 1 : tc.labor[p];
      if (cur <= e.to + 1e-9) { delete ph[p]; continue; }
      const next = Math.max(e.to, cur - e.step * slack);
      const emp = f.employees[p] || 0;
      if (emp > 0) { tc.pend[p] = (tc.pend[p] || 0) + emp * (1 - next / cur); tc.pendT = world.t; }
      tc.labor[p] = next;
      any = true;
    }
    if (!any) tc.phase = null;
  }
}

/** Ежемесячные платежи: плата за лицензии владельцам и налог на роботов. */
function feesPhase(world, ctx) {
  const pol = world.policies, T = world.tech;
  const wbar = world.calib.wbar || 1;
  const byId = {};
  for (const t of T.list) byId[t.id] = t;
  for (const f of world.firms) {
    if (!f.alive) continue;
    const tc = f.tech;
    if (!tc.licenses.length) { tc.fees = 0; continue; }
    let fees = 0, robot = 0;
    for (const id of tc.licenses) {
      const t = byId[id];
      if (!t) continue;
      const bc = (tc.licBase[id] || 0) * wbar, bp = (tc.licBase[id + 'p'] || 0) * wbar;
      if (f.id !== t.ownerFirmId) {
        const fr = feeRate(world, ctx, t);
        if (fr > 0) {
          const acc = feeAccount(world, ctx, t);
          if (acc) fees += safePay(world, f, acc, fr * (bc + bp), 'tech_licenses');
        }
      }
      if (pol.robotTax > 0 && bc > 0) robot += pol.robotTax * bc;
    }
    if (robot > 0) robot = safePay(world, f, world.gov, robot, 'robot_tax');
    tc.fees = fees;
    const tot = fees + robot;
    if (tot > 0) f.profitMargin = clamp(f.profitMargin - 0.0526 * tot / Math.max(f.revenue, 1), -1, 1);
  }
}

// ───────────────────────── Продукты ─────────────────────────

function productPhase(world, ctx, st) {
  const T = world.tech;
  const N = world.households.length;
  const hh = world.households;
  for (const t of T.list) {
    if (t.kind !== 'product') continue;
    const o = ctx.F[t.ownerFirmId];
    if (!o || !o.alive) continue;
    t.users = Math.min(1, t.users + 0.01 * (1 - t.users) + 0.002);
    const rev = t.demandGain * N * ctx.medWage * t.users;
    const K = 20;
    let got = 0;
    for (let k = 0; k < K; k++) {
      const h = hh[randInt(world, N)];
      if (h.status === 'retired' || h.cash < 1.5 * ctx.medWage) continue;
      const a = Math.min(rev / K * 1.6, 0.12 * h.cash);
      got += pay(world, h, o, a, 'consumption');
    }
    const jobs = 0.55 * got / Math.max(1, ctx.avgWage);
    st.prodJobs.set(o.id, (st.prodJobs.get(o.id) || 0) + jobs);
  }
}

// ───────────────────────── Платформы ─────────────────────────

function platformPhase(world, ctx, st) {
  const pol = world.policies, A = world.assumptions, T = world.tech, hh = world.households;
  const byInd = {};
  for (const f of world.firms) if (f.alive && f.platform) (byInd[f.platform.industry] ||= []).push(f);
  const ne = A.networkEffects * (pol.interoperability ? 0.35 : 1);
  let nPlat = 0;
  for (const I in byInd) {
    const pl = byInd[I];
    nPlat += pl.length;
    let U = 0;
    for (const f of pl) U += f.platform.users;
    const Unew = Math.min(PLAT_MAX, U + 0.004 + 0.05 * ne * U * (1 - U / PLAT_MAX));
    if (pl.length === 1) pl[0].platform.users = Unew;
    else {
      const g = pol.interoperability ? 1 : 1 + 0.9 * A.networkEffects;
      let sum = 0;
      for (const f of pl) sum += Math.pow(f.platform.users + 0.02, g);
      for (const f of pl) {
        const s = Math.pow(f.platform.users + 0.02, g) / sum;
        f.platform.users += 0.12 * (Unew * s - f.platform.users);
      }
    }
    for (const f of pl) {
      const P = f.platform;
      P.age++;
      const target = Math.min(pol.platformFeeCap, 0.06 + 0.36 * Math.pow(P.users, 1.2));
      P.fee += clamp(target - P.fee, -0.02, 0.02);
      P.fee = Math.min(P.fee, pol.platformFeeCap);
      P.income = 0;
    }
    st.platUsers[I] = pl.reduce((m, f) => Math.max(m, f.platform.users), 0);
  }
  st.nPlat = nPlat;
  if (!nPlat) {
    // платформ нет: подрядчики и вынужденные переходы сворачиваются
    for (const f of world.firms) if (f.alive && f.tech.gigR) restoreSeller(world, ctx, f, 0);
    return;
  }
  // продавцы платят комиссию и сокращают собственный найм «подёнщиков»
  for (const I in byInd) {
    const pl = byInd[I];
    const gp = GIG_PROF[I];
    const sellers = ctx.by[I];
    for (const g of sellers) {
      if (!g.alive || g.platform) continue;
      const shr = Math.min(0.8, 3 * (g.marketShare || 0));
      let R = 0, lead = null;
      for (const pf of pl) {
        const r = pf.platform.users * (1 - shr);
        R += r;
        if (!lead || pf.platform.users > lead.platform.users) lead = pf;
        const rev = Math.max(0, g.revenue);
        const fee = safePay(world, g, pf, pf.platform.fee * r * rev, 'platform_fees');
        if (fee > 0) {
          pf.platform.income += fee;
          g.profitMargin = clamp(g.profitMargin - 0.0526 * fee / Math.max(rev, 1), -1, 1);
          g.tech.fees += fee;
        }
      }
      R = Math.min(0.9, R);
      if (gp) {
        if (Math.abs(R - g.tech.gigR) >= 0.03) restoreSeller(world, ctx, g, R, gp, lead);
      }
    }
    // платформы тоже платят за свои инструменты; рекламные расходы не моделируем
  }
  // новые подрядчики из самозанятых (если платформа не обязана их нанимать)
  if (!pol.gigWorkersAreEmployees) {
    for (const h of hh) {
      if (h.status !== 'self' || !h.employerId) continue;
      const bf = ctx.F[h.employerId];
      if (!bf || !bf.alive || !GIG_PROF[bf.industry]) continue;
      const pl = byInd[bf.industry];
      if (!pl) continue;
      let u = 0, lead = pl[0];
      for (const f of pl) { u += f.platform.users; if (f.platform.users > lead.platform.users) lead = f; }
      if (lead.platform.gig < 0.045 * hh.length * Math.min(1, u) && rand(world) < 0.03 * Math.min(1, u)) {
        h.status = 'gig'; h.platformId = lead.id; h.employerId = null; h.wage = 0; h.jobSearch = 0;
      }
    }
  }
}

/** Пересчёт найма подёнщиков в отрасли продавца: доля R продаж идёт через платформу, продавцу нужно меньше своих работников. */
function restoreSeller(world, ctx, g, R, gp, lead) {
  const tc = g.tech;
  gp = gp || tc.gigProf;
  if (!gp) { tc.gigR = 0; return; }
  const old = tc.gigR || 0;
  const factor = (1 - 0.65 * R) / (1 - 0.65 * old);
  const m = tc.labor[gp] == null ? 1 : tc.labor[gp];
  tc.labor[gp] = m * factor;
  tc.gigR = R;
  tc.gigProf = gp;
  if (R > 0.02 && lead) tc.gigPlat = lead.id;
  if (factor >= 1 || !lead) return;
  // работников, которым платформа забирает работу, переводят в подрядчиков (или в штат платформы, если подрядчики приравнены к работникам)
  const pol = world.policies;
  const list = (ctx.workers[g.id] || []).filter(h => h.status === 'employed' && h.employerId === g.id && h.profession === gp);
  // дробные доли копятся, иначе у мелких фирм округление съедает переход
  tc.gigPend += list.length * (1 - factor);
  const k = Math.min(list.length, Math.floor(tc.gigPend));
  tc.gigPend -= k;
  for (let i = 0; i < k; i++) {
    const h = list[i];
    if (pol.gigWorkersAreEmployees) {
      h.employerId = lead.id; h.wage = 0; h.jobSearch = 0;
      lead.employees[gp] = (lead.employees[gp] || 0) + 1;
    } else {
      h.status = 'gig'; h.platformId = lead.id; h.employerId = null; h.wage = 0; h.jobSearch = 0;
    }
    g.employees[gp]--;
  }
}

/** Выплаты подрядчикам, смена режима «подрядчики — наёмные», контроль живости платформ. Один проход по домохозяйствам. */
function peoplePhase(world, ctx, st) {
  const pol = world.policies, T = world.tech;
  const hh = world.households;
  const L = world.labor;
  const gigBy = {};
  const empBy = {};
  const bp = T.byProfession;
  for (const p of PROF_IDS) bp[p].retraining = 0;
  let gigs = 0;
  const platSet = new Set();
  for (const f of world.firms) if (f.alive && f.platform) platSet.add(f.id);
  for (const h of hh) {
    if (h.retrain) bp[h.profession].retraining++;
    if (h.status === 'gig') {
      gigs++;
      const pf = ctx.F[h.platformId];
      if (!pf || !pf.alive || !pf.platform) { h.status = 'unemployed'; h.platformId = null; h.jobSearch = 0; continue; }
      if (pol.gigWorkersAreEmployees) {
        h.status = 'employed'; h.employerId = pf.id; h.platformId = null; h.wage = ctx.floor; h.jobSearch = 0;
        (empBy[pf.id] ||= {})[h.profession] = (empBy[pf.id][h.profession] || 0) + 1;
        continue;
      }
      (gigBy[pf.id] ||= []).push(h);
    } else if (h.status === 'employed' && platSet.has(h.employerId) && (h.profession === 'service' || h.profession === 'manual')) {
      (empBy[h.employerId] ||= {})[h.profession] = (empBy[h.employerId][h.profession] || 0) + 1;
    }
  }
  T.gigs = gigs;
  const brackets = pol.incomeTaxBrackets;
  for (const id in gigBy) {
    const pf = ctx.F[id];
    const arr = gigBy[id];
    pf.platform.gig = arr.length;
    // подрядчикам уходит доля сборов платформы: когда народу много, а комиссия мала, доход проваливается — гарантий нет
    const pool = 0.65 * pf.platform.income;
    const per = pool / arr.length;
    for (const h of arr) {
      const mw = L[h.profession].wage;
      const w = Math.min(per, 0.9 * mw) * (0.7 + 0.6 * rand(world));
      const paid = safePay(world, pf, h, w, 'wages');
      h.wage = paid;
      h.incomeBySource.wage += paid;
      const tx = incomeTax(brackets, ctx.medWage, paid) * ctx.cmp;
      if (tx > 0) ctx.tax[h.id - 1] += safePay(world, h, world.gov, tx, 'tax_income');
    }
    if (arr.length >= 3 && !pf.platform.partnersEv) {
      pf.platform.partnersEv = true;
      ev(world, 'gig_partners', `Платформа ${q(pf.name)}: сотрудники теперь «партнёры» — без больничных и выходного пособия, зато со свободным графиком (круглосуточным)`, { firm: pf.id });
    }
  }
  st.empBy = empBy;
}

// ───────────────────────── Штат и учёт ─────────────────────────

function staffPhase(world, ctx, st) {
  const T = world.tech;
  for (const f of world.firms) {
    if (!f.alive) continue;
    const tc = f.tech;
    const s = {};
    let any = false;
    const add = (p, n) => { if (n > 0.01) { s[p] = (s[p] || 0) + n; any = true; } };
    if (f.research) add('engineer', f.research.staff);
    if (tc.maint) add('engineer', tc.maint);
    const pj = st.prodJobs.get(f.id);
    if (pj) { add('engineer', 0.4 * pj); add('creative', 0.3 * pj); add('service', 0.3 * pj); }
    if (f.platform) {
      // штат растёт вместе со сборами: платформа тратит на разработчиков часть комиссии
      const inc = f.platform.income / Math.max(1, world.labor.engineer.wage);
      add('engineer', 0.3 + 0.35 * inc);
      add('manager', 0.1 + 0.1 * inc);
      const e = st.empBy && st.empBy[f.id];
      if (e) for (const p in e) add(p, e[p]);
    }
    tc.staff = s;
    if (tc.pendT && world.t - tc.pendT > 6) { tc.pend = {}; tc.pendT = 0; }
    if (f.research) st.targeted[f.research.profession || '_']++;
  }
}


/** Владелец платформы разорился или был поглощён: пользователей и код выкупает самая крупная IT-фирма без платформы (вызывается из labor.recount до проверки подрядчиков). */
export function platformSuccession(world, ctx) {
  for (const t of world.tech.list) {
    if (t.kind !== 'platform' || t.dead) continue;
    const o = ctx.F[t.ownerFirmId];
    if (!o || o.alive || !o.platform || o.platform.techId !== t.id) continue;
    if (o.platform.users > 0.04) {
      let best = null;
      for (const f of ctx.by.tech) if (f.alive && !f.platform && f.owner !== 'state' && (!best || f.capital > best.capital)) best = f;
      if (best) {
        best.platform = o.platform; o.platform = null; t.ownerFirmId = best.id;
        ev(world, 'platform_sold', `Платформа ${q(t.name)} осталась без хозяина и досталась фирме ${q(best.name)}: пользователи даже не заметили`, { tech: t.id, firm: best.id });
        for (const h of world.households) if (h.status === 'gig' && h.platformId === o.id) h.platformId = best.id;
        continue;
      }
    }
    t.dead = true;
  }
}

function wavesAndEvents(world, ctx, st) {
  const T = world.tech;
  const L = world.labor;
  const bp = T.byProfession;
  for (const p of PROF_IDS) {
    const b = bp[p];
    const fired = ctx.techFired?.[p] || 0;
    b.displaced = b.displaced * (11 / 12) + fired;
    T.displacedTotal += fired;
    b.targeted = st.targeted[p] || 0;
    const base = Math.max(8, 0.04 * (L[p].employed + 1));
    if (b.displaced > base && (T.waveT[p] == null || world.t - T.waveT[p] > 30)) {
      T.waveT[p] = world.t;
      ev(world, 'layoff_wave', `Волна увольнений: за год без работы из-за технологий осталось около ${Math.round(b.displaced)} домохозяйств профессии «${LABEL[p]}». Им рекомендуют освоить что-нибудь, что пока не умеет машина`, { profession: p, n: b.displaced });
    }
  }
  // патенты
  for (const t of T.list) {
    if (!t.expired && world.t >= t.patentUntil && world.t > t.bornT) {
      t.expired = true;
      if (t.origin === 'private' && t.adopters.length >= 2 && (t.kind === 'automation' || t.kind === 'productivity' || t.kind === 'gpt') && world.policies.patentYears > 0) {
        ev(world, 'patent_expired', `Патент на ${q(t.name)} истёк: теперь им пользуются все, а фирма-владелец вспоминает, как хорошо было без конкурентов`, { tech: t.id });
      }
    }
    if (t.kind === 'platform' && !t.dead) {
      const o = ctx.F[t.ownerFirmId];
      if (!o || !o.alive || !o.platform || o.platform.techId !== t.id) { t.dead = true; continue; }
      if (o.platform.users > 0.5 && !t.captured) {
        t.captured = true;
        ev(world, 'platform_capture', `Платформа ${q(t.name)} захватила отрасль «${IND[o.platform.industry].label}»: больше половины сделок идёт через неё, комиссия ${Math.round(o.platform.fee * 100)}%, выбора нет`, { tech: t.id, firm: o.id }, 1);
      }
    }
  }
}

function dissolvePlatforms(world, ctx, st) {
  for (const f of world.firms) {
    if (!f.alive || !f.platform) continue;
    const P = f.platform;
    if (P.age > 30 && P.users < 0.008) {
      const t = techById(world, P.techId);
      f.platform = null;
      if (t) t.dead = true;
      ev(world, 'platform_dead', `Платформа ${t ? q(t.name) : ''} закрылась: победитель забрал рынок, остальным остались воспоминания и презентации`, { firm: f.id });
    }
  }
}

export function techPhase(world, ctx) {
  const T = world.tech;
  if (!T.byProfession.manual) for (const p of PROF_IDS) T.byProfession[p] = { displaced: 0, targeted: 0, retraining: 0 };
  const st = {
    N: world.households.length, spend: 0, sci: [], mk: null, prodJobs: new Map(), targeted: {}, empBy: null,
    platUsers: {}, kindCount: {}, nGpt: 0, lastGpt: -999, nPlat: 0,
  };
  for (const p of PROF_IDS) st.targeted[p] = 0;
  for (const t of T.list) { st.kindCount[t.kind] = (st.kindCount[t.kind] || 0) + 1; if (t.kind === 'gpt') { st.nGpt++; st.lastGpt = Math.max(st.lastGpt, t.bornT); } }
  T.gptBoost *= 0.994;
  // учёные и инженеры — получатели прочих расходов на исследования
  for (const h of world.households) if ((h.profession === 'creative' || h.profession === 'engineer') && h.status !== 'retired') st.sci.push(h);
  researchPhase(world, ctx, st);
  sciencePhase(world, ctx, st);
  adoptionPhase(world, ctx, st);
  phasePhase(world, ctx);
  feesPhase(world, ctx);
  productPhase(world, ctx, st);
  platformPhase(world, ctx, st);
  peoplePhase(world, ctx, st);
  dissolvePlatforms(world, ctx, st);
  staffPhase(world, ctx, st);
  wavesAndEvents(world, ctx, st);
  T.researchSpend = st.spend;
  T.count = T.list.length;
}

/** Запустить платформу у фирмы вручную (для сценариев и тестов: «при прочих равных»). Возвращает технологию или null. */
export function forcePlatform(world, ctx, firm, industry) {
  if (!firm || !firm.alive || firm.platform) return null;
  const t = createTech(world, ctx, { kind: 'platform', industry, owner: firm, origin: 'private' });
  firm.platform = { industry, users: 0.02, fee: 0.04, gig: 0, techId: t.id, income: 0, age: 0 };
  return t;
}

/** Создать технологию у фирмы вручную (для сценариев и тестов: одна и та же технология в двух ветках). */
export function forceTech(world, firm, spec) {
  return createTech(world, {}, { kind: spec.kind, industry: spec.industry, profession: spec.profession, owner: firm, origin: 'private' });
}
