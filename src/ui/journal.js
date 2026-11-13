// Вкладка «Журнал»: явления, которые игра узнала по показателям (GDD §10). Открытые сверху, затем история,
// затем «коллекция»: ещё не встречавшиеся явления показаны силуэтами с подсказкой-загадкой.
import { el, fmtDate, setText } from './util.js';
import { PHENOMENA_INFO, PHENOMENA_UNAVAILABLE } from '../sim/phenomena-info.js';

const dur = m => (m >= 12 ? `${Math.floor(m / 12)} г. ${m % 12 ? (m % 12) + ' мес.' : ''}` : `${m} мес.`);

function causesBlock(causes) {
  if (!causes?.length) return el('div', { class: 'dim small', text: 'Заметных отклонений рычагов от умолчаний нет: явление выросло из самой экономики.' });
  return el('ul', { class: 'jr-causes' }, ...causes.map(c =>
    el('li', {}, el('span', { text: c.label + ': ' }), el('b', { text: c.now }), el('span', { class: 'dim', text: ` (по умолчанию ${c.dflt})` }))));
}

function entryCard(e, now, closed) {
  const months = closed ? e.months : now - e.since;
  return el('div', { class: 'phen' + (closed ? ' closed' : ' open') },
    el('div', { class: 'ph-head' }, el('b', { text: e.name }),
      el('span', { class: 'dim small', text: closed ? `${fmtDate(e.since)} — ${fmtDate(e.to)} · ${dur(months)}` : `с ${fmtDate(e.since)} · идёт ${dur(months)}` })),
    el('ul', { class: 'jr-facts' }, ...(e.facts || []).map(f => el('li', { text: f }))),
    el('div', { class: 'dim small', text: 'Какие решения к этому привели:' }),
    causesBlock(e.causes));
}

export function createJournal(root) {
  const active = el('div', { class: 'ph-list' });
  const history = el('div', { class: 'ph-list' });
  const coll = el('div', { class: 'ph-grid' });
  const emptyA = el('div', { class: 'empty', text: 'Пока ничего примечательного. Страна живёт тихо — а значит, плохо изучена.' });
  const sum = el('div', { class: 'dim small' });
  root.append(el('div', { class: 'sect-head' }, el('h2', { text: 'Журнал явлений' }), sum),
    el('h2', { class: 'sub-h', text: 'Сейчас' }), emptyA, active,
    el('h2', { class: 'sub-h', text: 'История' }), history,
    el('h2', { class: 'sub-h', text: 'Коллекция' }), coll);
  let sig = '';
  return function render(world) {
    const P = world.phenomena;
    if (!P || !P.active) { setText(sum, 'Журнал недоступен: эта симуляция не распознаёт явления.'); return; }
    const act = Object.values(P.active);
    const s2 = [world.seed, world.t, act.length, P.log.length].join(':');
    if (s2 === sig) return;
    sig = s2;
    const seen = P.seen || {};
    const known = PHENOMENA_INFO.filter(i => seen[i.id]).length;
    setText(sum, `открыто в коллекции: ${known} из ${PHENOMENA_INFO.length + PHENOMENA_UNAVAILABLE.length}`);
    emptyA.hidden = act.length > 0;
    active.replaceChildren(...act.sort((a, b) => a.since - b.since).map(e => entryCard(e, world.t, false)));
    history.replaceChildren(...(P.log.length ? P.log.slice(0, 30).map(e => entryCard(e, world.t, true)) : [el('div', { class: 'dim small pad', text: 'Закрытых явлений пока нет.' })]));
    coll.replaceChildren(...PHENOMENA_INFO.map(i => seen[i.id]
      ? el('div', { class: 'ph-tile got' }, el('b', { text: i.name }), el('div', { class: 'dim small', text: `встречалось раз: ${seen[i.id]}` }), el('div', { class: 'small', text: i.riddle }))
      : el('div', { class: 'ph-tile sil' }, el('b', { text: '???' }), el('div', { class: 'dim small', text: 'ещё не удалось устроить' }), el('div', { class: 'small', text: i.riddle })),
    ).concat(PHENOMENA_UNAVAILABLE.map(i =>
      el('div', { class: 'ph-tile sil off' }, el('b', { text: '???' }), el('div', { class: 'dim small', text: 'в этой версии не распознаётся' }), el('div', { class: 'small', text: i.riddle })))));
  };
}
