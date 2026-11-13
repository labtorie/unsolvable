// Заглушка симуляции с тем же API, что у ../sim/index.js: newGame / step / snapshot.
// Строит мир формы schema.js и шевелит его случайными блужданиями. Экономики здесь нет.
import {
  createWorld, makeHousehold, makeFirm, INDUSTRIES, PROFESSIONS, NEEDS, CLASSES, HISTORY_KEYS,
} from '../sim/schema.js';

export const isMock = true;

function rand(w) {                       // mulberry32 на world.rngState (детерминированно и снимается)
  let a = (w.rngState = (w.rngState + 0x6D2B79F5) | 0);
  a = Math.imul(a ^ (a >>> 15), a | 1);
  a ^= a + Math.imul(a ^ (a >>> 7), a | 61);
  return ((a ^ (a >>> 14)) >>> 0) / 4294967296;
}
function randn(w) { return Math.sqrt(-2 * Math.log(rand(w) + 1e-12)) * Math.cos(2 * Math.PI * rand(w)); }
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const pick = (w, arr) => arr[Math.floor(rand(w) * arr.length)];

const PREFIX = ['Сталь', 'Нива', 'Вектор', 'Гранит', 'Омега', 'Прогресс', 'Лотос', 'Монолит', 'Заря', 'Дельта', 'Атлант', 'Кедр', 'Ладья', 'Синергия', 'Эталон', 'Горизонт'];
const SUFFIX = ['-3', '-7', ' Групп', ' и Ко', ' Холдинг', 'Плюс', ' Инвест', '-М', ' Трест', ' Союз'];
function firmName(w, ind) {
  const base = { agri: 'Агро', mining: 'Недра', energy: 'Энерго', manufacturing: 'Завод', construction: 'Строй', services: 'Лавка', finance: 'Банк', tech: 'Софт', health: 'Клиника', education: 'Школа', security: 'Щит', vice: 'Радость' }[ind] || '';
  return `${base} «${pick(w, PREFIX)}${pick(w, SUFFIX)}»`;
}

const PRESETS = {
  industrial: { gdp: 1000, shares: [0.07, 0.34, 0.12, 0.17, 0.12, 0.17, 0.005, 0.015], resource: 0 },
  agrarian: { gdp: 420, shares: [0.2, 0.15, 0.2, 0.04, 0.3, 0.03, 0.06, 0.005], resource: 0 },
  resource: { gdp: 900, shares: [0.1, 0.3, 0.1, 0.12, 0.12, 0.1, 0.12, 0.04], resource: 1 },
  trading: { gdp: 700, shares: [0.04, 0.3, 0.1, 0.22, 0.2, 0.1, 0.06, 0.01], resource: 0 },
};
// порядок как в CLASSES
const CLASS_INCOME = { destitute: 0.12, workers: 1, precariat: 0.7, specialists: 2, smallowners: 1.5, capitalists: 12, retired: 0.55, nomenklatura: 4 };

function classOf(w, shares) {
  let r = rand(w) * shares.reduce((a, b) => a + b, 0);
  for (let i = 0; i < CLASSES.length; i++) { r -= shares[i]; if (r <= 0) return CLASSES[i].id; }
  return 'workers';
}

function spawnFirm(w, ind, share) {
  const f = makeFirm(w.nextFirmId++, ind.id);
  f.name = firmName(w, ind.id);
  f.owner = ['health', 'education', 'security'].includes(ind.id) && rand(w) < 0.6 ? 'state'
    : rand(w) < 0.08 ? 'foreign' : rand(w) < 0.06 ? 'coop' : 'private';
  f.bornT = w.t;
  f.capital = ind.entryCost * (0.5 + 4 * share) * (0.7 + rand(w) * 0.6);
  f.price = 1 + rand(w) * 2;
  f.unitCost = f.price * 0.85;
  f.markup = 0.08 + rand(w) * 0.3;
  f.marketShare = share;
  f.employees = {};
  const prof = Object.keys(ind.labor);
  for (const p of prof) f.employees[p] = Math.round(ind.labor[p] * 10 * share * 5);
  f.debt = f.capital * rand(w) * 0.6;
  return f;
}

