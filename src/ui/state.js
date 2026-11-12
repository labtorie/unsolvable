// Состояние приложения, выбор источника симуляции и игровой цикл.
// Единственное место, где решается: настоящее ядро или мок.

export const app = {
  sim: null,            // { newGame, step, snapshot }
  simName: '',          // 'ядро' | 'мок'
  simNote: '',          // почему выбран мок
  world: null,
  running: false,
  speed: 1,             // 1 | 4 | 16
  snapshots: [],        // { id, name, t, world }
  branches: [],         // покинутые ветки: { id, name, t, history }
  compare: null,        // { id, name, history } — вторая линия на больших графиках
  error: '',
  lastOpts: { preset: 'industrial', seed: 42 },
};

export const SPEEDS = [1, 4, 16];
const BASE_TICK_MS = 1200;       // ×1 ≈ 1 тик за 1.2 с
const FRAME_BUDGET_MS = 24;      // сколько мс на кадр можно тратить на шаги
const RENDER_EVERY_MS = 100;     // перерисовка не чаще ~10 раз в секунду

const listeners = new Set();
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function emit() { for (const fn of listeners) { try { fn(app); } catch (e) { console.error(e); } } }

async function loadSim() {
  const forceMock = new URLSearchParams(location.search).get('mock');
  if (forceMock && forceMock !== '0') {
    app.simNote = 'принудительно (?mock=1)';
    return import('./dev-mock.js');
  }
  try {
    const m = await import('../sim/index.js');
    if (typeof m.newGame !== 'function' || typeof m.step !== 'function') throw new Error('нет newGame/step');
    return m;
  } catch (e) {
    app.simNote = 'ядро недоступно: ' + (e?.message || e);
    console.warn('[Unsolvable] ядро не загрузилось, использую мок:', e);
    return import('./dev-mock.js');
  }
}

export async function init() {
  app.sim = await loadSim();
  app.simName = app.simNote ? 'мок' : 'ядро';
  try {
    app.world = app.sim.newGame({ ...app.lastOpts });
  } catch (e) {
    if (app.simName === 'мок') throw e;
    console.warn('[Unsolvable] newGame ядра упал, использую мок:', e);
    app.simNote = 'ядро упало при создании: ' + (e?.message || e);
    app.sim = await import('./dev-mock.js');
    app.simName = 'мок';
    app.world = app.sim.newGame({ ...app.lastOpts });
  }
  startLoop();
}

export function newCountry(opts) {
  app.lastOpts = { preset: opts.preset, seed: opts.seed };
  app.world = app.sim.newGame({ ...app.lastOpts });
  app.error = '';
  emit();
}

export function setRunning(v) { app.running = !!v; acc = 0; emit(); }
export function toggleRunning() { setRunning(!app.running); }
export function setSpeed(s) { app.speed = s; emit(); }

export function stepOnce() {
  try {
    app.sim.step(app.world);
    return true;
  } catch (e) {
    console.error('[Unsolvable] ошибка шага симуляции', e);
    app.error = 'Ошибка симуляции: ' + (e?.message || e);
    app.running = false;
    emit();
    return false;
  }
}

// ── Снимки и ветки ──
let uid = 1;
export function saveSnapshot(fmtName) {
  const w = app.world;
  const s = { id: uid++, name: fmtName(w.t), t: w.t, world: app.sim.snapshot(w) };
  app.snapshots.push(s);
  emit();
  return s;
}
export function restoreSnapshot(id, fmtName) {
  const s = app.snapshots.find(x => x.id === id);
  if (!s) return;
  const cur = app.world;
  if (cur && cur.t !== s.t && cur.history?.t?.length) {
    app.branches.push({
      id: uid++, t: cur.t, history: structuredClone(cur.history),
      name: `Ветка: ${fmtName(s.t)} → ${fmtName(cur.t)}`,
    });
  }
  app.world = app.sim.snapshot(s.world);
  app.running = false;
  app.error = '';
  emit();
}
export function deleteSnapshot(id) {
  app.snapshots = app.snapshots.filter(s => s.id !== id);
  if (app.compare?.id === id) app.compare = null;
  emit();
}
export function deleteBranch(id) {
  app.branches = app.branches.filter(s => s.id !== id);
  if (app.compare?.id === id) app.compare = null;
  emit();
}
export function setCompare(kind, id) {
  if (app.compare?.id === id) { app.compare = null; emit(); return; }
  if (kind === 'snapshot') {
    const s = app.snapshots.find(x => x.id === id);
    if (s) app.compare = { id, name: s.name, history: s.world.history };
  } else {
    const b = app.branches.find(x => x.id === id);
    if (b) app.compare = { id, name: b.name, history: b.history };
  }
  emit();
}

// ── Цикл ──
let acc = 0, last = 0, lastRender = 0, started = false;
const renderers = [];
export function addRenderer(fn) { renderers.push(fn); }
let dirty = true;
export function requestRender() { dirty = true; }
const failed = new Set();

function renderAll(now) {
  lastRender = now; dirty = false;
  const w = app.world;
  if (!w) return;
  for (const fn of renderers) {
    try { fn(w, app); } catch (e) {
      if (!failed.has(fn)) { failed.add(fn); console.error('[Unsolvable] ошибка отрисовки', fn.name, e); }
    }
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(250, now - last || 0);
  last = now;
  if (app.running && app.world) {
    acc += dt;
    const interval = BASE_TICK_MS / app.speed;
    const t0 = performance.now();
    let n = 0;
    while (acc >= interval && n < 8 && performance.now() - t0 < FRAME_BUDGET_MS) {
      acc -= interval; n++;
      if (!stepOnce()) break;
      dirty = true;
    }
    if (acc > interval * 2) acc = interval;   // не копим долг, если кадры тяжёлые
  }
  if (now - lastRender >= RENDER_EVERY_MS && (dirty || app.running)) renderAll(now);
  else if (dirty && now - lastRender >= RENDER_EVERY_MS / 2) renderAll(now);
}

function startLoop() {
  if (started) return;
  started = true;
  requestAnimationFrame(t => { last = t; lastRender = 0; frame(t); });
}
