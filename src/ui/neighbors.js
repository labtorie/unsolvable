// Вкладка «Соседи» (GDD §3.5): строй, «улица» классов рядом с нашей, сравнение показателей, торговля, люди, капитал,
// ответные меры соседей и рычаги торговли по странам. Читает world.neighbors и world.xb, ядро не загружает.
import { CLASSES } from '../sim/schema.js';
import { neighborSummary, setTradeWith } from '../sim/neighbors-info.js';
import { el, setText, fmtPct, fmtNum, fmtCompact, num, clamp, CLASS_COLORS, IND_LABELS } from './util.js';
import { app } from './state.js';

const ORDER = id => { const i = CLASSES.findIndex(c => c.id === id); return i < 0 ? 99 : i; };
const moodColor = s => `hsl(${(clamp(s, 0, 1) * 120).toFixed(0)} 45% 52%)`;
const FIG_MAX = 64;

/** «Улица» в миниатюре: ширина — доля класса, рост — чистый доход в мировых единицах (общая шкала для сравнения). */
function miniStreet(w, maxInc) {
  const fx = Math.max(1e-9, num(w.abroad?.fx, 1));
  const classes = (w.stats?.classes || []).filter(c => num(c.count) > 0).slice().sort((a, b) => ORDER(a.id) - ORDER(b.id));
  const row = el('div', { class: 'nb-street' });
  for (const c of classes) {
    const inc = num(c.avgNetIncome) / fx;
    const h = 6 + FIG_MAX * Math.sqrt(clamp(inc / maxInc, 0, 1));
    const color = CLASS_COLORS[c.id] || '#999';
    const fig = el('div', { class: 'nb-fig', style: { height: h.toFixed(0) + 'px', background: color, borderColor: moodColor(num(c.satisfaction, 0.5)) } });
    row.append(el('div', { class: 'nb-cls', style: { flexGrow: Math.max(0.02, num(c.share)) * 100 }, title: `${c.label}: ${fmtPct(c.share, 0)} · доход ${fmtCompact(inc)} (мир. ед.)/мес · настроение ${fmtPct(c.satisfaction, 0)}` },
      el('div', { class: 'nb-figbox' }, fig), el('div', { class: 'nb-cn', text: (c.label || c.id).slice(0, 9) })));
  }
  if (!classes.length) row.append(el('div', { class: 'dim small pad', text: 'нет данных' }));
  return row;
}

const maxIncomeOf = worlds => Math.max(1e-9, ...worlds.flatMap(w => (w.stats?.classes || []).map(c => num(c.avgNetIncome) / Math.max(1e-9, num(w.abroad?.fx, 1)))));

function kv(label, value, cls = '') {
  return el('div', { class: 'nb-kv ' + cls }, el('span', { class: 'dim', text: label }), el('b', { text: value }));
}