function normalizeShares(w, ind) {
  const live = w.firms.filter(f => f.alive && f.industry === ind);
  const s = live.reduce((a, f) => a + f.marketShare, 0) || 1;
  for (const f of live) f.marketShare /= s;
}

function recompute(w) {
  // рынки
  for (const ind of INDUSTRIES) {
    const live = w.firms.filter(f => f.alive && f.industry === ind.id);
    const m = (w.markets[ind.id] ||= { price: 1, demand: 1, sold: 1, shortage: 0, imports: 0, exports: 0, hhi: 0, firms: 0 });
    m.firms = live.length;
    m.hhi = live.reduce((a, f) => a + f.marketShare ** 2, 0);
    m.price = live.length ? live.reduce((a, f) => a + f.price * f.marketShare, 0) : m.price;
    if (rand(w) < 0.03) m.shortage = rand(w) * 0.3;
    else m.shortage = Math.max(0, m.shortage - 0.02);
  }
  // классы
  const byClass = {};
  for (const h of w.households) (byClass[h.classId] ||= []).push(h);
  const n = w.households.length || 1;
  w.stats.classes = CLASSES.map(c => {
    const hs = byClass[c.id] || [];
    const avg = f => hs.length ? hs.reduce((a, h) => a + f(h), 0) / hs.length : 0;
    const needsMet = {};
    for (const nd of NEEDS) needsMet[nd.id] = avg(h => h.needsMet[nd.id] ?? 0);
    return {
      id: c.id, label: c.label, count: hs.length, share: hs.length / n,
      avgIncome: avg(h => h.income), avgNetIncome: avg(h => h.netIncome),
      avgWealth: avg(h => h.cash), needsMet, health: avg(h => h.health), satisfaction: avg(h => h.satisfaction),
    };
  });
  const incomes = w.households.map(h => h.netIncome).sort((a, b) => a - b);
  const sum = incomes.reduce((a, b) => a + b, 0) || 1;
  let cum = 0, g = 0;
  incomes.forEach((v, i) => { cum += v; g += (i + 1) * v; });
  w.stats.giniIncome = clamp(incomes.length ? (2 * g) / (incomes.length * sum) - (incomes.length + 1) / incomes.length : 0, 0, 1);
  w.stats.population = n * 1000;
  w.stats.avgSatisfaction = w.households.reduce((a, h) => a + h.satisfaction, 0) / n;
  w.stats.avgHhi = INDUSTRIES.reduce((a, i) => a + (w.markets[i.id]?.hhi || 0), 0) / INDUSTRIES.length;
  w.stats.medianWage = incomes[Math.floor(incomes.length / 2)] || 0;
  w.stats.avgWage = sum / n;
}

function updateRegime(w) {
  const c = w.regime.compass;
  const x = c.x, y = c.y;
  const lab = y > 0.5 ? (x > 0 ? 'Командная автократия' : 'Рыночный авторитаризм')
    : x > 0.4 ? 'Социалистическая республика' : x < -0.4 ? 'Ночной сторож' : y < -0.2 ? 'Социал-демократия' : 'Смешанная экономика';
  w.regime.label = lab;
  w.regime.modifiers = [x > 0.2 ? 'сильное государство' : 'открытый рынок', w.stats.giniIncome > 0.45 ? 'неравенство' : 'умеренное неравенство'];
  w.regime.defacto = w.gov.corruption > 0.4 ? 'олигархия с декорациями' : null;
  const sc = [['Социал-демократия', 0.5 - Math.abs(x) * 0.3 - y * 0.2], ['Рыночный либерализм', 0.4 - x * 0.4], ['Госкапитализм', 0.3 + x * 0.3 + y * 0.1], ['Олигархия', w.gov.corruption * 1.2], ['Автократия', y * 0.8]];
  w.regime.top = sc.map(([label, score], i) => ({ id: 'arch' + i, label, score: clamp(score, 0.02, 0.95) })).sort((a, b) => b.score - a.score);
  w.regime.axes = { market: (1 - x) / 2, freedom: (1 - y) / 2 };
}

function readPath(obj, path) {
  let v = obj;
  for (const k of path.split('.')) v = v?.[k];
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}
function record(w) {
  const h = w.history;
  h.t.push(w.t);
  for (const [k, p] of Object.entries(HISTORY_KEYS)) (h.series[k] ||= []).push(readPath(w, p));
}

