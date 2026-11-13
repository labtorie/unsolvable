// Журнал явлений (GDD §10): игра ничего не запускает, но узнаёт сложившуюся картину по показателям, даёт ей имя
// и пишет в журнал вместе с тем, какие решения игрока к ней привели.
// Вход и выход — с гистерезисом (несколько месяцев подряд), чтобы явления не мигали.
import { PROFESSIONS, INDUSTRIES, createPolicies } from '../schema.js';
import { addEvent, clamp } from './util.js';
import { leverDef, getLever, fmtLever } from '../mailbox.js';
import { PHENOMENA_INFO } from '../phenomena-info.js';

const WARMUP = 12;          // первый год мир устаканивается — явлений не фиксируем
const LOG_CAP = 80;
const PROF = Object.fromEntries(PROFESSIONS.map(p => [p.id, p.label]));
const IND = Object.fromEntries(INDUSTRIES.map(i => [i.id, i.label]));
const DEFAULTS = createPolicies();
const TRADE_GOODS = INDUSTRIES.filter(i => i.tradable).map(i => i.id);
const pc = (x, d = 0) => `${(x * 100).toFixed(d)}%`;

export function freshPhenomena() {
  return { ver: 1, active: {}, log: [], seen: {}, track: { cnt: {}, off: {}, emis: 0, mfg: [], privT: [], privBase: 0 } };
}

export function ensurePhenomena(world) {
  let p = world.phenomena;
  if (!p || typeof p !== 'object') p = world.phenomena = freshPhenomena();
  if (p.ver === 1 && p.track) return p;
  const f = freshPhenomena();
  for (const k in f) if (p[k] === undefined) p[k] = structuredClone(f[k]);
  for (const k in f.track) if (p.track[k] === undefined) p.track[k] = structuredClone(f.track[k]);
  p.ver = 1;
  return p;
}

// ───────────── общие показатели месяца ─────────────
function indicators(world, P) {
  const st = world.stats, g = world.gov, fl = world.flows;
  const gdp = Math.max(1, st.gdp);
  const X = { st, gov: g, fin: world.finance, pol: world.policies, gdp };
  const emis = (fl.emission || 0) / gdp;
  P.track.emis = 0.7 * P.track.emis + 0.3 * emis;
  X.emis = P.track.emis;
  X.infl = st.inflation || 0;
  X.u = st.unemployment || 0;
  X.interest = (fl.gov_interest || 0) / Math.max(1, g.revenue || 1);
  // ряд выпуска обрабатывающей промышленности для «голландской болезни»
  const mf = P.track.mfg;
  mf.push(world.markets?.manufacturing?.sold || 0);
  if (mf.length > 48) mf.shift();
  // приватизации (событие этого месяца)
  for (let i = world.events.length - 1; i >= 0 && world.events[i].t === world.t; i--) {
    if (world.events[i].type === 'privatization') {
      if (!P.track.privT.length || world.t - P.track.privT[P.track.privT.length - 1] > 12) P.track.privBase = st.top1WealthShare || 0;
      P.track.privT.push(world.t);
    }
  }
  P.track.privT = P.track.privT.filter(t => world.t - t <= 36);
  return X;
}

const series = (world, key) => world.history?.series?.[key] || [];
const lowestProf = X => {
  let best = null;
  for (const p in X.st.employmentByProfession || {}) {
    const e = X.st.employmentByProfession[p];
    if (e.employed >= 5 && (!best || e.avgWage < best.w)) best = { id: p, w: e.avgWage };
  }
  return best;
};

