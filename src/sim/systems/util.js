import { pay } from '../ledger.js';

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

export function addEvent(world, type, text, data) {
  world.events.push(data ? { t: world.t, type, text, data } : { t: world.t, type, text });
  if (world.events.length > 260) world.events.splice(0, world.events.length - 200);
}

export function median(arr) {
  if (!arr.length) return 0;
  const a = Float64Array.from(arr).sort();
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/** Перевод не больше, чем есть у плательщика. */
export function safePay(world, from, to, amount, kind) {
  const a = Math.min(amount, from.cash);
  if (!(a > 0)) return 0;
  return pay(world, from, to, a, kind);
}

/** Вспомогательный счёт «пул»: деньги заходят и сразу расходятся. Не входит в мир. */
export function makePool() { return { cash: 0 }; }
// Внутренние перераспределения из пула не должны дважды попадать в flows.
export const DUMMY = { flows: {} };

export function plus(obj, key, v) { obj[key] = (obj[key] || 0) + v; }

export function profLabel(id) { return id; }

export function fmt(n) { return Math.round(n).toLocaleString('ru-RU'); }
