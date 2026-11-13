// Вкладка «Профессии»: занятость, зарплаты, вытеснение технологиями, переобучение.
import { PROFESSIONS } from '../sim/schema.js';
import { el, fmtPct, fmtNum, fmtCompact, fmtSigned, num } from './util.js';

export const PROF_COLORS = {
  manual: '#d2a54f', clerical: '#8d98a6', service: '#cf7fa8', care: '#6fc2a5', engineer: '#4aa3df', manager: '#9b7bd1', creative: '#86b560', official: '#d65f4f',
};

// История средней зарплаты по профессиям и стартовая структура занятости ведутся здесь же, в интерфейсе:
// ядро хранит только текущее значение. Записываем каждый новый месяц, даже когда вкладка скрыта.
const rec = { key: '', t0: -1, wages: [], start: null };   // wages: [{ t, w: {prof: wage} }]

export function profRow(world, id) {
  const sb = world.stats?.employmentByProfession?.[id];
  const lb = world.labor?.[id];
  const employed = num(sb?.employed ?? lb?.employed);
  const unemployed = num(sb?.unemployed ?? lb?.unemployed);
  const wage = num(sb?.avgWage) || num(lb?.wage);
  return { employed, unemployed, wage };
}

export function recordProfessions(world) {
  const key = world.seed + ':' + world.preset;
  const t = num(world.t);
  if (rec.key !== key || t < rec.t0) { rec.key = key; rec.t0 = t; rec.wages = []; rec.start = null; }
  const last = rec.wages[rec.wages.length - 1];
  if (last && t < last.t) rec.wages = rec.wages.filter(s => s.t < t);
  if (!rec.start) {
    rec.start = {};
    for (const p of PROFESSIONS) rec.start[p.id] = profRow(world, p.id).employed;
  }
  if (!rec.wages.length || rec.wages[rec.wages.length - 1].t < t) {
    const w = {};
    for (const p of PROFESSIONS) w[p.id] = profRow(world, p.id).wage;
    rec.wages.push({ t, w });
    if (rec.wages.length > 40) rec.wages.shift();
  }
}

function wageChange(id, t) {
  const arr = rec.wages;
  if (arr.length < 2) return null;
  const cur = arr[arr.length - 1];
  let base = null;
  for (const s of arr) if (s.t <= t - 12) base = s;         // ближайший отсчёт не позже года назад
  const partial = !base;
  if (!base) base = arr[0];
  const span = cur.t - base.t;
  if (span < 1 || !(base.w[id] > 0) || !(cur.w[id] > 0)) return null;
  return { v: cur.w[id] / base.w[id] - 1, months: span, partial };
}

function strip(title, shares, total) {
  const bar = el('div', { class: 'strip-bar' });
  for (const p of PROFESSIONS) {
    const v = total > 0 ? shares[p.id] / total : 0;
    if (v <= 0) continue;
    bar.append(el('i', { style: { width: v * 100 + '%', background: PROF_COLORS[p.id] }, title: `${p.label}: ${fmtPct(v, 1)}` }));
  }
  return el('div', { class: 'strip-row' }, el('span', { class: 'strip-name dim small', text: title }), bar);
}

export function createProfessions(root) {
  const stripBox = el('div', { class: 'strip' });
  const legend = el('div', { class: 'parade-legend' }, ...PROFESSIONS.map(p => el('span', { class: 'lg' }, el('i', { style: { background: PROF_COLORS[p.id] } }), p.label)));
  const tbody = el('tbody');
  const table = el('table', { class: 'tbl' },
    el('thead', {}, el('tr', {}, ...['Профессия', 'Занято', 'Безработных', 'Безработица', 'Ср. зарплата', 'За год', 'Вытеснено техн. (12 мес.)', 'Проектов нацелено', 'Переучивается', ''].map((t, i) =>
      el('th', { class: i && i < 9 ? 'r' : '', text: t })))),
    tbody);
  root.append(
    el('div', { class: 'sect-head' }, el('h2', { text: 'Профессии' }), el('span', { class: 'dim small', text: 'кто чем занят, сколько получает и кого собираются заменить' })),
    stripBox, legend, table,
    el('div', { class: 'dim small pad', text: 'Изменение зарплаты за год считает сам интерфейс по месячным отсчётам: пока прошло меньше года, показано за доступный срок (серым).' }));
  let sig = '';

  return function render(world) {
    const sig2 = world.seed + ':' + world.t + ':' + (world.tech?.count ?? 0);
    if (sig2 === sig) return;
    sig = sig2;
    recordProfessions(world);
    const t = num(world.t);
    const rows = PROFESSIONS.map(p => ({ p, ...profRow(world, p.id), bp: world.tech?.byProfession?.[p.id] || {}, ch: wageChange(p.id, t) }));
    const now = {}, tot = rows.reduce((a, r) => a + r.employed, 0);
    for (const r of rows) now[r.p.id] = r.employed;
    const startTot = Object.values(rec.start || {}).reduce((a, b) => a + b, 0);
    stripBox.replaceChildren(strip('Сейчас', now, tot), strip('На старте', rec.start || {}, startTot));
    tbody.replaceChildren(...rows.map(r => {
      const lf = r.employed + r.unemployed;
      const u = lf > 0 ? r.unemployed / lf : 0;
      const displaced = num(r.bp.displaced), targeted = num(r.bp.targeted), retr = num(r.bp.retraining);
      const tags = [];
      if (r.ch && r.ch.v >= 0.03) tags.push(el('span', { class: 'tag up', text: 'растёт', title: 'Зарплата выросла на ' + fmtPct(r.ch.v, 0) }));
      if (targeted >= 1) tags.push(el('span', { class: 'tag warn', text: 'под угрозой', title: `Под угрозой автоматизации: проектов, нацеленных на профессию — ${targeted}` }));
      else if (displaced >= Math.max(1, r.employed * 0.02)) tags.push(el('span', { class: 'tag warn', text: 'вытесняется' }));
      const chText = r.ch ? fmtSigned(r.ch.v * 100, 1, '%') : '—';
      return el('tr', {},
        el('td', {}, el('i', { class: 'dot', style: { background: PROF_COLORS[r.p.id] } }), r.p.label),
        el('td', { class: 'r', text: fmtNum(r.employed, 0) }),
        el('td', { class: 'r', text: fmtNum(r.unemployed, 0) }),
        el('td', { class: 'r' + (u > 0.15 ? ' bad' : ''), text: fmtPct(u, 1) }),
        el('td', { class: 'r', text: fmtCompact(r.wage) }),
        el('td', { class: 'r' + (r.ch ? (r.ch.v > 0.005 ? ' good' : r.ch.v < -0.005 ? ' bad' : '') : ' dim') + (r.ch?.partial ? ' partial' : ''), text: chText,
          title: r.ch ? `за ${r.ch.months} мес.` : 'пока мало истории' }),
        el('td', { class: 'r' + (displaced >= 1 ? ' warn' : ''), text: displaced >= 0.5 ? fmtNum(displaced, 0) : '0' }),
        el('td', { class: 'r', text: fmtNum(targeted, 0) }),
        el('td', { class: 'r', text: fmtNum(retr, 0) }),
        el('td', {}, ...tags));
    }));
  };
}