// ───────────── описания явлений ─────────────
// check(world, X, P) → { on, off, data, facts, pairs? } ; n/m — месяцев подряд для входа/выхода; every — раз в сколько месяцев проверять.
export const PHENOMENA = [
  {
    id: 'circular_bubble', n: 3, m: 4,
    event: 'Круговой пузырь: фирмы продают друг другу за деньги, которые друг другу же и вложили. Выручка растёт, правда, у всех сразу',
    levers: ['marginLimit', 'crossOwnershipCap', 'vendorFinancingBan', 'cbRate', 'financialTransactionTax', 'pensionEquityShare'],
    check(world, X) {
      const f = X.fin;
      const on = f.circularShare >= 0.05 && f.ratio >= 1.25;
      const off = f.circularShare < 0.03 || f.ratio < 1.1;
      return { on, off, data: { circular: f.circularShare, ratio: f.ratio },
        facts: [`«круговая» выручка — ${pc(f.circularShare, 1)} всей выручки фирм`, `капитализация в ${f.ratio.toFixed(2)} раза выше «честной» оценки`,
          `долг под залог акций — ${pc(f.marginDebt / Math.max(1, f.totalValue), 1)} капитализации`] };
    },
  },
  {
    id: 'crash_credit', n: 2, m: 6,
    event: 'Крах и кредитное сжатие: цены активов рухнули, банки требуют вернуть кредиты — все разом и немедленно',
    levers: ['marginLimit', 'bailoutPolicy', 'bankReserve', 'cbRate', 'crossOwnershipCap', 'financialTransactionTax'],
    check(world, X) {
      const f = X.fin;
      const on = f.drawdown >= 0.3 && f.bankCrunch >= 0.15;
      const off = f.drawdown < 0.15 && f.bankCrunch < 0.1;
      return { on, off, data: { drawdown: f.drawdown, crunch: f.bankCrunch },
        facts: [`индекс просел на ${pc(f.drawdown)} от максимума`, `банки душат кредит на ${pc(f.bankCrunch)}`, `принудительных продаж за месяц: ${Math.round(f.forcedSales || 0)}`] };
    },
  },
  {
    id: 'tech_unemployment', n: 3, m: 6,
    event: null,
    levers: ['techBan', 'robotTax', 'retrainingBudget', 'automationSubsidy', 'unemploymentBenefit', 'firingCost', 'patentYears'],
    check(world, X, P) {
      const cur = P.active.tech_unemployment?.data?.profession;
      let best = null;
      for (const p in world.tech?.byProfession || {}) {
        const b = world.tech.byProfession[p], e = X.st.employmentByProfession?.[p], L = world.labor?.[p];
        if (!e || !L) continue;
        const lf = e.employed + e.unemployed;
        const share = b.displaced / Math.max(5, lf);
        if (cur && p !== cur) continue;
        if (!best || share > best.share) best = { p, share, disp: b.displaced, u: L.u || 0, retr: b.retraining || 0 };
      }
      if (!best) return { on: false, off: true, data: {}, facts: [] };
      const on = best.disp >= 4 && best.share >= 0.03 && best.u >= 0.07;
      const off = best.u < 0.04 || best.disp < 2;
      return { on, off, data: { profession: best.p, displaced: best.disp, u: best.u },
        facts: [`из профессии «${PROF[best.p]}» за год вытеснено ${best.disp} домохозяйств (${pc(best.share, 1)})`, `безработица в профессии — ${pc(best.u, 1)}`, `переучивается: ${best.retr}`] };
    },
  },
  {
    id: 'platform_capture', n: 3, m: 4,
    event: null,
    levers: ['platformFeeCap', 'interoperability', 'gigWorkersAreEmployees', 'startupAcquisitionBan', 'patentYears', 'compulsoryLicensing'],
    check(world, X, P) {
      let best = null;
      for (const f of world.firms) if (f.alive && f.platform && (!best || f.platform.users > best.platform.users)) best = f;
      const users = best ? best.platform.users : 0;
      const on = users >= 0.5;
      const off = users < 0.35;
      return { on, off, data: best ? { firm: best.name, industry: best.platform.industry, users, fee: best.platform.fee } : {},
        facts: best ? [`«${best.name}» — через неё идёт ${pc(users)} рынка отрасли «${IND[best.platform.industry] || ''}»`, `комиссия платформы — ${pc(best.platform.fee)}`, `подрядчиков на платформе: ${best.platform.gig || 0}`] : [] };
    },
  },
  {
    id: 'company_town', n: 2, m: 2, every: 3,
    event: null,
    levers: ['antitrustThreshold', 'antitrustBreakup', 'unionPower', 'minWage', 'firingCost'],
    check(world, X, P) {
      let best = null;
      const byP = {};
      for (const f of world.firms) {
        if (!f.alive) continue;
        for (const p in f.employees) {
          const n = f.employees[p];
          if (n <= 0) continue;
          const r = byP[p] ||= { tot: 0, top: null, n: 0 };
          r.tot += n;
          if (n > r.n) { r.n = n; r.top = f; }
        }
      }
      for (const p in byP) {
        if (p === 'official') continue;
        const r = byP[p];
        if (r.tot < 12) continue;
        const share = r.n / r.tot;
        if (!best || share > best.share) best = { p, share, f: r.top, tot: r.tot };
      }
      if (!best) return { on: false, off: true, data: {}, facts: [] };
      const w = best.f.wageOffer?.[best.p] || 0, mw = world.labor?.[best.p]?.wage || 0;
      const on = best.share >= 0.65 && (mw <= 0 || w <= mw * 1.02);
      const off = best.share < 0.5;
      return { on, off, data: { firm: best.f.name, profession: best.p, share: best.share },
        facts: [`«${best.f.name}» нанимает ${pc(best.share)} работников профессии «${PROF[best.p]}» (${best.tot} домохозяйств всего)`, `предлагаемая зарплата — ${Math.round(w)} при рыночной ${Math.round(mw)}`],
        pairs: [['ownership', best.f.industry]] };
    },
  },
  {
    id: 'hyperinflation', n: 3, m: 12,
    event: 'Гиперинфляция: печатный станок покрывает дефицит, а цены ускоряются. Зарплату теперь выдают до обеда — к вечеру она другая',
    levers: ['deficitMonetization', 'cbMandate', 'cbRate', 'fxRegime', 'capitalControls', 'inflationTarget', 'propertyRights'],
    check(world, X) {
      const on = X.emis >= 0.05 && X.infl >= 0.12;
      const off = X.infl < 0.05 || X.emis < 0.02;
      return { on, off, data: { inflation: X.infl, emission: X.emis },
        facts: [`инфляция — ${pc(X.infl)} в год`, `эмиссия — ${pc(X.emis, 1)} ВВП в месяц (сглаженно)`, `государственный долг — ${Math.round(world.gov.debt)}`] };
    },
  },
  {
    id: 'debt_crisis', n: 3, m: 6,
    event: 'Долговой кризис: проценты по госдолгу съедают растущую долю бюджета. Кредиторы стали вежливо-холодны',
    levers: ['deficitMonetization', 'pensionLevel', 'unemploymentBenefit', 'officialPay', 'healthBudget', 'educationBudget', 'ubi', 'minIncomeGuarantee', 'corpTax', 'vat', 'taxAdmin'],
    check(world, X) {
      const g = X.gov;
      const on = X.interest >= 0.18 || g.cut >= 0.04;
      const off = X.interest < 0.1 && g.cut < 0.01;
      return { on, off, data: { interest: X.interest, cut: g.cut },
        facts: [`проценты по госдолгу — ${pc(X.interest)} доходов бюджета`, `долг ${Math.round(g.debt)} (${(g.debt / (X.gdp * 12)).toFixed(2)} годового ВВП)`, g.cut > 0 ? `расходы урезаны на ${pc(g.cut)}` : `дефолтов за игру: ${g.defaults || 0}`] };
    },
  },
  {
    id: 'shortage', n: 3, m: 4,
    event: 'Дефицит и очереди: потолок цены ниже себестоимости, и товар исчез раньше, чем его успели подешевить',
    levers: [],
    check(world, X) {
      const hit = [];
      for (const g in world.policies.industry) {
        const ip = world.policies.industry[g], mk = world.markets[g];
        if (ip.priceCap > 0 && mk && mk.shortage >= 0.12) hit.push({ g, s: mk.shortage, cap: ip.priceCap });
      }
      const on = hit.length > 0;
      let still = false;
      for (const g in world.policies.industry) if (world.policies.industry[g].priceCap > 0 && world.markets[g]?.shortage >= 0.05) still = true;
      hit.sort((a, b) => b.s - a.s);
      return { on, off: !still, data: { industries: hit.map(h => h.g) },
        facts: hit.slice(0, 4).map(h => `«${IND[h.g]}»: не хватает ${pc(h.s)} товара при потолке цены ${h.cap.toFixed(2)} себестоимости`),
        pairs: hit.slice(0, 4).flatMap(h => [['priceCap', h.g], ['subsidy', h.g], ['ownership', h.g]]) };
    },
  },
  {
    id: 'black_market', n: 3, m: 6,
    event: 'Чёрный рынок расцвёл: то, что нельзя, теперь продают из-под полы, и оборот растёт быстрее легального',
    levers: ['vicePolicy', 'exciseVice', 'securityBudget', 'repression', 'taxAdmin', 'courtsIndependence'],
    check(world, X) {
      const p = X.pol;
      const driver = p.vicePolicy === 'banned' || p.exciseVice >= 1.5;
      const on = driver && X.gov.shadowShare >= 0.25 && X.gov.crime >= 0.3;
      const off = !driver || X.gov.shadowShare < 0.18;
      return { on, off, data: { shadow: X.gov.shadowShare, crime: X.gov.crime },
        facts: [`в тени — ${pc(X.gov.shadowShare)} экономики`, `преступность — ${pc(X.gov.crime)}`, p.vicePolicy === 'banned' ? '«Грешные» товары запрещены' : `акциз на «грешные» товары — ${pc(p.exciseVice)}`] };
    },
  },
  {
    id: 'poverty_trap', n: 3, m: 6,
    event: 'Ловушка бедности: пособие по безработице почти равно зарплате низшей профессии. Рациональные люди рационально сидят дома',
    levers: ['unemploymentBenefit', 'minIncomeGuarantee', 'minWage', 'ubi', 'incomeTaxBrackets'],
    check(world, X) {
      const low = lowestProf(X);
      if (!low) return { on: false, off: true, data: {}, facts: [] };
      const rate = X.pol.unemploymentBenefit * Math.max(1, X.st.avgWage) / Math.max(1, low.w * 0.85);
      const on = rate >= 0.8 && X.u >= 0.06;
      const off = rate < 0.6 || X.u < 0.03;
      return { on, off, data: { rate, profession: low.id, u: X.u },
        facts: [`пособие — ${pc(rate)} чистой зарплаты самой низкооплачиваемой профессии («${PROF[low.id]}»)`, `безработица — ${pc(X.u, 1)}`] };
    },
  },
  {
    id: 'miracle', n: 6, m: 6, every: 3,
    event: 'Экономическое чудо: пять лет быстрого роста, и доходы растут даже у нижних классов. Все уже придумали, почему это заслуга их политики',
    levers: 'ALL',
    check(world, X) {
      const g = series(world, 'gdpReal'), w = series(world, 'avgWage'), c = series(world, 'cpi'), pv = series(world, 'povertyRate');
      const n = g.length;
      if (n < 62) return { on: false, off: false, data: {}, facts: [] };
      const cagr = (a, b, yrs) => Math.pow(Math.max(1e-9, b) / Math.max(1e-9, a), 1 / yrs) - 1;
      const g60 = cagr(g[n - 61], g[n - 1], 5);
      const g36 = cagr(g[n - 37], g[n - 1], 3);
      const rw60 = cagr(w[n - 61] / Math.max(1e-9, c[n - 61]), w[n - 1] / Math.max(1e-9, c[n - 1]), 5);
      const povUp = pv[n - 1] - pv[n - 61];
      const on = g60 >= 0.045 && rw60 >= 0.025 && povUp <= 0.02 && X.u < 0.1;
      const off = g36 < 0.02 || X.u >= 0.12;
      return { on, off, data: { growth5: g60, realWage5: rw60 },
        facts: [`реальный ВВП за пять лет растёт на ${pc(g60, 1)} в год`, `реальная зарплата — на ${pc(rw60, 1)} в год`, `бедность за пять лет ${povUp <= 0 ? 'снизилась' : 'почти не выросла'} (${pc(pv[n - 61], 0)} → ${pc(pv[n - 1], 0)})`] };
    },
  },
  {
    id: 'oligarchs', n: 3, m: 6,
    event: 'Олигархи: после приватизации доля верхнего 1% скакнула вверх. Совпадение, разумеется, — просто «свои» оказались самыми успешными покупателями',
    levers: ['wealthTax', 'inheritanceTax', 'antitrustThreshold', 'corpTax', 'propertyRights'],
    check(world, X, P) {
      const T = P.track;
      const top = X.st.top1WealthShare || 0;
      const rise = top - (T.privBase || 0);
      const inWindow = T.privT.length > 0;
      const on = inWindow && rise >= 0.06 && X.gov.corruption >= 0.2;
      const off = !inWindow || rise < 0.02;
      return { on, off, data: { top1: top, base: T.privBase, privatizations: T.privT.length },
        facts: [`доля верхнего 1% по богатству: ${pc(T.privBase)} → ${pc(top)}`, `приватизаций за три года: ${T.privT.length}`, `коррупция — ${pc(X.gov.corruption)}`],
        pairs: INDUSTRIES.map(i => ['ownership', i.id]) };
    },
  },
  {
    id: 'regulator_capture', n: 2, m: 4, every: 3,
    event: null,
    levers: ['antitrustThreshold', 'regulationBurden', 'courtsIndependence', 'pressFreedom', 'taxAdmin', 'patentYears'],
    check(world, X) {
      const cap = world.mail?.captured || {};
      let best = null;
      for (const id in cap) {
        const recent = cap[id].filter(t => world.t - t <= 60);
        if (recent.length >= 2 && (!best || recent.length > best.n)) best = { id: +id, n: recent.length };
      }
      if (!best) return { on: false, off: true, data: {}, facts: [] };
      const f = world.firms.find(x => x.id === best.id);
      const on = X.gov.corruption >= 0.22;
      const off = X.gov.corruption < 0.15;
      return { on, off, data: { firm: f ? f.name : '#' + best.id, accepted: best.n, corruption: X.gov.corruption },
        facts: [`принято просьб одной фирмы («${f ? f.name : '#' + best.id}»): ${best.n}`, `коррупция — ${pc(X.gov.corruption)}`, `независимость судов — ${pc(X.pol.courtsIndependence)}`] };
    },
  },
  {
    id: 'dutch_disease', n: 4, m: 6, every: 3,
    event: 'Голландская болезнь: сырьё приносит валюту, валюта крепнет, а заводы закрываются — им теперь невыгодно конкурировать с импортом',
    levers: ['fxRegime', 'resourceRent', 'rentDistribution', 'capitalControls'],
    check(world, X, P) {
      const mk = world.markets.mining, fx = series(world, 'fx'), mf = P.track.mfg;
      const n = fx.length;
      if (n < 62 || mf.length < 40) return { on: false, off: false, data: {}, facts: [] };
      const expShare = (mk.exports || 0) * (mk.price || 1) / X.gdp;
      const fxUp = fx[n - 1] / Math.max(1e-9, fx[n - 61]);
      const mf0 = mf.slice(0, 6).reduce((a, b) => a + b, 0) / 6, mf1 = mf.slice(-6).reduce((a, b) => a + b, 0) / 6;
      const mfRel = mf1 / Math.max(1e-9, mf0);
      const on = expShare >= 0.1 && fxUp >= 1.2 && mfRel <= 0.85;
      const off = fxUp < 1.1 || mfRel > 0.95 || expShare < 0.06;
      return { on, off, data: { expShare, fxUp, mfRel },
        facts: [`экспорт сырья — ${pc(expShare, 1)} ВВП`, `курс укрепился в ${fxUp.toFixed(2)} раза за пять лет`, `выпуск обрабатывающей промышленности — ${pc(mfRel)} от уровня трёхлетней давности`],
        pairs: [['tariff', 'manufacturing']] };
    },
  },
  {
    id: 'stagflation', n: 3, m: 6,
    event: 'Стагфляция: цены растут, работы всё меньше. Классические учебники были уверены, что так не бывает, но не уточнили почему',
    levers: ['cbMandate', 'cbRate', 'deficitMonetization', 'minWage', 'firingCost', 'unionPower', 'payrollTax'],
    check(world, X) {
      const on = X.infl >= 0.08 && X.u >= 0.09;
      const off = X.infl < 0.04 || X.u < 0.06;
      return { on, off, data: { inflation: X.infl, u: X.u },
        facts: [`инфляция — ${pc(X.infl)}`, `безработица — ${pc(X.u, 1)}`, `реальный ВВП за год: ${pc(X.st.gdpGrowth, 1)}`] };
    },
  },
  {
    id: 'monopoly_age', n: 4, m: 6,
    event: 'Эпоха монополий: в отраслях осталось по паре игроков, и один из них — главный',
    levers: ['antitrustThreshold', 'antitrustBreakup', 'regulationBurden', 'startupAcquisitionBan', 'corpTaxLargeSurcharge', 'patentYears'],
    check(world, X) {
      const h = X.st.avgHhi || 0;
      return { on: h >= 0.45, off: h < 0.35, data: { hhi: h },
        facts: [`средняя концентрация по отраслям (HHI) — ${h.toFixed(2)}`, `антимонопольный порог — ${pc(X.pol.antitrustThreshold)}`] };
    },
  },
  {
    id: 'trade_war', n: 3, m: 6, every: 1,
    event: 'Торговая война: пошлины выросли с обеих сторон, торговля сжалась, а платят по обоим счетам покупатели',
    levers: ['emigrationAllowed'],
    check(world, X) {
      if (!world.neighbors?.length) return { on: false, off: false, data: {}, facts: [] };
      const rows = world.neighbors.map(n => {
        const ours = world.policies.tradeWith?.[n.id]?.tariff || 0;
        const theirs = n.world.policies.tradeWith?.home?.tariff || 0;
        const ind = TRADE_GOODS.reduce((a, g) => a + world.policies.industry[g].tariff, 0) / TRADE_GOODS.length;
        const our = (1 + ind) * (1 + ours) - 1;
        return { n, our, theirs, vol: (world.xb.pairEma['home>' + n.id] || 0) + (world.xb.pairEma[n.id + '>home'] || 0) };
      });
      const hot = rows.filter(r => r.our >= 0.25 && r.theirs >= 0.15);
      const cold = rows.every(r => r.our < 0.15 || r.theirs < 0.08);
      return { on: hot.length > 0, off: cold, data: { with: hot.map(r => r.n.id), ours: hot.map(r => r.our), theirs: hot.map(r => r.theirs) },
        facts: hot.length ? hot.map(r => `${r.n.name}: наши пошлины ${pc(r.our)}, ответные — ${pc(r.theirs)}`).concat([`торговля с ними за месяц — ${Math.round(hot.reduce((a, r) => a + r.vol, 0)).toLocaleString('ru-RU')} (мировых единиц)`]) : ['пошлины с обеих сторон снижаются'],
        pairs: TRADE_GOODS.map(g => ['tariff', g]) };
    },
  },
  {
    id: 'brain_drain', n: 3, m: 8, every: 1,
    event: 'Утечка мозгов: инженеры, менеджеры и врачи уезжают к соседям — там, говорят, и зарплата выше, и пресса скучнее',
    levers: ['emigrationAllowed', 'repression', 'pressFreedom', 'courtsIndependence', 'incomeTaxBrackets'],
    check(world, X) {
      const xb = world.xb;
      if (!xb) return { on: false, off: false, data: {}, facts: [] };
      const recent = xb.mig.filter(m => m.from === 'home' && world.t - m.t < 12);
      const skilled = recent.filter(m => m.skilled);
      const N = Math.max(1, world.households.length);
      const to = {};
      for (const m of skilled) to[m.to] = (to[m.to] || 0) + 1;
      const top = Object.entries(to).sort((a, b) => b[1] - a[1])[0];
      const nm = top ? (world.neighbors.find(n => n.id === top[0])?.name || top[0]) : '';
      return { on: skilled.length >= Math.max(5, 0.012 * N), off: skilled.length < Math.max(2, 0.004 * N), data: { skilled: skilled.length, total: recent.length },
        facts: [`квалифицированных переселенцев за год: ${skilled.length} из ${recent.length}`, ...(top ? [`чаще всего — в ${nm}`] : []), `выезд — ${world.policies.emigrationAllowed ? 'свободный' : 'запрещён'}`] };
    },
  },
];