function pushEvent(w, type, text) {
  w.events.push({ t: w.t, type, text });
  if (w.events.length > 200) w.events.shift();
}

// ───────────── вторая волна: технологии, финансы, потоки, рынок труда (всё выдумано, экономики нет) ─────────────
const TECH_NAMES = {
  manual: ['Робот-грузчик', 'Беспилотный погрузчик'], clerical: ['Электронный делопроизводитель', 'Автосверка отчётов'],
  service: ['Касса без кассира', 'Самообслуживание 2.0'], care: ['Диагност-бот', 'Дистанционный осмотр'],
  engineer: ['Копилот-инженер', 'Автокодер'], manager: ['Юрист-нейросеть', 'Менеджер-планировщик'],
  creative: ['Генератор идей', 'Автоисследователь'], official: ['Электронный чиновник', 'Портал без очередей'],
};
const PROD_NAMES = ['Ускоритель отдачи', 'Бережливая линия', 'Умный севооборот', 'Датчик на каждый болт'];
const PRODUCT_NAMES = ['Гаджет «Ещё один»', 'Умный чайник-аналитик', 'Подписка на всё'];
const PLATFORM_NAMES = ['Платформа «Всё рядом»', 'Маркетплейс «Комиссия»', 'Приложение «Подряд»'];
const DRIFT = { manual: -0.01, clerical: -0.05, service: 0, care: 0.02, engineer: 0.04, manager: 0.02, creative: 0.03, official: 0 };

const liveOf = (w, ind) => w.firms.filter(f => f.alive && (!ind || f.industry === ind));
const biggest = (w, ind) => liveOf(w, ind).sort((a, b) => b.marketShare - a.marketShare || a.id - b.id);

function newTech(w, o) {
  const T = w.tech;
  const owner = o.owner || null;
  const t = {
    id: T.nextId++, name: o.name, kind: o.kind, industry: o.industry, profession: o.profession ?? null,
    cut: o.cut ?? 0, prodGain: o.prodGain ?? 0, ownerFirmId: owner ? owner.id : null,
    origin: o.origin || (owner ? (owner.owner === 'foreign' ? 'foreign' : 'private') : 'state'),
    bornT: w.t, patentUntil: o.open ? w.t : w.t + (w.policies.patentYears ?? 15) * 12,
    fee: o.fee ?? 0.3, adopters: [], parentId: o.parentId ?? null,
  };
  T.list.push(t); T.count = T.list.length;
  if (o.kind === 'platform' && owner) {
    owner.platform = { industry: o.industry, users: 0.05, fee: 0.2 + 0.1 * rand(w), gig: Math.round(4 + rand(w) * 14) };
  }
  return t;
}
function newResearch(w, f) {
  const inds = INDUSTRIES.filter(i => !['security', 'vice'].includes(i.id));
  const ind = pick(w, inds);
  const profs = Object.keys(ind.labor);
  const prof = pick(w, profs);
  f.research = { techKind: 'automation', industry: ind.id, profession: prof, progress: rand(w) * 0.3, spend: 2 + rand(w) * 6 };
}
function setGig(w, f, n) {
  const pool = w.households.filter(h => h.status === 'employed' && (h.profession === 'service' || h.profession === 'manual'));
  for (const h of pool.slice(0, n)) { h.status = 'gig'; h.platformId = f.id; }
}

