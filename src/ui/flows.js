// Вкладка «Потоки»: куда текли деньги за прошлый месяц. Колонки «Домохозяйства → Фирмы → Государство → Заграница/Банк»,
// ширина ленты пропорциональна сумме из world.flows. Потоки внутри сектора фирм (закупки, вложения, лицензии) — отдельной полосой.
import { el, svg, fmtCompact, fmtPct, fmtNum, num, makeTip } from './util.js';

export const KIND_LABELS = {
  wages: 'Зарплаты', consumption: 'Потребление', b2b: 'Закупки между фирмами', dividends: 'Дивиденды', investment: 'Инвестиции в мощности',
  tax_income: 'Подоходный налог', tax_payroll: 'Соцвзносы', tax_corp: 'Налог на прибыль', tax_vat: 'НДС', tax_excise: 'Акцизы', tax_wealth: 'Налог на богатство',
  tax_inheritance: 'Налог на наследство', tax_dividend: 'Налог на дивиденды', tax_rent: 'Рента с ресурсов', tax_carbon: 'Экологический налог', tariffs: 'Пошлины',
  transfers_pension: 'Пенсии', transfers_unemployment: 'Пособия по безработице', transfers_ubi: 'Безусловный базовый доход', transfers_poverty: 'Доплаты бедным',
  gov_wages: 'Зарплаты госслужащих', gov_procurement: 'Госзакупки', subsidies: 'Субсидии', corruption: 'Коррупция (оседает у чиновников)',
  imports: 'Импорт', exports: 'Экспорт', capital_flight: 'Вывоз капитала', loans: 'Новые кредиты', repayments: 'Погашение кредитов', interest: 'Проценты по кредитам',
  emission: 'Эмиссия', gov_borrowing: 'Госзаймы', gov_interest: 'Проценты по госдолгу', acquisitions: 'Выкуп и поглощения', black_market: 'Чёрный рынок', cb_stimulus: 'Стимулы ЦБ',
  tech_licenses: 'Лицензии на технологии', platform_fees: 'Комиссии платформ', robot_tax: 'Налог на роботов', automation_subsidy: 'Субсидии на внедрение технологий',
  retraining: 'Переобучение', research: 'Исследования', equity_purchases: 'Покупка долей', vendor_loans: 'Кредиты клиентам', vendor_repayments: 'Погашение кредитов клиентов',
  margin_calls: 'Принудительные продажи под залог', bailouts: 'Спасение банков и фирм', ftt: 'Налог на финансовые сделки',
  border_in: 'Деньги из-за границы (зеркало клиринга: капитал, проценты, переселенцы)', border_out: 'Деньги за границу (зеркало клиринга)',
};