export function createNeighborsTab(root) {
  const note = el('span', { class: 'dim small', text: 'Соседи считаются тем же движком, строй не меняют; на пошлину отвечают пошлиной, на эмбарго — эмбарго, на демпинг — квотой. Деньги через границу идут только через счета «заграницы».' });
  const empty = el('div', { class: 'dim pad', text: 'Соседей нет: страна живёт одна (мир создан без соседей — «Новая страна» позволяет выбрать).' });
  const cmpHead = el('thead'), cmpBody = el('tbody');
  const cmp = el('table', { class: 'tbl compact nb-cmp' }, cmpHead, cmpBody);
  const cards = el('div', { class: 'nb-cards' });
  root.append(el('div', { class: 'sect-head' }, el('h2', { text: 'Соседи' }), note), empty, cmp, cards);
  const nodes = new Map();

  function makeCard(s) {
    const head = el('div', { class: 'nb-head' }, el('b', { class: 'nb-name', text: s.name }), el('span', { class: 'dim small', text: s.label }));
    const regime = el('div', { class: 'dim small' });
    const streetWrap = el('div', { class: 'nb-streets' });
    const nums = el('div', { class: 'nb-nums' });
    const lanes = el('table', { class: 'tbl compact nb-lanes' });
    const reacts = el('div', { class: 'nb-reacts' });
    // рычаги торговли с этой страной
    const tariffVal = el('span', { class: 'lv-val' });
    const tariff = el('input', { type: 'range', min: 0, max: 1.5, step: 0.05, value: 0, class: 'nb-slider', 'aria-label': 'Пошлина на товары страны' });
    const embargo = el('input', { type: 'checkbox', 'aria-label': 'Эмбарго' });
    tariff.oninput = () => { if (app.world) { setTradeWith(app.world, s.id, { tariff: +tariff.value }); setText(tariffVal, `${Math.round(tariff.value * 100)}%`); } };
    embargo.onchange = () => { if (app.world) setTradeWith(app.world, s.id, { embargo: embargo.checked }); };
    const levers = el('div', { class: 'nb-levers' },
      el('div', { class: 'nb-lrow' }, el('span', { text: 'Надбавка к пошлинам на товары этой страны' }), tariffVal),
      tariff,
      el('label', { class: 'nb-lrow' }, embargo, el('span', { text: 'Эмбарго: торговля и капитал закрыты в обе стороны' })),
      el('div', { class: 'dim small', text: 'Пошлины по отраслям остаются в левой колонке и действуют на всех соседей сразу.' }));
    const box = el('div', { class: 'nb-card' }, head, regime, streetWrap, nums, el('h3', { class: 'sub-h', text: 'Торговля с нами по товарам' }), lanes, reacts, levers);
    return { box, regime, streetWrap, nums, lanes, reacts, tariff, tariffVal, embargo };
  }

  return function render(world) {
    const sums = neighborSummary(world);
    empty.hidden = sums.length > 0;
    cmp.hidden = cards.hidden = sums.length === 0;
    if (!sums.length) return;
    const fxH = num(world.abroad?.fx, 1);
    const worlds = [world, ...world.neighbors.map(n => n.world)];
    const maxInc = maxIncomeOf(worlds);

    // ── сравнительная таблица
    const hr = el('tr', {}, el('th', { text: '' }), el('th', { class: 'r', text: 'Наша страна' }), ...sums.map(s => el('th', { class: 'r', text: s.name })));
    cmpHead.replaceChildren(hr);
    const hs = world.stats || {};
    const hN = Math.max(1, world.households.length);
    const rows = [
      ['Строй (по классификатору)', world.regime?.label || '—', s => s.regime],
      ['ВВП на домохозяйство в мес., мир. ед.', fmtCompact((num(hs.gdp)) / hN / fxH), s => fmtCompact(s.gdpPc)],
      ['Безработица', fmtPct(hs.unemployment, 1), s => fmtPct(s.unemployment, 1)],
      ['Инфляция за год', fmtPct(hs.inflation, 1), s => fmtPct(s.inflation, 1)],
      ['Курс (валюта за мировую единицу)', fmtNum(fxH, 2), s => fmtNum(s.fx, 2)],
      ['Неравенство (Джини по доходу)', fmtNum(hs.giniIncome, 2), s => fmtNum(s.gini, 2)],
      ['Настроение', fmtPct(hs.avgSatisfaction, 0), s => fmtPct(s.satisfaction, 0)],
      ['Домохозяйств в модели', String(world.households.length), s => String(s.households)],
    ];
    cmpBody.replaceChildren(...rows.map(([label, ours, f]) => el('tr', {}, el('td', { text: label }), el('td', { class: 'r', text: ours }), ...sums.map(s => el('td', { class: 'r', text: f(s) })))));

    // ── карточки
    const seen = new Set();
    for (const s of sums) {
      seen.add(s.id);
      let nd = nodes.get(s.id);
      if (!nd) { nd = makeCard(s); nodes.set(s.id, nd); cards.append(nd.box); }
      const nw = world.neighbors.find(n => n.id === s.id).world;
      setText(nd.regime, `Строй у классификатора: ${s.regime}. Рычаги не меняет.`);
      nd.streetWrap.replaceChildren(
        el('div', { class: 'nb-sl', text: 'Наша улица' }), miniStreet(world, maxInc),
        el('div', { class: 'nb-sl', text: s.name }), miniStreet(nw, maxInc));
      const bal = s.exportsToN - s.importsFromN;
      nd.nums.replaceChildren(
        kv('Наш экспорт к ним, в мес.', fmtCompact(s.exportsToN)),
        kv('Наш импорт от них, в мес.', fmtCompact(s.importsFromN)),
        kv('Сальдо торговли с ними', (bal >= 0 ? '+' : '−') + fmtCompact(Math.abs(bal)), bal < 0 ? 'bad' : 'good'),
        kv('Уехало к ним за год / всего', `${s.migOut12} / ${s.migOutTotal}`),
        kv('Приехало от них за год / всего', `${s.migIn12} / ${s.migInTotal}`),
        kv('Капитал туда / оттуда (всего)', `${fmtCompact(s.capOutTotal)} / ${fmtCompact(s.capInTotal)}`));
      const lane = [];
      for (const g in world.xb.lanes) {
        let ex = 0, im = 0;
        for (const l of world.xb.lanes[g]) {
          if (l.from === 'home' && l.to === s.id) ex += l.q * l.p * fxH;
          if (l.from === s.id && l.to === 'home') im += l.q * l.p * fxH;
        }
        if (ex > 0.5 || im > 0.5) lane.push([g, ex, im]);
      }
      nd.lanes.replaceChildren(
        el('thead', {}, el('tr', {}, el('th', { text: 'Товар' }), el('th', { class: 'r', text: 'экспорт к ним' }), el('th', { class: 'r', text: 'импорт от них' }))),
        el('tbody', {}, ...(lane.length ? lane.map(([g, ex, im]) => el('tr', {}, el('td', { text: IND_LABELS[g] || g }), el('td', { class: 'r', text: ex > 0.5 ? fmtCompact(ex) : '—' }), el('td', { class: 'r', text: im > 0.5 ? fmtCompact(im) : '—' })))
          : [el('tr', {}, el('td', { class: 'dim', colspan: 3, text: 'Торговли в этом месяце нет' }))])));
      const chips = [];
      if (s.theirTariff >= 0.01) chips.push(el('span', { class: 'chip warn', text: `ответная пошлина на наши товары: ${Math.round(s.theirTariff * 100)}%` }));
      if (s.theirEmbargo) chips.push(el('span', { class: 'chip bad', text: 'эмбарго с их стороны' }));
      for (const g of s.quotas) chips.push(el('span', { class: 'chip warn', text: `квота на наш импорт: ${(IND_LABELS[g] || g).toLowerCase()}` }));
      if (!chips.length) chips.push(el('span', { class: 'chip', text: 'ответных мер нет: ведут себя прилично' }));
      nd.reacts.replaceChildren(el('span', { class: 'dim small', text: 'Их реакция: ' }), ...chips);
      // рычаги: не трогаем, пока игрок тянет ползунок
      if (document.activeElement !== nd.tariff) nd.tariff.value = s.ourTariff;
      setText(nd.tariffVal, `${Math.round(s.ourTariff * 100)}%`);
      nd.embargo.checked = s.ourEmbargo;
    }
    for (const [id, nd] of nodes) nd.box.hidden = !seen.has(id);
  };
}
