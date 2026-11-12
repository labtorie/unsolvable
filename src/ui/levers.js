// Левая колонка: рычаги строятся целиком из POLICY_GROUPS / POLICY_DEFS / INDUSTRY_POLICY_DEFS.
// DOM создаётся один раз; sync() только обновляет значения (ползунки не прыгают под мышью).
import { POLICY_GROUPS, POLICY_DEFS, INDUSTRY_POLICY_DEFS, INDUSTRIES, createPolicies } from '../sim/schema.js';
import { el, svg, setText, clamp, num } from './util.js';
import { app } from './state.js';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const isPct = u => u === '%' || u === '% ВВП' || u === '%/год';

function digitsFor(step) {
  const s = step || 1;
  for (let d = 0; d <= 4; d++) {
    const x = s * 10 ** d;
    if (Math.abs(x - Math.round(x)) < 1e-6) return d;
  }
  return 2;
}

export function fmtPolicy(def, v) {
  if (def.type === 'toggle') return v ? 'вкл' : 'выкл';
  if (def.type === 'select') return def.options.find(o => o.id === v)?.label ?? String(v);
  if (def.type === 'brackets') return Array.isArray(v) ? `${v.length} ступ.` : '—';
  v = num(v, num(def.def));
  if (isPct(def.unit)) {
    const d = digitsFor((def.step || 0.01) * 100);
    return v === 0 && def.id === 'priceCap' ? 'нет' : `${(v * 100).toFixed(d)}%${def.unit.slice(1)}`;
  }
  return `${v.toFixed(digitsFor(def.step))}${def.unit ? ' ' + def.unit : ''}`;
}

// ── Редактор подоходной шкалы ──
const BW = 300, BH = 150, BL = 34, BR = 8, BT = 8, BB = 20, RMIN = -0.5, RMAX = 0.95;

