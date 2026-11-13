// «Допущения модели» (GDD 1.5): спорные коэффициенты, которые игрок может крутить прямо в ходе игры.
import { ASSUMPTION_DEFS } from '../sim/schema.js';
import { el, openModal, fmtNum, num } from './util.js';
import { app, onChange, requestRender } from './state.js';

const cur = d => num(app.world?.assumptions?.[d.id], d.def);
export const changedAssumptions = () => ASSUMPTION_DEFS.filter(d => Math.abs(cur(d) - d.def) > 1e-9).length;

export function openAssumptions() {
  const rows = ASSUMPTION_DEFS.map(d => {
    const val = el('b', { class: 'as-val' });
    const input = el('input', { type: 'range', min: d.min, max: d.max, step: 0.05, 'aria-label': d.label });
    const reset = el('button', { class: 'lv-reset', text: '↺', title: `Вернуть ${fmtNum(d.def, 2)}`, onclick: () => set(d.def) });
    const row = el('div', { class: 'lever as-row' },
      el('div', { class: 'lv-head' }, el('span', { class: 'lv-mark' }), el('label', { class: 'lv-label', text: d.label }), val, reset), input,
      el('div', { class: 'as-scale dim small' }, el('span', { text: fmtNum(d.min, 0) }), el('span', { text: 'по умолчанию ' + fmtNum(d.def, 2) }), el('span', { text: fmtNum(d.max, 0) })));
    function set(v) {
      if (!app.world) return;
      (app.world.assumptions ||= {})[d.id] = Math.round(v * 100) / 100;
      requestRender(); sync();
    }
    input.addEventListener('input', () => set(parseFloat(input.value)));
    function sync() {
      const v = cur(d), changed = Math.abs(v - d.def) > 1e-9;
      row.classList.toggle('changed', changed);
      reset.hidden = !changed;
      val.textContent = fmtNum(v, 2);
      if (document.activeElement !== input && +input.value !== v) input.value = v;
    }
    return { row, sync };
  });
  const all = el('button', { class: 'btn small', text: 'Сбросить все', onclick: () => {
    if (!app.world) return;
    for (const d of ASSUMPTION_DEFS) (app.world.assumptions ||= {})[d.id] = d.def;
    requestRender(); sync();
  } });
  const sync = () => rows.forEach(r => r.sync());
  const m = openModal('Допущения модели', el('div', { class: 'as-box' },
    el('p', { class: 'as-note', text: 'Это спорные коэффициенты. Экономисты о них спорят — теперь можете и вы. 1 — значение по умолчанию, 0 — эффекта нет, 3 — втрое сильнее. Изменения действуют со следующего месяца.' }),
    el('div', { class: 'row gap' }, el('span', { class: 'grow' }), all), ...rows.map(r => r.row)), { onClose: () => off() });
  const off = onChange(sync);
  sync();
  return m;
}