function mockInit2(w) {
  const M = w.mockState = { bubble: 0.05, pop: 0, base: 0, ring: [], wage0: {}, flowBase: {} };
  // профессии: стартовые зарплаты
  for (const p of PROFESSIONS) {
    const hs = w.households.filter(h => h.profession === p.id && h.status === 'employed');
    M.wage0[p.id] = hs.length ? hs.reduce((a, h) => a + h.wage, 0) / hs.length : 1;
  }
  const tech = biggest(w, 'tech'), ene = biggest(w, 'energy'), man = biggest(w, 'manufacturing'), fin = biggest(w, 'finance'), svc = biggest(w, 'services');
  const T1 = tech[0], T2 = tech[1], T3 = tech[2], E1 = ene[0], M1 = man[0], F1 = fin[0];
  if (T1) T1.owner = 'private';
  if (T1 && svc.length) {                                   // платформа
    newTech(w, { owner: T1, kind: 'platform', name: PLATFORM_NAMES[0], industry: 'services', fee: 0.22 });
    setGig(w, T1, 26);
    T1.platform.gig = 26; T1.platform.users = 0.18;
  }
  if (T2) newTech(w, { owner: T2, kind: 'automation', name: 'Электронный делопроизводитель', industry: 'finance', profession: 'clerical', cut: 0.4, fee: 0.3 });
  newTech(w, { owner: null, origin: 'foreign', kind: 'automation', name: 'Робот-грузчик', industry: 'manufacturing', profession: 'manual', cut: 0.35 });
  newTech(w, { owner: null, kind: 'productivity', name: 'Умный севооборот', industry: 'agri', prodGain: 0.15, open: true });
  if (T3) newTech(w, { owner: T3, kind: 'product', name: 'Подписка на всё', industry: 'services', prodGain: 0 });
  if (T1) newTech(w, { owner: T1, kind: 'gpt', name: 'Универсальный ИИ «Оракул»', industry: '*', cut: 0.1, prodGain: 0.04, fee: 0.15 });
  for (const f of [T1, T2, T3, M1].filter(Boolean)) newResearch(w, f);
  // кольцо: энергетика → IT → промышленность → энергетика + кредиты клиентам
  const link = (a, b, share) => { if (!a || !b || a === b) return; a.stakes[b.id] = share; b.stakeHolders[a.id] = true; };
  link(E1, T1, 0.22); link(T1, M1, 0.15); link(M1, E1, 0.09); link(T1, T3, 0.35); link(F1, T2, 0.12);
  if (E1 && T1) E1.vendorLoans[T1.id] = E1.capital * 0.4;
  if (T1 && T2) T1.vendorLoans[T2.id] = T1.capital * 0.25;
  M.ring = [E1, T1, M1, T2].filter(Boolean).map(f => f.id);
}

function addLink(w) {
  const live = liveOf(w).filter(f => f.owner !== 'state');
  if (live.length < 2) return;
  const a = live[Math.floor(rand(w) * live.length)], b = live[Math.floor(rand(w) * live.length)];
  if (a === b || a.stakes[b.id]) return;
  if (rand(w) < 0.7) { a.stakes[b.id] = Math.round((0.05 + rand(w) * 0.2) * 100) / 100; b.stakeHolders[a.id] = true; }
  else a.vendorLoans[b.id] = a.capital * (0.05 + rand(w) * 0.2);
}

function mockLabor(w) {
  const M = w.mockState;
  const by = {};
  for (const p of PROFESSIONS) by[p.id] = { employed: 0, unemployed: 0, avgWage: 0 };
  for (const h of w.households) {
    const r = by[h.profession];
    if (!r) continue;
    if (h.status === 'employed' || h.status === 'gig') { r.employed++; r.avgWage += h.wage; }
    else if (h.status === 'unemployed') r.unemployed++;
  }
  for (const p of PROFESSIONS) {
    const r = by[p.id];
    if (r.employed) r.avgWage /= r.employed;
    const w0 = M.wage0[p.id] || 1;
    w.labor[p.id] = { wage: r.avgWage, w0, rel: r.avgWage / w0, employed: r.employed, unemployed: r.unemployed, vacancies: Math.round(r.employed * 0.02), u: r.employed + r.unemployed ? r.unemployed / (r.employed + r.unemployed) : 0 };
  }
  w.stats.employmentByProfession = by;
}

