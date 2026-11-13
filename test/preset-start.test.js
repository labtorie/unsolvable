// Старт с рычагами пресета (так создаются соседние страны) не должен быть катастрофичнее, чем переключение на тот же пресет после обычного старта.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../src/sim/schema.js';
import { populate } from '../src/sim/init.js';
import { analyze } from '../src/sim/analytics/index.js';
import { step } from '../src/sim/index.js';
import { POLICY_PRESETS, buildPolicies, applyPreset } from '../src/sim/presets.js';

const MONTHS = 240;

function meanUnemployment(id, mode, seed) {
  const w = createWorld({ seed, preset: 'industrial' });
  w.lite = true;
  if (mode === 'start') w.policies = buildPolicies(POLICY_PRESETS.find(p => p.id === id));
  populate(w, { preset: 'industrial', households: 140 });
  analyze(w);
  if (mode === 'switch') applyPreset(w, id);
  let sum = 0, n = 0;
  for (let t = 0; t < MONTHS; t++) { step(w); if (t >= 60) { sum += w.stats.unemployment; n++; } }
  return sum / n;
}

for (const id of ['planned', 'warcommunism', 'socdem', 'statecap']) {
  test(`старт с рычагами «${id}» не катастрофичнее переключения`, () => {
    const seeds = [7, 8];
    const st = seeds.reduce((a, s) => a + meanUnemployment(id, 'start', s), 0) / seeds.length;
    const sw = seeds.reduce((a, s) => a + meanUnemployment(id, 'switch', s), 0) / seeds.length;
    assert.ok(st < sw + 0.15, `${id}: безработица при старте ${st.toFixed(2)} против ${sw.toFixed(2)} при переключении`);
  });
}

test('старт с госотраслями: фирмы получают нужного собственника', () => {
  const w = createWorld({ seed: 3, preset: 'industrial' });
  w.lite = true;
  w.policies = buildPolicies(POLICY_PRESETS.find(p => p.id === 'planned'));
  populate(w, { preset: 'industrial', households: 140, noCalibrate: true });
  assert.ok(w.firms.every(f => f.owner === 'state'), 'при плане все фирмы государственные');
  const m = createWorld({ seed: 3, preset: 'industrial' });
  m.lite = true;
  m.policies = buildPolicies(POLICY_PRESETS.find(p => p.id === 'socdem'));
  populate(m, { preset: 'industrial', households: 140, noCalibrate: true });
  assert.ok(m.firms.some(f => f.industry === 'energy' && f.owner === 'state'), 'в смешанной отрасли есть государственный чемпион');
});