function bracketsEditor(def, ctx) {
  let xmax = 8, sig = '';
  const chart = svg('svg', { class: 'brk', viewBox: `0 0 ${BW} ${BH}`, width: '100%' });
  const tbody = el('tbody');
  const table = el('table', { class: 'brk-table' },
    el('thead', {}, el('tr', {}, el('th', { text: 'от, мед. зарплат' }), el('th', { text: 'ставка, %' }), el('th'))), tbody);
  const addBtn = el('button', { class: 'btn small', text: '+ ступень', onclick: () => addAt(null) });
  const root = el('div', { class: 'brk-wrap' }, chart, el('div', { class: 'dim small', text: 'Тащите точки. Двойной щелчок по полю — добавить ступень, по точке — удалить.' }), table, addBtn);

  const get = () => (Array.isArray(ctx.get()) && ctx.get().length ? ctx.get() : structuredClone(def.def));
  const commit = arr => { ctx.set(arr.map(b => ({ from: +b.from.toFixed(3), rate: +clamp(b.rate, RMIN, RMAX).toFixed(3) }))); sync(); };
  const X = v => BL + (v / xmax) * (BW - BL - BR);
  const Y = r => BT + (1 - (r - RMIN) / (RMAX - RMIN)) * (BH - BT - BB);
  const fromX = px => ((px - BL) / (BW - BL - BR)) * xmax;
  const fromY = py => RMAX - ((py - BT) / (BH - BT - BB)) * (RMAX - RMIN);
  const toLocal = e => { const r = chart.getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * BW, ((e.clientY - r.top) / r.height) * BH]; };

  function addAt(x) {
    const arr = structuredClone(get());
    if (x == null) x = (arr[arr.length - 1].from || 1) * 1.5 + 0.5;
    x = Math.max(0.05, Math.round(x * 20) / 20);
    if (arr.some(b => Math.abs(b.from - x) < 0.04)) return;
    let r = arr[0].rate;
    for (const b of arr) if (b.from <= x) r = b.rate;
    arr.push({ from: x, rate: r });
    arr.sort((a, b) => a.from - b.from);
    commit(arr);
  }
  function remove(i) {
    const arr = structuredClone(get());
    if (arr.length <= 1) return;
    arr.splice(i, 1);
    arr[0].from = 0;
    commit(arr);
  }
  chart.addEventListener('dblclick', e => {
    if (e.target.classList?.contains('hnd')) return;
    const [px] = toLocal(e);
    addAt(fromX(px));
  });

  function drag(i, e) {
    e.preventDefault();
    const move = ev => {
      const arr = structuredClone(get());
      const [px, py] = toLocal(ev);
      arr[i].rate = Math.round(clamp(fromY(py), RMIN, RMAX) / 0.01) * 0.01;
      if (i > 0) {
        const lo = arr[i - 1].from + 0.05, hi = i < arr.length - 1 ? arr[i + 1].from - 0.05 : xmax * 1.2;
        arr[i].from = Math.round(clamp(fromX(px), lo, Math.max(lo, hi)) * 20) / 20;
      }
      commit(arr);
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  }

  function redrawChart(arr) {
    xmax = Math.max(8, Math.ceil(arr[arr.length - 1].from * 1.3));
    chart.replaceChildren();
    for (const r of [-0.5, 0, 0.25, 0.5, 0.75, 0.95]) {
      chart.append(svg('line', { x1: BL, x2: BW - BR, y1: Y(r), y2: Y(r), class: r === 0 ? 'grid zero' : 'grid' }),
        svg('text', { x: BL - 4, y: Y(r) + 3, class: 'axis', 'text-anchor': 'end', text: Math.round(r * 100) + '%' }));
    }
    const step = xmax > 12 ? 4 : 2;
    for (let v = 0; v <= xmax; v += step) chart.append(svg('text', { x: X(v), y: BH - 6, class: 'axis', 'text-anchor': 'middle', text: v }));
    let d = `M${X(0)},${Y(arr[0].rate)}`;
    arr.forEach((b, i) => {
      const nx = i < arr.length - 1 ? arr[i + 1].from : xmax;
      d += ` L${X(b.from)},${Y(b.rate)} L${X(nx)},${Y(b.rate)}`;
    });
    chart.append(svg('path', { d, class: 'brk-line', fill: 'none' }));
    arr.forEach((b, i) => {
      const c = svg('circle', { cx: X(b.from), cy: Y(b.rate), r: 5, class: 'hnd', tabindex: 0 });
      c.addEventListener('pointerdown', e => drag(i, e));
      c.addEventListener('dblclick', e => { e.stopPropagation(); remove(i); });
      chart.append(c, svg('title', {}, `от ${b.from} → ${(b.rate * 100).toFixed(0)}%`));
    });
  }

  function rebuildTable(arr) {
    tbody.replaceChildren();
    arr.forEach((b, i) => {
      const fromIn = el('input', { type: 'number', step: 0.05, min: 0, value: b.from, disabled: i === 0 });
      const rateIn = el('input', { type: 'number', step: 1, min: -50, max: 95, value: Math.round(b.rate * 100) });
      fromIn.addEventListener('change', () => {
        const a = structuredClone(get());
        a[i].from = Math.max(0, num(parseFloat(fromIn.value)));
        a.sort((p, q) => p.from - q.from); a[0].from = 0;
        commit(a);
      });
      rateIn.addEventListener('change', () => {
        const a = structuredClone(get());
        a[i].rate = clamp(num(parseFloat(rateIn.value)) / 100, RMIN, RMAX);
        commit(a);
      });
      tbody.append(el('tr', {}, el('td', {}, fromIn), el('td', {}, rateIn),
        el('td', {}, el('button', { class: 'btn ghost small', text: '×', title: 'Удалить ступень', disabled: arr.length <= 1, onclick: () => remove(i) }))));
    });
  }

  function sync() {
    const arr = get().map(b => ({ from: num(b.from), rate: num(b.rate) })).sort((a, b) => a.from - b.from);
    const sg = JSON.stringify(arr);
    if (sg === sig) return;
    sig = sg;
    redrawChart(arr);
    if (tbody.rows.length !== arr.length) rebuildTable(arr);
    else arr.forEach((b, i) => {
      const [fi, ri] = tbody.rows[i].querySelectorAll('input');
      if (document.activeElement !== fi && +fi.value !== b.from) fi.value = b.from;
      if (document.activeElement !== ri && +ri.value !== Math.round(b.rate * 100)) ri.value = Math.round(b.rate * 100);
    });
  }
  return { el: root, sync };
}