for (const d of PHENOMENA) Object.assign(d, PHENOMENA_INFO.find(x => x.id === d.id));

// ───────────── решения, приведшие к явлению ─────────────
function causesOf(world, def, res) {
  const pairs = [];
  if (def.levers === 'ALL') {
    for (const k in DEFAULTS) if (k !== 'industry') pairs.push([k, null]);
  } else for (const l of def.levers) pairs.push([l, null]);
  for (const p of res.pairs || []) pairs.push(p);
  const out = [];
  for (const [lever, industry] of pairs) {
    const d = leverDef(lever, industry);
    if (!d) continue;
    const cur = getLever(world, lever, industry);
    const dv = industry ? DEFAULTS.industry[industry]?.[lever] : DEFAULTS[lever];
    if (cur === undefined || JSON.stringify(cur) === JSON.stringify(dv)) continue;
    if (d.type === 'range' && typeof cur === 'number' && Math.abs(cur - dv) < 0.08 * (d.max - d.min)) continue;
    out.push({ lever, industry: industry || null, label: (industry ? `${IND[industry]}: ` : '') + d.label, now: fmtLever(d, cur), dflt: fmtLever(d, dv),
      score: d.type === 'range' ? Math.abs(cur - dv) / (d.max - d.min) : 1 });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, 8).map(({ score, ...c }) => c);
}