function mockFlows(w) {
  const g = w.stats.gdp, FL = w.flows;
  const F = {
    wages: 0.52, consumption: 0.62, b2b: 0.9, dividends: 0.09, investment: 0.2,
    tax_income: 0.07, tax_payroll: 0.06, tax_corp: 0.03, tax_vat: 0.05, tax_excise: 0.01, tax_inheritance: 0.002, tax_dividend: 0.008, tax_rent: 0.01, tariffs: 0.005,
    transfers_pension: 0.045, transfers_unemployment: 0.008, transfers_poverty: 0.01, gov_wages: 0.09, gov_procurement: 0.07, subsidies: 0.01, corruption: 0.006,
    imports: 0.2, exports: 0.21, capital_flight: 0.004, loans: 0.06, repayments: 0.055, interest: 0.012, emission: 0.003, gov_borrowing: 0.012, gov_interest: 0.01,
    acquisitions: 0.004, research: 0.008, tech_licenses: 0.006, platform_fees: 0.005,
  };
  const bub = w.mockState?.bubble ?? 0;
  F.equity_purchases = 0.02 * (0.3 + bub); F.vendor_loans = 0.006 * (0.3 + bub); F.vendor_repayments = 0.004 * (0.3 + bub);
  if (w.mockState?.pop > 0) F.margin_calls = 0.02;
  for (const k of Object.keys(FL)) FL[k] = F[k] ? g * F[k] * (1 + 0.04 * randn(w)) : 0;
  const gov = w.gov, rev = {}, sp = {};
  let r = 0, s = 0;
  for (const k of Object.keys(F)) {
    if (k.startsWith('tax_') || k === 'tariffs') { rev[k] = FL[k]; r += FL[k]; }
    if (k.startsWith('transfers_') || ['gov_wages', 'gov_procurement', 'subsidies', 'corruption', 'gov_interest'].includes(k)) { sp[k] = FL[k]; s += FL[k]; }
  }
  gov.revenueByKind = rev; gov.spendingByKind = sp;
  gov.revenue = r; gov.spending = s; gov.balance = r - s;
}

