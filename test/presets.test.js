import test from 'node:test';
import assert from 'node:assert/strict';
import { POLICY_DEFS, INDUSTRY_POLICY_DEFS, INDUSTRIES } from '../src/sim/schema.js';
import { POLICY_PRESETS, PRESET_GROUPS, buildPolicies, applyPreset } from '../src/sim/presets.js';
import { newGame, step } from '../src/sim/index.js';

function checkValue(def, v, where) {
  if (def.type === 'range') assert.ok(typeof v === 'number' && v >= def.min - 1e-9 && v <= def.max + 1e-9, `${where}: ${v} вне [${def.min}, ${def.max}]`);
  else if (def.type === 'select') assert.ok(def.options.some(o => o.id === v), `${where}: нет варианта ${v}`);
  else if (def.type === 'toggle') assert.equal(typeof v, 'boolean', where);
  else if (def.type === 'brackets') {
    assert.ok(Array.isArray(v) && v.length > 0 && v[0].from === 0, `${where}: шкала должна начинаться с 0`);
    for (let i = 0; i < v.length; i++) {
      assert.ok(v[i].rate >= -0.5 && v[i].rate <= 0.95, `${where}: ставка ${v[i].rate}`);
      if (i) assert.ok(v[i].from > v[i - 1].from, `${where}: ступени по возрастанию`);
    }
  }
}

test('пресеты: все ключи и значения допустимы', () => {
  const defs = Object.fromEntries(POLICY_DEFS.map(d => [d.id, d]));
  const idefs = Object.fromEntries(INDUSTRY_POLICY_DEFS.map(d => [d.id, d]));
  const inds = new Set(INDUSTRIES.map(i => i.id));
  const ids = new Set();
  for (const p of POLICY_PRESETS) {
    assert.ok(!ids.has(p.id), `повтор id ${p.id}`); ids.add(p.id);
    assert.ok(PRESET_GROUPS.some(g => g.id === p.group), `${p.id}: группа`);
    assert.ok(p.label && p.note, `${p.id}: подписи`);
    for (const [k, v] of Object.entries(p.set)) { assert.ok(defs[k], `${p.id}: неизвестный рычаг ${k}`); checkValue(defs[k], v, `${p.id}.${k}`); }
    for (const [ind, o] of Object.entries(p.industry)) {
      assert.ok(ind === '*' || inds.has(ind), `${p.id}: неизвестная отрасль ${ind}`);
      for (const [k, v] of Object.entries(o)) { assert.ok(idefs[k], `${p.id}.${ind}: неизвестный рычаг ${k}`); checkValue(idefs[k], v, `${p.id}.${ind}.${k}`); }
    }
    const full = buildPolicies(p);
    for (const d of POLICY_DEFS) assert.ok(d.id in full, `${p.id}: нет ${d.id}`);
  }
});

test('пресеты: каждый живёт 20 лет без NaN', () => {
  for (const p of POLICY_PRESETS) {
    const w = newGame({ seed: 3 });
    assert.ok(applyPreset(w, p.id));
    for (let m = 0; m < 240; m++) step(w);
    for (const k of ['gdp', 'gdpReal', 'cpi', 'unemployment', 'giniIncome']) assert.ok(Number.isFinite(w.stats[k]), `${p.id}: ${k}=${w.stats[k]}`);
    assert.ok(w.regime.label, `${p.id}: строй не определён`);
  }
});
