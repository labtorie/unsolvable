// Вкладка «Почта»: обращения к власти (GDD §7). Принять — рычаг меняется сразу; отказать или промолчать — и если в письме угроза,
// проситель выполнит её через обычные механизмы модели.
import { app, requestRender } from './state.js';
import { el, fmtDate, fmtCompact, fmtPct, fmtNum, num, setText } from './util.js';
import { acceptLetter, refuseLetter, bribeFor } from '../sim/mailbox.js';

const TYPE = { class: 'группа', union: 'профсоюз', lobby: 'отраслевое лобби', corp: 'крупная фирма', smallbiz: 'малый бизнес', bank: 'банки', fin: 'финансисты' };
const STATUS = { accepted: ['принято', 'ok'], refused: ['отказано', 'bad'], expired: ['без ответа', 'warn'], solved: ['решилось само', ''] };

function senderLine(s) {
  const bits = [TYPE[s.type] || s.type];
  if (s.people > 0) bits.push(`${fmtCompact(s.people)} чел.`);
  if (s.share > 0) bits.push(`${fmtPct(s.share, s.share < 0.1 ? 1 : 0)} ${s.shareOf || ''}`);
  return bits.join(' · ');
}

function threatLine(L) {
  const t = L.threat;
  if (!t) return null;
  const st = { open: '', waiting: ' — срок на раздумье идёт', executed: ' — исполнено', fizzled: ' — не вышло', spared: ' — снято' }[t.state] || '';
  return el('div', { class: 'ml-row threat' }, el('b', { text: 'Угрожают: ' }), `${t.text}${st}`);
}

function costLine(world, L) {
  const bits = [];
  if (L.monthly != null && Math.abs(L.monthly) >= 1) {
    const gdp = Math.max(1, num(world.stats?.gdp));
    bits.push(L.monthly > 0 ? `бюджету: −${fmtCompact(L.monthly)} в мес. (${fmtPct(L.monthly / gdp, 2)} ВВП)` : `бюджету: +${fmtCompact(-L.monthly)} в мес.`);
  }
  const b = bribeFor(world, L);
  if (b > 0) bits.push(`коррупция ${fmtPct(world.gov.corruption, 0)}: «согласование» обойдётся казне ещё в ~${fmtCompact(b)} разово`);
  return bits.length ? el('div', { class: 'ml-row cost' }, el('b', { text: 'Цена: ' }), bits.join('; ')) : null;
}

function card(world, L) {
  const left = Math.max(0, L.expires - world.t);
  const btns = el('div', { class: 'ml-btns' },
    el('button', { class: 'btn ok', text: 'Принять', title: 'Рычаг изменится сразу', onclick: () => { acceptLetter(app.world, L.id); requestRender(); } }),
    el('button', { class: 'btn', text: 'Отказать', onclick: () => { refuseLetter(app.world, L.id); requestRender(); } }),
    el('span', { class: 'dim small', text: `Не отвечать — тоже выбор: письмо истечёт через ${left} мес.` + (L.threat ? ' и будет прочитано как отказ.' : '.') }));
  return el('div', { class: 'letter' + (L.threat ? ' has-threat' : '') },
    el('div', { class: 'ml-head' }, el('b', { text: L.sender.name }), el('span', { class: 'dim small', text: senderLine(L.sender) }),
      el('span', { class: 'grow' }), el('span', { class: 'dim small', text: `${fmtDate(L.t)} · осталось ${left} мес.` })),
    el('div', { class: 'ml-title', text: L.title }),
    el('div', { class: 'ml-ask' }, el('b', { text: 'Просят: ' }), L.ask.text),
    el('div', { class: 'ml-row' }, el('b', { text: 'Заявлено: ' }), L.stated),
    el('div', { class: 'ml-row calc' }, el('b', { text: 'Расчёт: ' }), L.real),
    threatLine(L),
    L.promise ? el('div', { class: 'ml-row' }, el('b', { text: 'Обещают: ' }), `в случае согласия — ${L.promise.text}`) : null,
    el('div', { class: 'ml-row' }, el('b', { text: 'Кто заплатит: ' }), L.payer),
    costLine(world, L),
    btns);
}

function archiveRow(L) {
  const [label, cls] = STATUS[L.status] || [L.status, ''];
  return el('div', { class: 'ml-arch' },
    el('span', { class: 'dim small', text: fmtDate(L.closedT ?? L.t) }),
    el('span', {}, el('b', { text: L.sender.name }), ' — ', L.title),
    el('span', { class: 'tag ' + cls, text: label }),
    el('div', { class: 'dim small ml-out', text: [L.ask.text, L.outcome].filter(Boolean).join(' · ') }));
}

export function createMail(root) {
  const stats = el('div', { class: 'dim small' });
  const enable = el('input', { type: 'checkbox', checked: true, onchange: e => { if (app.world?.mail) app.world.mail.enabled = e.target.checked; requestRender(); } });
  const inbox = el('div', { class: 'ml-list' });
  const archive = el('div', { class: 'ml-list' });
  const empty = el('div', { class: 'empty' }, el('b', { text: 'Писем нет' }), 'Пока всем всё равно или все довольны. Это быстро проходит.');
  const unsupported = el('div', { class: 'empty', hidden: true }, el('b', { text: 'Почта недоступна' }), 'Эта симуляция не ведёт обращений к власти (запущен мок).');
  root.append(
    el('div', { class: 'sect-head' }, el('h2', { text: 'Обращения к власти' }), stats, el('span', { class: 'grow' }),
      el('label', { class: 'dim small' }, enable, ' принимать письма')),
    unsupported, empty, inbox,
    el('h2', { class: 'sub-h', text: 'Архив' }), archive);
  let sig = '';
  return function render(world) {
    const m = world.mail;
    unsupported.hidden = !!(m && Array.isArray(m.inbox));
    if (unsupported.hidden === false) { empty.hidden = true; return; }
    const s2 = [world.seed, world.t, m.nextId, m.inbox.length, m.archive.length, Math.round((world.gov?.corruption || 0) * 100), m.enabled, m.pending?.length].join(':');
    if (s2 === sig) return;
    sig = s2;
    enable.checked = m.enabled !== false;
    const st = m.stats || {};
    setText(stats, `получено ${st.received || 0} · принято ${st.accepted || 0} · отказано ${st.refused || 0} · угроз исполнено ${st.executed || 0}`);
    empty.hidden = m.inbox.length > 0;
    inbox.replaceChildren(...m.inbox.map(L => card(world, L)));
    archive.replaceChildren(...(m.archive.length ? m.archive.slice(0, 25).map(archiveRow) : [el('div', { class: 'dim small pad', text: 'Пока пусто.' })]));
  };
}
