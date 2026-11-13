// Точка входа симуляции для интерфейса и тестов.
import { createWorld, HISTORY_KEYS } from './schema.js';
import { populate } from './init.js';            // ядро
import { tick } from './tick.js';                // ядро
import { analyze } from './analytics/index.js';  // аналитика
import { ensureMail } from './mailbox.js';       // общество: обращения к власти
import { createNeighbors, DEFAULT_NEIGHBORS } from './neighbors.js';   // соседние страны

const HISTORY_LIMIT = 12 * 200;

function readPath(obj, path) {
  let v = obj;
  for (const k of path.split('.')) v = v?.[k];
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function record(world) {
  const h = world.history;
  h.t.push(world.t);
  for (const [key, path] of Object.entries(HISTORY_KEYS)) {
    (h.series[key] ||= []).push(readPath(world, path));
  }
  if (h.t.length > HISTORY_LIMIT) {
    h.t.shift();
    for (const key of Object.keys(h.series)) h.series[key].shift();
  }
}

/** Новая игра. opts — см. createWorld; neighbors — id наборов рычагов соседей (по умолчанию минархия, плановая экономика, социал-демократия; [] — мир без соседей). */
export function newGame(opts = {}) {
  const world = createWorld(opts);
  populate(world, opts);
  ensureMail(world).enabled = opts.mail !== false;   // почта включена в игре; в голом createWorld выключена
  const nb = opts.neighbors ?? DEFAULT_NEIGHBORS;
  if (nb.length) createNeighbors(world, nb, opts);
  analyze(world);
  record(world);
  return world;
}

/** Один месяц. Меняет world на месте и возвращает его. */
export function step(world) {
  tick(world);
  analyze(world);
  record(world);
  return world;
}

/** Снимок для сохранения и ветвления. */
export function snapshot(world) {
  return structuredClone(world);
}
