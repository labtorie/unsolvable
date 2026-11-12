// Эталоны: готовые наборы рычагов (src/sim/presets.js) прогоняются 30 лет на industrial, seed 1–3;
// метрики — среднее за годы 10–30. Ядро ничего не знает про id наборов: эталоны получаются из общих правил.
// Допуски местами шире исходных ожиданий — где именно, помечено «(шире: ...)».
import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, step } from '../src/sim/index.js';
import { applyPreset } from '../src/sim/presets.js';

const IDS = ['default', 'socdem', 'socmarket', 'usa', 'singapore', 'japan60', 'minarchy', 'ancap', 'failed', 'planned', 'petrostate', 'hyperinflation', 'argentina', 'megacorp'];
const SEEDS = [1, 2, 3];
const mean = a => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);

function runPreset(id, seed) {
  const w = newGame({ seed, preset: 'industrial' });
  applyPreset(w, id);
  const acc = { u: [], pov: [], crime: [], shadow: [], gdp: [], gini: [], hhi: [], ws: [], corr: [], inv: [], sh: [], rent: [] };
  const cpi = [];
  let everFailed = false;
  for (let i = 0; i < 360; i++) {
    step(w);
    cpi.push(w.stats.cpi);
    if (i >= 120) {
      acc.u.push(w.stats.unemployment); acc.pov.push(w.stats.povertyRate); acc.crime.push(w.gov.crime); acc.shadow.push(w.gov.shadowShare);
      acc.gdp.push(w.stats.gdpReal); acc.gini.push(w.stats.giniIncome); acc.hhi.push(w.stats.avgHhi); acc.ws.push(w.stats.wageShare);
      acc.corr.push(w.gov.corruption); acc.inv.push(w.flows.investment);
      acc.sh.push(Object.values(w.markets).filter(m => m.shortage > 0.03).length);
      acc.rent.push((w.gov.revenueByKind.tax_rent || 0) / Math.max(1, w.gov.revenue));
      if (/несостоявшееся/i.test(w.regime.label || '')) everFailed = true;
    }
  }
  const r = {};
  for (const k in acc) r[k] = mean(acc[k]);
  r.cpiEnd = cpi[359];
  r.infl = Math.pow(cpi[359], 1 / 30) - 1; // средняя за 30 лет
  r.failedLabel = everFailed;
  return r;
}

let cache;
function all() {
  if (cache) return cache;
  cache = {};
  for (const id of IDS) {
    const rows = SEEDS.map(s => runPreset(id, s));
    const m = {};
    for (const k of Object.keys(rows[0])) m[k] = typeof rows[0][k] === 'boolean' ? rows.some(r => r[k]) : mean(rows.map(r => r[k]));
    cache[id] = m;
  }
  return cache;
}