function mockStep2(w) {
  const M = w.mockState; if (!M) return;
  const alive = new Set(w.firms.filter(f => f.alive).map(f => f.id));
  for (const f of w.firms) {
    for (const k of Object.keys(f.stakes)) if (!alive.has(+k)) delete f.stakes[k];
    for (const k of Object.keys(f.stakeHolders)) if (!alive.has(+k)) delete f.stakeHolders[k];
    for (const k of Object.keys(f.vendorLoans)) if (!alive.has(+k)) delete f.vendorLoans[k];
    if (!f.alive) { f.platform = null; f.research = null; }
  }
  const T = w.tech;
  // исследования → новые технологии
  let spend = 0;
  for (const f of liveOf(w)) {
    if (!f.research || T.list.length >= 24) continue;
    spend += f.research.spend;
    f.research.progress += 0.012 + 0.03 * rand(w) * (w.assumptions?.researchLuck ?? 1);
    if (f.research.progress >= 1) {
      const r = f.research, profL = TECH_NAMES[r.profession] || ['Автоматика'];
      const kindRoll = rand(w);
      const kind = f.industry === 'tech' && kindRoll < 0.12 ? 'platform' : kindRoll < 0.25 ? 'productivity' : kindRoll < 0.35 ? 'product' : 'automation';
      const nm = kind === 'automation' ? pick(w, profL) : kind === 'productivity' ? pick(w, PROD_NAMES) : kind === 'product' ? pick(w, PRODUCT_NAMES) : pick(w, PLATFORM_NAMES);
      const alreadyPlatform = !!f.platform;
      newTech(w, { owner: f, kind: kind === 'platform' && alreadyPlatform ? 'product' : kind, name: nm, industry: r.industry, profession: kind === 'automation' ? r.profession : null,
        cut: 0.15 + rand(w) * 0.45, prodGain: 0.05 + rand(w) * 0.15, fee: 0.2 + rand(w) * 0.2 });
      pushEvent(w, 'tech', `«${f.name}» изобрела: ${nm}. Конкуренты уже изучают, как это не покупать.`);
      newResearch(w, f);
    }
  }
  if (rand(w) < 0.03 && T.list.length < 16) {              // госнаука
    newTech(w, { owner: null, kind: 'productivity', name: pick(w, PROD_NAMES), industry: pick(w, INDUSTRIES).id, prodGain: 0.1, open: rand(w) < 0.5 });
  }
  T.researchSpend = spend;
  // внедрение
  const dispNow = {};
  for (const p of PROFESSIONS) dispNow[p.id] = 0;
  for (const t of T.list) {
    const pool = liveOf(w, t.industry === '*' ? null : t.industry).filter(f => f.id !== t.ownerFirmId && !t.adopters.includes(f.id));
    for (const f of pool) {
      const patent = w.t < t.patentUntil ? 0.6 : 1;
      if (rand(w) < (0.01 + 0.12 * Math.sqrt(f.marketShare)) * patent) {
        t.adopters.push(f.id);
        (f.tech.licenses ||= []).push(t.id);
        if (t.kind === 'automation' || t.kind === 'gpt') {
          if (t.profession) {
            f.tech.labor[t.profession] = Math.max(0.25, (f.tech.labor[t.profession] ?? 1) * (1 - t.cut));
            const gone = (f.employees[t.profession] || 0) * t.cut;
            dispNow[t.profession] += gone; T.displacedTotal += gone;
          }
        }
        if (t.prodGain) f.tech.prod *= 1 + t.prodGain * 0.5;
        f.tech.fees += t.fee * 0.5;
      }
    }
    t.adopters = t.adopters.filter(id => alive.has(id));
  }
  for (const f of liveOf(w)) f.tech.fees *= 0.9;
  for (const p of PROFESSIONS) {
    const prev = T.byProfession[p.id] || { displaced: 0, targeted: 0, retraining: 0 };
    const displaced = prev.displaced * (1 - 1 / 12) + dispNow[p.id];
    T.byProfession[p.id] = {
      displaced,
      targeted: liveOf(w).filter(f => f.research?.profession === p.id).length,
      retraining: Math.round(displaced * 0.4),
    };
  }
  // платформа: рост числа подрядчиков
  for (const f of liveOf(w)) if (f.platform) { f.platform.users = clamp(f.platform.users + 0.003 + 0.004 * randn(w), 0.01, 0.9); f.platform.gig = Math.max(0, Math.round(f.platform.gig * (1 + 0.01 * randn(w)))); }
  // рынок труда
  for (const h of w.households) {
    if (h.status === 'employed' || h.status === 'gig') h.wage *= Math.exp(DRIFT[h.profession] / 12 + 0.004 * randn(w));
  }
  mockLabor(w);

  // финансы
  const F = w.finance;
  if (M.pop > 0) { M.pop--; M.bubble = Math.max(0, M.bubble - 0.07); }
  else {
    M.bubble += 0.01 + 0.008 * rand(w);
    if (M.bubble > 0.95 || (M.bubble > 0.55 && rand(w) < 0.025)) {
      M.pop = 12; F.crashes++;
      pushEvent(w, 'crash', 'Пузырь лопнул. Все обещали, что в этот раз всё иначе.');
    }
  }
  F.sentiment = clamp(M.pop > 0 ? -0.5 - 0.3 * rand(w) : M.bubble * 1.5 - 0.35 + 0.05 * randn(w), -1, 1);
  const ring = new Set(M.ring);
  let total = 0, profit = 0, rev = 0, circ = 0;
  for (const f of liveOf(w)) {
    f.revenue = f.capital * 0.13 * (0.9 + 0.2 * rand(w));
    const fund = f.capital * 1.2 + Math.max(0, f.profit) * 10;
    const amp = (ring.has(f.id) ? 1.9 : 0.35) * (w.assumptions?.extrapolation ?? 1);
    const target = fund * (1 + amp * M.bubble) * (M.pop > 0 ? 0.65 : 1);
    f.fundamental = fund;
    f.value = f.value > 0 ? f.value * 0.8 + target * 0.2 : target;
    f.valueHist.push(f.value); if (f.valueHist.length > 24) f.valueHist.shift();
    f.circularRevenue = ring.has(f.id) ? f.revenue * (0.25 + 0.6 * M.bubble) * (M.pop > 0 ? 0.4 : 1) : 0;
    total += f.value; profit += Math.max(0, f.profit) * 12; rev += f.revenue; circ += f.circularRevenue;
  }
  if (!M.base) M.base = total || 1;
  F.totalValue = total; F.index = 100 * total / M.base;
  F.indexHist.push(F.index); if (F.indexHist.length > 36) F.indexHist.shift();
  F.pe = total / Math.max(1, profit);
  F.circularShare = rev > 0 ? circ / rev : 0;
  F.marginDebt = total * 0.1 * (0.4 + M.bubble) * (M.pop > 0 ? 0.6 : 1);
  const top = liveOf(w).sort((a, b) => b.value - a.value).slice(0, 6);
  F.pensionFund.stakes = Object.fromEntries(top.map(f => [f.id, 0.03]));
  F.pensionFund.cash = 20;
  F.pensionFund.value = top.reduce((a, f) => a + f.value * 0.03, 0) + 20;
  if (M.bubble > 0.3 && !M.pop && rand(w) < 0.05) addLink(w);
  w.tech.count = w.tech.list.length;
}