// ───────────── фаза ─────────────
/** Распознавание явлений по показателям: запись в журнал и ленту. */
export function phenomenaPhase(world, ctx) {
  const P = ensurePhenomena(world);
  const X = indicators(world, P);
  if (world.t < WARMUP) return;
  const T = P.track;
  for (const def of PHENOMENA) {
    if (def.every && world.t % def.every !== 0) continue;
    const res = def.check(world, X, P);
    const act = P.active[def.id];
    if (!act) {
      T.cnt[def.id] = res.on ? (T.cnt[def.id] || 0) + 1 : 0;
      if (T.cnt[def.id] >= (def.n || 3)) {
        T.cnt[def.id] = 0;
        P.active[def.id] = { id: def.id, name: def.name, since: world.t, causes: causesOf(world, def, res), facts: res.facts, data: res.data, peakFacts: res.facts };
        P.seen[def.id] = (P.seen[def.id] || 0) + 1;
        T.off[def.id] = 0;
        addEvent(world, 'phenomenon', def.event || `Явление: «${def.name}». ${res.facts[0] ? res.facts[0][0].toUpperCase() + res.facts[0].slice(1) + '.' : ''}`, { phenomenon: def.id });
      }
    } else {
      act.data = res.data && Object.keys(res.data).length ? res.data : act.data;
      if (res.facts?.length) act.facts = res.facts;
      T.off[def.id] = res.off && !res.on ? (T.off[def.id] || 0) + 1 : 0;
      if (T.off[def.id] >= (def.m || 4) && world.t - act.since >= 3) {
        // в историю — признаки на момент входа: к выходу они уже «нормальные» и сбивают с толку
        P.log.unshift({ ...act, facts: act.peakFacts || act.facts, to: world.t, months: world.t - act.since });
        if (P.log.length > LOG_CAP) P.log.length = LOG_CAP;
        delete P.active[def.id];
        T.off[def.id] = 0;
        addEvent(world, 'phenomenon_end', `Явление закончилось: «${def.name}» (${world.t - act.since} мес.). Учебники, как обычно, опоздают с описанием`, { phenomenon: def.id });
      }
    }
  }
}