const NODES = [
  { id: 'hh', label: 'Домохозяйства', col: 0 },
  { id: 'firms', label: 'Фирмы', col: 1 },
  { id: 'gov', label: 'Государство', col: 2 },
  { id: 'abroad', label: 'Заграница', col: 3 },
  { id: 'bank', label: 'Банк и ЦБ', col: 3 },
];
const C = { pay: '#6cb57a', trade: '#4aa3df', tax: '#d9a441', gov: '#cf7a5a', fin: '#9b7bd1', world: '#8d98a6' };
// Группы потоков. kinds суммируются; в схему попадают только потоки между секторами.
export const GROUPS = [
  { id: 'wages', label: 'Зарплаты', from: 'firms', to: 'hh', color: C.pay, kinds: ['wages'] },
  { id: 'consumption', label: 'Потребление', from: 'hh', to: 'firms', color: C.trade, kinds: ['consumption', 'black_market'] },
  { id: 'dividends', label: 'Дивиденды и выкуп долей', from: 'firms', to: 'hh', color: C.pay, kinds: ['dividends', 'acquisitions'] },
  { id: 'taxHh', label: 'Налоги с домохозяйств', from: 'hh', to: 'gov', color: C.tax, kinds: ['tax_income', 'tax_vat', 'tax_excise', 'tax_wealth', 'tax_inheritance', 'tax_dividend'] },
  { id: 'taxFirm', label: 'Налоги с фирм', from: 'firms', to: 'gov', color: C.tax, kinds: ['tax_payroll', 'tax_corp', 'tax_rent', 'tax_carbon', 'tariffs', 'robot_tax', 'ftt'] },
  { id: 'transfers', label: 'Трансферты и переобучение', from: 'gov', to: 'hh', color: C.gov, kinds: ['transfers_pension', 'transfers_unemployment', 'transfers_ubi', 'transfers_poverty', 'retraining'] },
  { id: 'govPay', label: 'Госзарплаты и коррупция', from: 'gov', to: 'hh', color: C.gov, kinds: ['gov_wages', 'corruption'] },
  { id: 'govBuy', label: 'Госзакупки, субсидии, спасение', from: 'gov', to: 'firms', color: C.gov, kinds: ['gov_procurement', 'subsidies', 'automation_subsidy', 'bailouts'] },
  { id: 'imports', label: 'Импорт', from: 'firms', to: 'abroad', color: C.world, kinds: ['imports'] },
  { id: 'exports', label: 'Экспорт', from: 'abroad', to: 'firms', color: C.world, kinds: ['exports'] },
  { id: 'flight', label: 'Вывоз капитала', from: 'hh', to: 'abroad', color: C.world, kinds: ['capital_flight'] },
  { id: 'loans', label: 'Новые кредиты', from: 'bank', to: 'firms', color: C.fin, kinds: ['loans'] },
  { id: 'repay', label: 'Погашения и проценты', from: 'firms', to: 'bank', color: C.fin, kinds: ['repayments', 'interest'] },
  { id: 'emission', label: 'Эмиссия и госзаймы', from: 'bank', to: 'gov', color: C.fin, kinds: ['emission', 'gov_borrowing'] },
  { id: 'govInt', label: 'Проценты по госдолгу', from: 'gov', to: 'bank', color: C.fin, kinds: ['gov_interest'] },
  { id: 'borderIn', label: 'Из-за границы по клирингу с соседями', from: 'abroad', to: 'firms', color: C.world, kinds: ['border_in'] },
  { id: 'borderOut', label: 'За границу по клирингу с соседями', from: 'firms', to: 'abroad', color: C.world, kinds: ['border_out'] },
  { id: 'cbStim', label: 'Стимулы ЦБ', from: 'bank', to: 'hh', color: C.fin, kinds: ['cb_stimulus'] },
];
// Потоки внутри сектора фирм
export const INNER = [
  { id: 'b2b', label: 'Закупки между фирмами', kinds: ['b2b'] },
  { id: 'invest', label: 'Инвестиции в мощности', kinds: ['investment'] },
  { id: 'lic', label: 'Лицензии и комиссии платформ', kinds: ['tech_licenses', 'platform_fees'] },
  { id: 'res', label: 'Исследования', kinds: ['research'] },
  { id: 'eq', label: 'Покупка долей и кредиты клиентам', kinds: ['equity_purchases', 'vendor_loans', 'vendor_repayments'] },
  { id: 'margin', label: 'Принудительные продажи под залог', kinds: ['margin_calls'] },
];
const KNOWN = new Set([...GROUPS, ...INNER].flatMap(g => g.kinds));

const W = 900, H = 430, NW = 14, TOP = 26, BOT = 26, GAPN = 26;
const COLX = [10, 290, 580, 876 - NW];
const sumOf = (obj, kinds) => kinds.reduce((a, k) => a + Math.max(0, num(obj?.[k])), 0);