export function newGame(opts = {}) {
  const w = createWorld(opts);
  const P = PRESETS[w.preset] || PRESETS.industrial;
  for (const ind of INDUSTRIES) {
    const k = ind.initialFirms;
    const ws = Array.from({ length: k }, () => 0.2 + rand(w) ** 2);
    const s = ws.reduce((a, b) => a + b, 0);
    ws.forEach(x => w.firms.push(spawnFirm(w, ind, x / s)));
  }
  for (let i = 0; i < 360; i++) {
    const h = makeHousehold(w.nextHouseholdId++);
    h.classId = classOf(w, P.shares);
    h.age = h.classId === 'retired' ? 68 + Math.floor(rand(w) * 15) : 22 + Math.floor(rand(w) * 40);
    h.profession = pick(w, PROFESSIONS).id;
    h.status = h.classId === 'retired' ? 'retired' : h.classId === 'destitute' ? 'unemployed' : 'employed';
    const base = (P.gdp / 10) * CLASS_INCOME[h.classId] * Math.exp(0.35 * randn(w));
    h.income = base * 1.2; h.netIncome = base; h.wage = base;
    h.cash = base * (h.classId === 'capitalists' ? 80 : 4) * (0.5 + rand(w));
    h.health = clamp(0.7 + 0.1 * randn(w), 0.2, 1);
    h.satisfaction = clamp(0.35 + 0.2 * Math.log10(1 + CLASS_INCOME[h.classId] * 3) + 0.08 * randn(w), 0.05, 0.95);
    for (const nd of NEEDS) {
      const prio = NEEDS.indexOf(nd);
      h.needsMet[nd.id] = clamp(0.35 + 0.5 * Math.log10(1 + CLASS_INCOME[h.classId] * 6) - prio * 0.015 + 0.1 * randn(w) - (nd.basic ? 0 : 0.1), 0, 1);
    }
    w.households.push(h);
  }
  Object.assign(w.stats, {
    gdp: P.gdp, gdpReal: P.gdp, gdpGrowth: 0.02, cpi: 1, inflation: 0.04, unemployment: 0.07,
    povertyRate: 0.15, giniWealth: 0.6, top1WealthShare: 0.2, tradeBalance: 0,
  });
  Object.assign(w.gov, { debt: P.gdp * 6, corruption: 0.2, shadowShare: 0.12, balance: 0 });
  w.abroad.fx = 1;
  w.moneySupply = P.gdp * 3;
  for (const h of w.households) if (h.status !== 'employed') h.wage = 0;
  recompute(w);
  mockInit2(w);
  mockFlows(w);
  mockStep2(w);
  w.regime.compass = { x: 0.1, y: -0.2 };
  updateRegime(w);
  pushEvent(w, 'info', 'Страна основана. Законодатель, всё в ваших руках. Удачи: она пригодится.');
  record(w);
  return w;
}

const FLAVOR = [
  'Профсоюз требует больше, чем фирма зарабатывает.',
  'Чиновники ушли в отпуск, страна не заметила.',
  'Инфляция объяснена рынку. Рынок не поверил.',
  'Открылась ещё одна кофейня, закрылась ещё одна.',
];