// ── Одна строка-рычаг ──
function leverRow(def, ctx) {
  const valueEl = el('span', { class: 'lv-val' });
  const mark = el('span', { class: 'lv-mark', title: 'Отличается от значения по умолчанию' });
  const reset = el('button', { class: 'lv-reset', text: '↺', title: 'Вернуть значение по умолчанию', onclick: () => { ctx.set(structuredClone(ctx.def)); sync(); } });
  const label = el('label', { class: 'lv-label', text: def.label, title: def.help || def.label });
  const head = el('div', { class: 'lv-head' }, mark, label, valueEl, reset);
  const row = el('div', { class: 'lever' + (def.type === 'brackets' ? ' wide' : '') }, head);
  if (def.help) row.append(el('div', { class: 'lv-help', text: def.help }));
  let control, syncControl;

  if (def.type === 'range') {
    control = el('input', { type: 'range', min: def.min, max: def.max, step: def.step });
    control.addEventListener('input', () => { ctx.set(parseFloat(control.value)); sync(); });
    syncControl = v => { if (document.activeElement !== control || +control.value !== v) control.value = v; };
  } else if (def.type === 'select') {
    control = el('select', {}, ...def.options.map(o => el('option', { value: o.id, text: o.label })));
    control.addEventListener('change', () => { ctx.set(control.value); sync(); });
    syncControl = v => { if (control.value !== v) control.value = v; };
  } else if (def.type === 'toggle') {
    control = el('input', { type: 'checkbox', class: 'switch' });
    control.addEventListener('change', () => { ctx.set(control.checked); sync(); });
    syncControl = v => { control.checked = !!v; };
    label.addEventListener('click', e => { e.preventDefault(); control.click(); });
  } else if (def.type === 'brackets') {
    const ed = bracketsEditor(def, ctx);
    control = ed.el; syncControl = () => ed.sync();
  } else {
    control = el('span', { class: 'dim', text: 'тип «' + def.type + '» не поддержан' }); syncControl = () => {};
  }
  row.append(control);
  let lastShown = null;
  function sync() {
    const v = ctx.get();
    const changed = !same(v, ctx.def);
    row.classList.toggle('changed', changed);
    reset.hidden = !changed;
    const shown = JSON.stringify(v);
    if (def.type === 'brackets' ? true : shown !== lastShown) {
      lastShown = shown;
      setText(valueEl, fmtPolicy(def, v));
      if (def.type !== 'brackets' || !control.contains(document.activeElement)) syncControl(v);
    }
    return changed;
  }
  return { el: row, sync };
}

const DEFAULTS = createPolicies();
const pol = () => (app.world.policies ||= {});

export function createLevers(root) {
  const tabs = el('div', { class: 'tabs lever-tabs' });
  const panes = el('div', { class: 'lever-panes' });
  root.append(tabs, panes);
  const rows = [];       // { sync, pane }
  const tabBtns = [];
  const groupSyncs = {}; // groupId -> [fn]

  const setTab = id => {
    tabBtns.forEach(b => b.btn.classList.toggle('active', b.id === id));
    for (const p of panes.children) p.hidden = p.dataset.id !== id;
    try { localStorage.setItem('unsolvable.leverTab', id); } catch { /* ignore */ }
  };
  const addTab = (id, label) => {
    const count = el('span', { class: 'cnt', hidden: true });
    const btn = el('button', { class: 'tab', onclick: () => setTab(id) }, label, count);
    tabs.append(btn);
    tabBtns.push({ id, btn, count });
    return count;
  };

  for (const g of POLICY_GROUPS) {
    addTab(g.id, g.label);
    const pane = el('div', { class: 'lever-pane', 'data-id': g.id });
    groupSyncs[g.id] = [];
    for (const d of POLICY_DEFS.filter(x => x.group === g.id)) {
      const r = leverRow(d, {
        def: d.def,
        get: () => pol()[d.id] ?? d.def,
        set: v => { pol()[d.id] = v; },
      });
      pane.append(r.el);
      groupSyncs[g.id].push(r.sync);
    }
    panes.append(pane);
  }

  // Отрасли: раскрывающиеся строки
  addTab('industry', 'Отрасли');
  const ipane = el('div', { class: 'lever-pane', 'data-id': 'industry' });
  groupSyncs.industry = [];
  for (const ind of INDUSTRIES) {
    const sum = el('summary', {}, el('span', { text: ind.label }), el('span', { class: 'cnt', hidden: true }), el('span', { class: 'dim small', text: ind.tradable ? 'торгуемая' : '' }));
    const det = el('details', { class: 'ind' }, sum);
    const syncs = [];
    for (const d of INDUSTRY_POLICY_DEFS) {
      if (d.tradableOnly && !ind.tradable) continue;
      const r = leverRow(d, {
        def: DEFAULTS.industry[ind.id][d.id],
        get: () => pol().industry?.[ind.id]?.[d.id] ?? DEFAULTS.industry[ind.id][d.id],
        set: v => { ((pol().industry ||= {})[ind.id] ||= {})[d.id] = v; },
      });
      det.append(r.el); syncs.push(r.sync);
    }
    groupSyncs.industry.push(() => {
      let n = 0;
      for (const s of syncs) if (s()) n++;
      const c = sum.querySelector('.cnt');
      c.hidden = !n; setText(c, n);
      return n;
    });
    // «Собственность» по умолчанию у security — 'state' в createPolicies, но def — 'free': метка честно покажет отличие
    ipane.append(det);
  }
  panes.append(ipane);

  let saved = 'taxes';
  try { saved = localStorage.getItem('unsolvable.leverTab') || saved; } catch { /* ignore */ }
  setTab(tabBtns.some(b => b.id === saved) ? saved : 'taxes');

  return function render(world) {
    if (!world) return;
    for (const { id, count } of tabBtns) {
      let n = 0;
      for (const fn of groupSyncs[id]) if (fn()) n++;
      count.hidden = !n; setText(count, n);
    }
  };
}
