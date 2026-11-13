// Сборка интерфейса. Источник симуляции выбирает state.js.
import { app, init, onChange, addRenderer, requestRender, toggleRunning, setSpeed, SPEEDS, stepOnce } from './state.js';
import { el, fmtDate, setText } from './util.js';
import { createLevers } from './levers.js';
import { createStreet } from './street.js';
import { createMarket } from './market.js';
import { createPanel } from './panel.js';
import { createSnapshotUi } from './snapshots.js';
import { createProfessions, recordProfessions } from './professions.js';
import { createTechTab } from './techtab.js';
import { createOwnership } from './ownership.js';
import { createFlows } from './flows.js';
import { createMail } from './mail.js';
import { createJournal } from './journal.js';
import { createNeighborsTab } from './neighbors.js';
import { openAssumptions, changedAssumptions } from './assumptions.js';
import { POLICY_PRESETS, PRESET_GROUPS, applyPreset } from '../sim/presets.js';

const $ = id => document.getElementById(id);

// Вкладки центральной области. Вторая волна добавит сюда «Потоки», «Почту» и т. д. через addCenterTab.
const centerTabs = [];
const tabRenders = [];   // [id, root, render]: перерисовываем только видимую вкладку
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

  const mk = () => el('div', { class: 'pane-scroll' });
  const flowsRoot = mk(), profRoot = mk(), techRoot = mk(), ownRoot = mk(), mailRoot = mk(), jrRoot = mk(), nbRoot = mk();
  const flowsRender = createFlows(flowsRoot);
  const profRender = createProfessions(profRoot);
  const techRender = createTechTab(techRoot);
  const ownRender = createOwnership(ownRoot);
  const mailRender = createMail(mailRoot);
  const jrRender = createJournal(jrRoot);
  const nbRender = createNeighborsTab(nbRoot);
  tabRenders.push(
    ['flows', flowsRoot, flowsRender], ['professions', profRoot, profRender], ['tech', techRoot, techRender], ['ownership', ownRoot, ownRender], ['mail', mailRoot, mailRender], ['journal', jrRoot, jrRender], ['neighbors', nbRoot, nbRender]);

  addCenterTab({ id: 'market', label: 'Рынок', root: marketRoot });
  addCenterTab({ id: 'flows', label: 'Потоки', root: flowsRoot });
  addCenterTab({ id: 'professions', label: 'Профессии', root: profRoot });
  addCenterTab({ id: 'tech', label: 'Технологии', root: techRoot });
  addCenterTab({ id: 'ownership', label: 'Кто кем владеет', root: ownRoot });
  const mailBtn = addCenterTab({ id: 'mail', label: 'Почта', root: mailRoot });
  addCenterTab({ id: 'journal', label: 'Журнал', root: jrRoot });
  addCenterTab({ id: 'neighbors', label: 'Соседи', root: nbRoot });
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
  addRenderer(function renderTabs(w) {
    recordProfessions(w);   // история зарплат копится, даже когда вкладка закрыта
    for (const [, root, render] of tabRenders) if (!root.hidden) render(w);
  });
  addRenderer(function renderMailBadge(w) {
    const n = w.mail?.inbox?.length || 0;
    const label = n ? `Почта (${n})` : 'Почта';
    if (mailBtn.textContent !== label) mailBtn.textContent = label;
    mailBtn.classList.toggle('has-mail', n > 0);
  });
  const assump = $('assump');
  assump.onclick = () => openAssumptions();
  addRenderer(function renderAssump() {
    const n = changedAssumptions();
    setText(assump, n ? `Допущения (${n})` : 'Допущения');
    assump.classList.toggle('on', n > 0);
  });

  // для проверки из консоли
  globalThis.Unsolvable.step = stepOnce;
  requestRender();
  speedBtns[0].classList.add('on');
}

init().then(boot).catch(e => {
  console.error(e);
  document.body.append(el('pre', { class: 'fatal', text: 'Не удалось запустить: ' + (e?.stack || e) }));
});