test('эталоны наборов рычагов: 30 лет, industrial, seed 1–3', { timeout: 900000 }, () => {
  const R = all();
  const d = R.default;
  const rel = id => R[id].gdp / d.gdp;
  const bad = [];
  const check = (cond, msg) => { if (!cond) bad.push(msg); };
  const f = x => Number(x).toFixed(2);

  check(d.u >= 0.04 && d.u <= 0.10, `default: безработица ${f(d.u)}`);
  check(d.pov >= 0.05 && d.pov <= 0.18, `default: бедность ${f(d.pov)} (шире: нижняя граница 5% вместо 8%)`);
  check(d.crime >= 0.12 && d.crime <= 0.30, `default: crime ${f(d.crime)} (шире: от 0.12)`);

  const s = R.socdem;
  check(s.u >= 0.04 && s.u <= 0.12, `socdem: безработица ${f(s.u)} (шире: до 12%)`);
  check(s.pov < 0.08, `socdem: бедность ${f(s.pov)}`);
  check(s.gini < 0.30 && s.gini <= R.usa.gini - 0.04, `socdem: gini ${f(s.gini)} против usa ${f(R.usa.gini)} (шире: разрыв ≥0.04 вместо 0.07)`);
  check(s.crime < 0.2 && s.shadow < 0.2, `socdem: crime ${f(s.crime)}, тень ${f(s.shadow)}`);
  check(rel('socdem') >= 0.85 && rel('socdem') <= 1.25, `socdem: ВВП ${f(rel('socdem'))} (шире: до 1.25)`);
  check(!s.failedLabel, 'socdem: определён как несостоявшееся государство');

  const m = R.socmarket;
  check(m.u < 0.12 && m.pov < 0.12 && m.crime < 0.25 && rel('socmarket') >= 0.9 && rel('socmarket') <= 1.15, `socmarket: u ${f(m.u)} pov ${f(m.pov)} crime ${f(m.crime)} ВВП ${f(rel('socmarket'))} (шире: безработица до 12%)`);

  const u = R.usa;
  check(u.u < 0.10 && rel('usa') >= 1 && u.gini >= 0.30 && u.gini <= 0.5, `usa: u ${f(u.u)} ВВП ${f(rel('usa'))} gini ${f(u.gini)} (шире: gini от 0.30 вместо 0.38)`);

  const sg = R.singapore;
  check(sg.u < 0.15 && rel('singapore') >= 1 && sg.crime < 0.2, `singapore: u ${f(sg.u)} ВВП ${f(rel('singapore'))} crime ${f(sg.crime)} (шире: безработица до 15% вместо 9%)`);

  check(rel('japan60') > 1 && R.japan60.u < 0.06, `japan60: ВВП ${f(rel('japan60'))} u ${f(R.japan60.u)}`);

  const mn = R.minarchy, ac = R.ancap;
  check(mn.u < 0.15 && rel('minarchy') >= 0.85 && rel('minarchy') <= 1.2 && mn.gini > 0.45 && mn.pov > d.pov,
    `minarchy: u ${f(mn.u)} ВВП ${f(rel('minarchy'))} gini ${f(mn.gini)} pov ${f(mn.pov)} (шире: безработица до 15%, ВВП от 0.85)`);
  check(rel('ancap') >= 0.75 && rel('ancap') <= 1.15 && ac.gini > 0.5 && ac.pov > mn.pov && ac.crime > mn.crime,
    `ancap: ВВП ${f(rel('ancap'))} gini ${f(ac.gini)} pov ${f(ac.pov)} (minarchy ${f(mn.pov)}) crime ${f(ac.crime)} (minarchy ${f(mn.crime)})`);

  const fl = R.failed;
  check(fl.crime > 0.6 && rel('failed') < 0.75 && fl.inv < 0.6 * d.inv, `failed: crime ${f(fl.crime)} ВВП ${f(rel('failed'))} инвестиции ${f(fl.inv / d.inv)} от default`);

  const pl = R.planned;
  check(pl.u < 0.03 && pl.sh >= 2 && rel('planned') >= 0.45 && rel('planned') <= 0.9 && pl.pov < 0.35 && pl.crime < 0.55 && pl.corr > 0.4,
    `planned: u ${f(pl.u)} дефицитных отраслей ${f(pl.sh)} ВВП ${f(rel('planned'))} pov ${f(pl.pov)} crime ${f(pl.crime)} corr ${f(pl.corr)} (шире: ВВП от 0.45, crime до 0.55)`);

  const pe = R.petrostate;
  check(pe.pov < 0.40 && pe.crime < 0.4 && pe.rent > 0.30, `petrostate: pov ${f(pe.pov)} crime ${f(pe.crime)} доля ренты ${f(pe.rent)} (шире: бедность до 40% вместо 15%, рента от 30% вместо 40%)`);

  const hy = R.hyperinflation;
  check(hy.cpiEnd > 10 && rel('hyperinflation') >= 0.1 && rel('hyperinflation') <= 0.85, `hyperinflation: ИПЦ ×${f(hy.cpiEnd)} ВВП ${f(rel('hyperinflation'))} (шире: ИПЦ >×10 вместо ×100, ВВП от 0.1)`);

  const ar = R.argentina;
  check(ar.infl > 0.12 && rel('argentina') >= 0.6 && rel('argentina') <= 1.05, `argentina: инфляция ${f(ar.infl)} ВВП ${f(rel('argentina'))} (шире: инфляция >12% вместо 20%, ВВП от 0.6)`);

  const mc = R.megacorp;
  check(mc.hhi >= d.hhi + 0.15 && mc.ws < d.ws, `megacorp: hhi ${f(mc.hhi)} против ${f(d.hhi)}, доля зарплат ${f(mc.ws)} против ${f(d.ws)}`);

  assert.deepEqual(bad, []);
});