export function createFlows(root) {
  const host = el('div', { class: 'flow-host' });
  const canvas = svg('svg', { class: 'flow-canvas', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'xMidYMid meet' });
  host.append(canvas);
  const tip = makeTip(host);
  const innerBox = el('div', { class: 'flow-inner' });
  const tblBody = el('tbody');
  const budget = el('div', { class: 'flow-budget' });
  const note = el('div', { class: 'dim small' });
  root.append(
    el('div', { class: 'sect-head' }, el('h2', { text: 'Потоки' }), note),
    host, innerBox,
    el('div', { class: 'two-col' },
      el('div', {}, el('h2', { class: 'sub-h', text: 'Крупнейшие потоки' }),
        el('table', { class: 'tbl compact' }, el('thead', {}, el('tr', {}, el('th', { text: 'Поток' }), el('th', { text: 'Откуда → куда' }), el('th', { class: 'r', text: 'Сумма' }), el('th', { class: 'r', text: '% ВВП' }))), tblBody)),
      el('div', {}, el('h2', { class: 'sub-h', text: 'Бюджет: доходы и расходы' }), budget)));
  let data = [], gdp = 0, sig = '';
  tip.bind(canvas, t => t.getAttribute?.('data-g') ?? t.parentNode?.getAttribute?.('data-g') ?? null, key => {
    const g = data.find(x => x.id === key);
    if (!g) return null;
    const parts = g.kinds.map(k => [k, num(g.flows?.[k])]).filter(([, v]) => v > 0).map(([k, v]) => `${KIND_LABELS[k] || k}: ${fmtCompact(v)}`);
    return [`${g.label}: ${fmtCompact(g.total)} в мес.`, `${nodeLabel(g.from)} → ${nodeLabel(g.to)}`, gdp > 0 ? `${fmtPct(g.total / gdp, 1)} месячного ВВП` : '', ...parts].filter(Boolean);
  });
  const nodeLabel = id => NODES.find(n => n.id === id)?.label || id;

  function drawBudget(world) {
    const part = (title, obj) => {
      const rows = Object.entries(obj || {}).map(([k, v]) => [k, num(v)]).filter(([, v]) => Math.abs(v) > 1e-9).sort((a, b) => b[1] - a[1]);
      const mx = Math.max(1e-9, ...rows.map(r => r[1]));
      const total = rows.reduce((a, r) => a + r[1], 0);
      return el('div', { class: 'bud' }, el('div', { class: 'bud-h' }, el('b', { text: title }), el('span', { class: 'dim small', text: fmtCompact(total) + ' в мес.' })),
        ...(rows.length ? rows.map(([k, v]) => el('div', { class: 'bud-row', title: KIND_LABELS[k] || k },
          el('span', { class: 'bud-k', text: KIND_LABELS[k] || k }), el('span', { class: 'bud-bar' }, el('i', { style: { width: Math.max(1, v / mx * 100) + '%' } })), el('span', { class: 'bud-v', text: fmtCompact(v) })))
          : [el('div', { class: 'dim small', text: 'нет данных за прошлый месяц' })]));
    };
    budget.replaceChildren(part('Доходы', world.gov?.revenueByKind), part('Расходы', world.gov?.spendingByKind),
      el('div', { class: 'dim small', text: `Баланс за месяц: ${fmtCompact(world.gov?.balance)}` }));
  }

  return function render(world) {
    const s = world.seed + ':' + world.t;
    if (s === sig) return;
    sig = s;
    const fl = world.flows || {};
    gdp = num(world.stats?.gdp);
    data = GROUPS.map(g => ({ ...g, total: sumOf(fl, g.kinds), flows: fl })).filter(g => g.total > 0);
    const inner = INNER.map(g => ({ ...g, total: sumOf(fl, g.kinds) })).filter(g => g.total > 0);
    const other = Object.entries(fl).filter(([k, v]) => !KNOWN.has(k) && num(v) > 0);
    if (other.length) inner.push({ id: 'other', label: 'Прочее', total: other.reduce((a, [, v]) => a + num(v), 0), kinds: other.map(o => o[0]) });
    note.textContent = data.length ? 'деньги за прошлый месяц; ширина ленты — сумма. Наведите курсор на ленту, чтобы увидеть состав.' : 'Пока потоков нет: первый месяц ещё не прошёл.';

    // размеры узлов
    const sides = {};
    for (const n of NODES) sides[n.id] = { L: [], R: [] };
    const idx = Object.fromEntries(NODES.map((n, i) => [n.id, i]));
    const col = Object.fromEntries(NODES.map(n => [n.id, n.col]));
    for (const g of data) {
      const fwd = col[g.from] <= col[g.to];
      sides[g.from][fwd ? 'R' : 'L'].push({ g, role: 'out' });
      sides[g.to][fwd ? 'L' : 'R'].push({ g, role: 'in' });
    }
    for (const n of NODES) for (const sd of ['L', 'R']) sides[n.id][sd].sort((a, b) => idx[a.role === 'out' ? a.g.to : a.g.from] - idx[b.role === 'out' ? b.g.to : b.g.from]);
    const raw = {};
    for (const n of NODES) raw[n.id] = Math.max(sides[n.id].L.reduce((a, x) => a + x.g.total, 0), sides[n.id].R.reduce((a, x) => a + x.g.total, 0));
    const avail = H - TOP - BOT;
    const col3 = raw.abroad + raw.bank;
    const gap3 = raw.abroad > 0 && raw.bank > 0 ? GAPN : 0;
    const cands = [[raw.hh, avail], [raw.firms, avail], [raw.gov, avail], [col3, avail - gap3]].filter(([r]) => r > 0).map(([r, a]) => a / r);
    const k = cands.length ? Math.min(...cands) : 1;
    const place = {};
    for (const c of [0, 1, 2, 3]) {
      const here = NODES.filter(n => n.col === c && raw[n.id] > 0);
      const total = here.reduce((a, n) => a + raw[n.id] * k, 0) + GAPN * Math.max(0, here.length - 1);
      let y = TOP + (avail - total) / 2;
      for (const n of here) { place[n.id] = { x: COLX[c], y, h: raw[n.id] * k }; y += raw[n.id] * k + GAPN; }
    }
    // ленты
    const slots = {};
    for (const n of NODES) {
      if (!place[n.id]) continue;
      for (const sd of ['L', 'R']) {
        let y = place[n.id].y;
        for (const it of sides[n.id][sd]) { slots[n.id + sd + it.g.id + it.role] = [y, y + it.g.total * k]; y += it.g.total * k; }
      }
    }
    const nodesG = [], ribbons = [];
    for (const g of data) {
      const a = place[g.from], b = place[g.to];
      if (!a || !b) continue;
      const fwd = col[g.from] <= col[g.to];
      const [y1a, y1b] = slots[g.from + (fwd ? 'R' : 'L') + g.id + 'out'], [y2a, y2b] = slots[g.to + (fwd ? 'L' : 'R') + g.id + 'in'];
      const x1 = fwd ? a.x + NW : a.x, x2 = fwd ? b.x : b.x + NW, xm = (x1 + x2) / 2;
      const d = `M${x1},${y1a} C${xm},${y1a} ${xm},${y2a} ${x2},${y2a} L${x2},${y2b} C${xm},${y2b} ${xm},${y1b} ${x1},${y1b} Z`;
      ribbons.push(svg('path', { d, fill: g.color, class: 'ribbon', 'data-g': g.id }));
    }
    for (const n of NODES) {
      const p = place[n.id]; if (!p) continue;
      const anchor = n.col === 0 ? 'start' : n.col === 3 ? 'end' : 'middle';
      const tx = n.col === 0 ? p.x : n.col === 3 ? p.x + NW : p.x + NW / 2;
      const inSum = sides[n.id].L.concat(sides[n.id].R).filter(x => x.role === 'in').reduce((a, x) => a + x.g.total, 0);
      const outSum = sides[n.id].L.concat(sides[n.id].R).filter(x => x.role === 'out').reduce((a, x) => a + x.g.total, 0);
      nodesG.push(svg('rect', { x: p.x, y: p.y, width: NW, height: Math.max(2, p.h), class: 'flow-node' }),
        svg('text', { x: tx, y: p.y - 14, class: 'flow-label', 'text-anchor': anchor, text: n.label }),
        svg('text', { x: tx, y: p.y - 3, class: 'flow-sub', 'text-anchor': anchor, text: `приходит ${fmtCompact(inSum)} · уходит ${fmtCompact(outSum)}` }));
    }
    canvas.replaceChildren(...ribbons, ...nodesG);
    tip.refresh();

    innerBox.replaceChildren(
      el('div', { class: 'bud-h' }, el('b', { text: 'Внутри сектора фирм' }), el('span', { class: 'dim small', text: 'деньги, которые не покидают фирмы как класс, поэтому на схеме их нет' })),
      ...(inner.length ? [el('div', { class: 'inner-grid' }, ...inner.map(g => el('div', { class: 'inner-card', title: g.kinds.map(k => KIND_LABELS[k] || k).join(', ') },
        el('div', { class: 'dim small', text: g.label }), el('b', { text: fmtCompact(g.total) }), gdp > 0 ? el('span', { class: 'dim small', text: ' ' + fmtPct(g.total / gdp, 1) + ' ВВП' }) : null)))]
        : [el('div', { class: 'dim small', text: 'пока ничего' })]));

    const top = data.slice().sort((a, b) => b.total - a.total).slice(0, 12);
    tblBody.replaceChildren(...top.map(g => el('tr', {},
      el('td', {}, el('i', { class: 'dot', style: { background: g.color } }), g.label),
      el('td', { class: 'dim', text: `${nodeLabel(g.from)} → ${nodeLabel(g.to)}` }),
      el('td', { class: 'r', text: fmtCompact(g.total) }),
      el('td', { class: 'r dim', text: gdp > 0 ? fmtNum(g.total / gdp * 100, 1) : '—' }))));
    drawBudget(world);
  };
}
