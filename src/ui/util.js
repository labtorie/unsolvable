// Общие мелочи интерфейса: DOM-помощники, форматирование, палитры, модальные окна.
import { CLASSES } from '../sim/schema.js';

export const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

export function fmtDate(t) {
  t = Math.max(0, Math.floor(Number(t) || 0));
  return `${MONTHS[t % 12]} · год ${1 + Math.floor(t / 12)}`;
}

export const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export function fmtNum(v, d = 1) {
  v = num(v);
  return v.toLocaleString('ru-RU', { minimumFractionDigits: d, maximumFractionDigits: d });
}
export function fmtPct(v, d = 1) { return fmtNum(num(v) * 100, d) + '%'; }
export function fmtCompact(v) {
  v = num(v);
  const a = Math.abs(v);
  if (a >= 1e9) return fmtNum(v / 1e9, 2) + ' млрд';
  if (a >= 1e6) return fmtNum(v / 1e6, 2) + ' млн';
  if (a >= 1e4) return fmtNum(v / 1e3, 1) + ' тыс';
  if (a >= 100) return fmtNum(v, 0);
  if (a >= 10) return fmtNum(v, 1);
  return fmtNum(v, 2);
}

// Палитра классов и типов собственности (одна на весь интерфейс; те же значения в style.css).
export const CLASS_COLORS = {
  destitute: '#a8695a', workers: '#d2a54f', precariat: '#cf7fa8', specialists: '#6f86d8',
  smallowners: '#86b560', capitalists: '#9b7bd1', retired: '#8d98a6', nomenklatura: '#d65f4f',
};
export const OWNER_COLORS = { private: '#6fb3b0', state: '#cf7a5a', coop: '#b4c46a', foreign: '#a68fc4' };
export const OWNER_LABELS = { private: 'частная', state: 'государственная', coop: 'кооператив', foreign: 'иностранная' };
export const CLASS_LABELS = Object.fromEntries(CLASSES.map(c => [c.id, c.label]));

const SVGNS = 'http://www.w3.org/2000/svg';

function apply(node, attrs) {
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') node.setAttribute('class', v);
    else if (k === 'text') node.textContent = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
}
function append(node, children) {
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}
export function el(tag, attrs, ...children) {
  const n = document.createElement(tag);
  apply(n, attrs); append(n, children);
  return n;
}
export function svg(tag, attrs, ...children) {
  const n = document.createElementNS(SVGNS, tag);
  apply(n, attrs); append(n, children);
  return n;
}
export function setText(node, text) {
  text = String(text);
  if (node.textContent !== text) node.textContent = text;
}

// Простое модальное окно. Возвращает { close, body }.
export function openModal(title, content, opts = {}) {
  const prevFocus = document.activeElement;
  const body = el('div', { class: 'modal-body' }, content);
  const box = el('div', { class: 'modal' + (opts.wide ? ' wide' : ''), role: 'dialog', 'aria-label': title },
    el('div', { class: 'modal-head' }, el('h3', { text: title }),
      el('button', { class: 'btn ghost', text: 'Закрыть', onclick: () => close() })),
    body);
  const back = el('div', { class: 'modal-back', onmousedown: e => { if (e.target === back) close(); } }, box);
  const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  function close() {
    window.removeEventListener('keydown', onKey, true);
    back.remove();
    opts.onClose?.();
    try { prevFocus?.focus?.(); } catch { /* ignore */ }
  }
  window.addEventListener('keydown', onKey, true);
  document.body.append(back);
  return { close, body, box };
}
