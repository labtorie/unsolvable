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
  recompute(w);
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
  g.balance = s.gdp * (-0.01 + 0.01 * randn(w));
  g.debt = Math.max(0, g.debt - g.balance);
  g.corruption = clamp(g.corruption + 0.004 * randn(w), 0, 1);
  g.shadowShare = clamp(g.shadowShare + 0.004 * randn(w), 0, 0.8);
  w.abroad.fx = Math.max(0.05, w.abroad.fx * Math.exp(0.01 * randn(w)));
  w.moneySupply *= 1 + 0.003 + 0.002 * randn(w);
  const c = w.regime.compass;
  c.x = clamp(c.x + 0.02 * randn(w), -1, 1);
  c.y = clamp(c.y + 0.02 * randn(w), -1, 1);
  recompute(w);
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
