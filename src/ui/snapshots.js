// Снимки, ветки, сравнение и диалог «Новая страна».
import { el, fmtDate, openModal } from './util.js';
import { POLICY_PRESETS } from '../sim/presets.js';
import { app, saveSnapshot, restoreSnapshot, deleteSnapshot, deleteBranch, setCompare, newCountry, onChange } from './state.js';

export const PRESET_LIST = [
  ['industrial', 'Индустриальная', 'Средний доход, заводы, терпимая бедность.'],
  ['agrarian', 'Аграрная', 'Бедная страна, большинство на земле.'],
  ['resource', 'Ресурсная', 'Нефть и руда: рента, которую есть кому делить.'],
  ['trading', 'Торговая', 'Маленькая, без ресурсов, живёт торговлей и услугами.'],
];

export function createSnapshotUi(buttonsRoot) {
  const saveBtn = el('button', { class: 'btn', text: 'Сохранить снимок', onclick: () => { saveSnapshot(fmtDate); flash(); } });
  const listBtn = el('button', { class: 'btn', onclick: () => toggle() });
  const cmpChip = el('span', { class: 'chip cmp', hidden: true });
  const newBtn = el('button', { class: 'btn', text: 'Новая страна', onclick: openNew });
  const pop = el('div', { class: 'popover hidden' });
  buttonsRoot.append(saveBtn, listBtn, cmpChip, newBtn, pop);

  function flash() { saveBtn.classList.add('ok'); setTimeout(() => saveBtn.classList.remove('ok'), 600); }
  function toggle(force) {
    const open = force ?? pop.classList.contains('hidden');
    pop.classList.toggle('hidden', !open);
    if (open) fill();
  }
  document.addEventListener('mousedown', e => { if (!pop.contains(e.target) && !listBtn.contains(e.target)) pop.classList.add('hidden'); });

  function fill() {
    const snap = app.snapshots.map(s => el('div', { class: 'snap' + (app.compare?.id === s.id ? ' cmp' : '') },
      el('span', { class: 'snap-name', text: s.name, title: 'Месяц ' + s.t }),
      el('button', { class: 'btn small', text: 'Вернуться', onclick: () => { restoreSnapshot(s.id, fmtDate); toggle(false); } }),
      el('button', { class: 'btn small' + (app.compare?.id === s.id ? ' on' : ''), text: 'Сравнить', onclick: () => setCompare('snapshot', s.id) }),
      el('button', { class: 'btn ghost small', text: '×', title: 'Удалить снимок', onclick: () => deleteSnapshot(s.id) })));
    const br = app.branches.map(b => el('div', { class: 'snap' + (app.compare?.id === b.id ? ' cmp' : '') },
      el('span', { class: 'snap-name', text: b.name }),
      el('button', { class: 'btn small' + (app.compare?.id === b.id ? ' on' : ''), text: 'Сравнить', onclick: () => setCompare('branch', b.id) }),
      el('button', { class: 'btn ghost small', text: '×', title: 'Удалить ветку', onclick: () => deleteBranch(b.id) })));
    pop.replaceChildren(
      el('h4', { text: 'Снимки' }),
      ...(snap.length ? snap : [el('div', { class: 'dim small pad', text: 'Пока нет. Сохраните момент, прокрутите время и вернитесь.' })]),
      el('h4', { text: 'Покинутые ветки' }),
      ...(br.length ? br : [el('div', { class: 'dim small pad', text: 'Появятся, когда вы вернётесь к снимку.' })]),
      el('div', { class: 'dim small pad', text: 'Сравнение рисует историю выбранной ветки второй линией на больших графиках (клик по показателю справа).' }),
    );
  }

  onChange(() => {
    listBtn.textContent = `Снимки (${app.snapshots.length})`;
    cmpChip.hidden = !app.compare;
    if (app.compare) {
      cmpChip.replaceChildren(`Сравнение: ${app.compare.name} `, el('button', { class: 'x', text: '×', title: 'Выключить сравнение', onclick: () => setCompare(null, app.compare.id) }));
    }
    if (!pop.classList.contains('hidden')) fill();
  });
  listBtn.textContent = `Снимки (${app.snapshots.length})`;

  function openNew() {
    let preset = app.lastOpts.preset;
    const seed = el('input', { type: 'number', value: app.lastOpts.seed, step: 1 });
    const opts = PRESET_LIST.map(([id, label, desc]) => {
      const r = el('input', { type: 'radio', name: 'preset', value: id, checked: id === preset, onchange: () => { preset = id; } });
      return el('label', { class: 'preset' }, r, el('span', {}, el('b', { text: label }), el('small', { class: 'dim', text: desc })));
    });
    let m;
    // соседи: до трёх стран с разным строем (набор рычагов из готовых); «нет» — страна живёт одна
    const NB_DEFAULT = ['minarchy', 'planned', 'socdem'];
    const prevNb = app.lastOpts.neighbors || NB_DEFAULT;
    const nbSel = [0, 1, 2].map(i => el('select', { 'aria-label': 'Сосед ' + (i + 1) },
      el('option', { value: '', text: 'нет соседа', selected: !prevNb[i] }),
      ...POLICY_PRESETS.map(p => el('option', { value: p.id, text: p.label, selected: prevNb[i] === p.id }))));
    const go = el('button', { class: 'btn primary', text: 'Создать страну', onclick: () => {
      const sd = Math.floor(Number(seed.value));
      newCountry({ preset, seed: Number.isFinite(sd) ? sd : 1, neighbors: nbSel.map(s => s.value).filter(Boolean) });
      m.close();
    } });
    const dice = el('button', { class: 'btn small', text: 'Случайное', onclick: () => { seed.value = Math.floor(Math.random() * 1e6); } });
    m = openModal('Новая страна', el('div', { class: 'newgame' },
      el('div', { class: 'presets' }, ...opts),
      el('label', { class: 'row gap' }, 'Seed', seed, dice),
      el('div', { class: 'nb-pick' }, el('div', { class: 'dim small', text: 'Соседи: считаются тем же движком, строй не меняют. Торговля, капитал, люди и технологии идут через границу.' }), ...nbSel),
      el('div', { class: 'dim small', text: 'Текущая страна будет заменена. Снимки останутся.' }),
      go));
  }
}
