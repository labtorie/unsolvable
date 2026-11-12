// Сборка интерфейса. Источник симуляции выбирает state.js.
import { app, init, onChange, addRenderer, requestRender, toggleRunning, setSpeed, SPEEDS, stepOnce } from './state.js';
import { el, fmtDate, setText } from './util.js';
import { createLevers } from './levers.js';
import { createStreet } from './street.js';
import { createMarket } from './market.js';
import { createPanel } from './panel.js';
import { createSnapshotUi } from './snapshots.js';
import { POLICY_PRESETS, PRESET_GROUPS, applyPreset } from '../sim/presets.js';

const $ = id => document.getElementById(id);

// Вкладки центральной области. Вторая волна добавит сюда «Потоки», «Почту» и т. д. через addCenterTab.
const centerTabs = [];
function addCenterTab({ id, label, root, render, soon }) {
  const btn = el('button', { class: 'tab' + (soon ? ' soon' : ''), text: label, disabled: !!soon, title: soon ? 'Скоро' : label,
    onclick: () => select(id) });
  $('center-tabs').append(btn);
  root.hidden = true;
  $('center-panes').append(root);
  centerTabs.push({ id, btn, root, render });
  return btn;
}
function select(id) {
  for (const t of centerTabs) { t.btn.classList.toggle('active', t.id === id); t.root.hidden = t.id !== id; }
  requestRender();
}
globalThis.Unsolvable = { app, addCenterTab, selectCenterTab: select };

async function boot() {
  // Готовые наборы рычагов: строи, страны, крайности.
  const presetSel = el('select', { class: 'preset-sel', 'aria-label': 'Готовый набор рычагов' },
    el('option', { value: '', text: 'Готовый набор…' }),
    ...PRESET_GROUPS.map(g => el('optgroup', { label: g.label },
      ...POLICY_PRESETS.filter(p => p.group === g.id).map(p => el('option', { value: p.id, text: p.label })))));
  const presetNote = el('div', { class: 'dim small preset-note', text: 'Выставляет все рычаги разом. Страна остаётся прежней — меняется только политика.' });
  const presetBtn = el('button', { class: 'btn small', text: 'Применить', disabled: true, onclick: () => {
    if (!presetSel.value || !app.world) return;
    applyPreset(app.world, presetSel.value);
    requestRender();
  } });
  presetSel.onchange = () => {
    const p = POLICY_PRESETS.find(x => x.id === presetSel.value);
    presetBtn.disabled = !p;
    setText(presetNote, p ? p.note : 'Выставляет все рычаги разом. Страна остаётся прежней — меняется только политика.');
  };
  $('levers').append(el('div', { class: 'preset-box' }, el('div', { class: 'preset-row' }, presetSel, presetBtn), presetNote));

  const leversRender = createLevers($('levers'));
  const streetRender = createStreet($('street'));
  const marketRoot = el('div', { class: 'pane-scroll' });
  const marketRender = createMarket(marketRoot);
  const panelRender = createPanel($('status'), $('feed'));

  addCenterTab({ id: 'market', label: 'Рынок', root: marketRoot });
  for (const [id, label] of [['flows', 'Потоки'], ['mail', 'Почта'], ['professions', 'Профессии'], ['ownership', 'Кто кем владеет'], ['neighbors', 'Соседи']]) {
    addCenterTab({ id, label, root: el('div'), soon: true });
  }
  select('market');

  createSnapshotUi($('snapbar'));

  // время
  const play = $('play');
  play.onclick = toggleRunning;
  const speedBtns = SPEEDS.map(s => el('button', { class: 'seg-btn', text: '×' + s, onclick: () => setSpeed(s) }));
  $('speeds').append(...speedBtns);
  window.addEventListener('keydown', e => {
    if (e.code !== 'Space' || e.repeat) return;
    const t = e.target;
    if (t.closest?.('input:not([type=range]):not([type=checkbox]):not([type=radio]), select, textarea')) return;
    e.preventDefault();
    toggleRunning();
  });

  onChange(() => {
    play.textContent = app.running ? 'Пауза' : 'Пуск';
    play.classList.toggle('running', app.running);
    speedBtns.forEach((b, i) => b.classList.toggle('on', SPEEDS[i] === app.speed));
    const er = $('error'); er.hidden = !app.error; er.textContent = app.error;
    requestRender();
  });

  setText($('source'), 'симуляция: ' + app.simName + (app.simNote ? ` (${app.simNote})` : ''));
  $('source').title = app.simNote || '';

  addRenderer(function renderTime(w) { setText($('date'), fmtDate(w.t)); });
  addRenderer(function renderLevers(w) { leversRender(w); });
  addRenderer(function renderStreet(w) { streetRender(w); });
  addRenderer(function renderMarket(w) { if (!marketRoot.hidden) marketRender(w); });
  addRenderer(function renderPanel(w) { panelRender(w); });

  // для проверки из консоли
  globalThis.Unsolvable.step = stepOnce;
  requestRender();
  speedBtns[0].classList.add('on');
}

init().then(boot).catch(e => {
  console.error(e);
  document.body.append(el('pre', { class: 'fatal', text: 'Не удалось запустить: ' + (e?.stack || e) }));
});