export function step(w) {
  w.t += 1;
  const s = w.stats, g = w.gov;
  // фирмы
  for (const f of w.firms) {
    if (!f.alive) continue;
    f.marketShare *= Math.exp(0.05 * randn(w));
    f.price *= Math.exp(0.01 * randn(w));
    f.markup = clamp(f.markup + 0.01 * randn(w), 0, 1.5);
    f.profit = f.capital * (0.02 + 0.05 * randn(w));
    f.capital = Math.max(1, f.capital * (1 + 0.01 * randn(w)));
  }
  for (const ind of INDUSTRIES) {
    const live = w.firms.filter(f => f.alive && f.industry === ind.id);
    if (live.length > 2 && rand(w) < 0.012) {          // поглощение
      const a = live[Math.floor(rand(w) * live.length)];
      const b = live[Math.floor(rand(w) * live.length)];
      if (a !== b) {
        b.alive = false; b.diedT = w.t; a.marketShare += b.marketShare; a.acquired.push(b.name);
        pushEvent(w, 'acquisition', `«${a.name}» поглотила «${b.name}», доля рынка ${Math.round(a.marketShare * 100)}%`);
      }
    } else if (live.length > 3 && rand(w) < 0.006) {   // банкротство
      const b = live[Math.floor(rand(w) * live.length)];
      b.alive = false; b.diedT = w.t;
      pushEvent(w, 'bankruptcy', `Банкротство: «${b.name}». Сотрудникам желаем успехов.`);
    } else if (live.length < 14 && rand(w) < 0.008) {  // новая фирма
      const f = spawnFirm(w, ind, 0.05);
      w.firms.push(f);
      pushEvent(w, 'entry', `Новая фирма «${f.name}» вышла на рынок: ${ind.label.toLowerCase()}.`);
    }
    normalizeShares(w, ind.id);
  }
  w.firms = w.firms.filter(f => f.alive || w.t - (f.diedT ?? w.t) < 6);
  // домохозяйства
  for (const h of w.households) {
    h.netIncome = Math.max(0, h.netIncome * Math.exp(0.03 * randn(w)));
    h.income = h.netIncome * 1.25;
    h.cash = Math.max(0, h.cash * (1 + 0.01 * randn(w)) + h.netIncome * 0.02);
    h.health = clamp(h.health + 0.01 * randn(w), 0.1, 1);
    h.satisfaction = clamp(h.satisfaction + 0.015 * randn(w), 0.02, 0.98);
    for (const nd of NEEDS) h.needsMet[nd.id] = clamp((h.needsMet[nd.id] ?? 0.5) + 0.02 * randn(w), 0, 1);
  }
  // макро
  s.gdpGrowth = clamp(s.gdpGrowth * 0.95 + 0.004 * randn(w), -0.12, 0.12);
  s.gdpReal *= 1 + s.gdpGrowth / 12 + 0.002 * randn(w);
  s.inflation = clamp(s.inflation * 0.97 + 0.003 * randn(w) + (w.policies.cbRate - 0.05) * -0.01, -0.03, 0.6);
  s.cpi *= 1 + s.inflation / 12;
  s.gdp = s.gdpReal * s.cpi;
  s.unemployment = clamp(s.unemployment + 0.003 * randn(w) - s.gdpGrowth * 0.01, 0.01, 0.5);
  s.giniWealth = clamp(s.giniWealth + 0.002 * randn(w), 0.2, 0.95);
  s.top1WealthShare = clamp(s.top1WealthShare + 0.002 * randn(w), 0.02, 0.8);
  s.povertyRate = clamp(s.povertyRate + 0.004 * randn(w), 0, 0.8);
  s.tradeBalance += 0.5 * randn(w);
  mockFlows(w);
  g.debt = Math.max(0, g.debt - g.balance);
  g.corruption = clamp(g.corruption + 0.004 * randn(w), 0, 1);
  g.shadowShare = clamp(g.shadowShare + 0.004 * randn(w), 0, 0.8);
  w.abroad.fx = Math.max(0.05, w.abroad.fx * Math.exp(0.01 * randn(w)));
  w.moneySupply *= 1 + 0.003 + 0.002 * randn(w);
  const c = w.regime.compass;
  c.x = clamp(c.x + 0.02 * randn(w), -1, 1);
  c.y = clamp(c.y + 0.02 * randn(w), -1, 1);
  recompute(w);
  mockStep2(w);
  updateRegime(w);
  if (rand(w) < 0.05) pushEvent(w, 'flavor', pick(w, FLAVOR));
  if (rand(w) < 0.01) {
    const m = INDUSTRIES[Math.floor(rand(w) * INDUSTRIES.length)];
    pushEvent(w, 'shortage', `Дефицит: ${m.label.toLowerCase()}. Очереди растут.`);
  }
  record(w);
  return w;
}

export function snapshot(w) { return structuredClone(w); }
