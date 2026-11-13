// Вкладка «Технологии»: что изобретено, кто владеет, кто внедрил; карточки платформ.
import { el, fmtPct, fmtNum, fmtCompact, num, IND_LABELS, PROF_LABELS, TECH_KINDS, IND_COLORS } from './util.js';

const yearOf = t => 1 + Math.floor(num(t) / 12);

function ownerName(t, byId) {
  if (t.ownerFirmId != null) {
    const f = byId.get(t.ownerFirmId);
    return f ? (f.name || `Фирма №${f.id}`) + (f.alive === false ? ' (закрыта)' : '') : `закрытая фирма №${t.ownerFirmId}`;
  }
  return t.origin === 'foreign' ? 'из-за границы' : t.origin === 'state' ? 'госнаука' : 'неизвестен';
}
function targetText(t) {
  const ind = t.industry === '*' ? 'все отрасли' : (IND_LABELS[t.industry] || t.industry);
  const prof = t.profession ? PROF_LABELS[t.profession] || t.profession : null;
  let effect = '';
  if (t.kind === 'automation' || t.kind === 'gpt') effect = num(t.cut) > 0 ? `убирает ${fmtPct(t.cut, 0)} труда` : '';
  if (t.kind === 'productivity' || (t.kind === 'gpt' && num(t.prodGain) > 0)) effect += (effect ? ', ' : '') + `+${fmtPct(t.prodGain, 0)} отдачи`;
  if (t.kind === 'product') effect = 'новая строка в корзине';
  if (t.kind === 'platform') effect = 'комиссия с каждой сделки';
  return [ind, prof, effect].filter(Boolean).join(' · ');
}

export function createTechTab(root) {
  const summary = el('div', { class: 'dim small' });
  const platforms = el('div', { class: 'plat-grid' });
  const platHead = el('h2', { class: 'sub-h', text: 'Платформы' });
  const tbody = el('tbody');
  const empty = el('div', { class: 'empty', text: 'Пока ни одной технологии. Изобретатели думают.' });
  const table = el('table', { class: 'tbl' },
    el('thead', {}, el('tr', {}, ...['Технология', 'Вид', 'Владелец', 'Цель', 'Год', 'Патент до', 'Внедрили', 'Доля отрасли'].map((t, i) => el('th', { class: i >= 6 ? 'r' : '', text: t })))), tbody);
  root.append(
    el('div', { class: 'sect-head' }, el('h2', { text: 'Технологии' }), summary),
    platHead, platforms,
    el('h2', { class: 'sub-h', text: 'Все технологии (новые сверху)' }), table, empty);
  let sig = '';

  return function render(world) {
    const T = world.tech || {};
    const list = Array.isArray(T.list) ? T.list : [];
    const sig2 = world.seed + ':' + world.t + ':' + list.length;
    if (sig2 === sig) return;
    sig = sig2;
    const byId = new Map((world.firms || []).map(f => [f.id, f]));
    const live = (world.firms || []).filter(f => f.alive !== false);
    const liveCount = {}; for (const f of live) liveCount[f.industry] = (liveCount[f.industry] || 0) + 1;
    summary.textContent = `технологий: ${list.length} · вытеснено людей всего: ${fmtNum(num(T.displacedTotal), 0)} · расходы на исследования: ${fmtCompact(num(T.researchSpend))} в мес.`;

    // платформы
    const plats = live.filter(f => f.platform);
    platHead.hidden = platforms.hidden = false;
    platforms.replaceChildren(...(plats.length ? plats.map(f => {
      const p = f.platform;
      return el('div', { class: 'plat' },
        el('div', { class: 'plat-name' }, el('i', { class: 'dot', style: { background: IND_COLORS[p.industry] || '#999' } }), f.name || `Фирма №${f.id}`),
        el('div', { class: 'dim small', text: IND_LABELS[p.industry] || p.industry || '' }),
        el('div', { class: 'kv' }, el('span', { text: 'Доля рынка через платформу' }), el('b', { text: fmtPct(p.users, 0) })),
        el('div', { class: 'kv' }, el('span', { text: 'Комиссия' }), el('b', { text: fmtPct(p.fee, 0) })),
        el('div', { class: 'kv' }, el('span', { text: 'Подрядчиков' }), el('b', { text: fmtNum(num(p.gig), 0) })));
    }) : [el('div', { class: 'dim small pad', text: 'Платформ пока нет: между продавцами и покупателями никто не встал.' })]));

    empty.hidden = list.length > 0; table.hidden = !list.length;
    const rows = list.slice().sort((a, b) => num(b.bornT) - num(a.bornT) || num(b.id) - num(a.id));
    tbody.replaceChildren(...rows.map(t => {
      const ad = Array.isArray(t.adopters) ? t.adopters.length : 0;
      const pool = t.industry === '*' ? live.length : (liveCount[t.industry] || 0);
      const share = pool > 0 ? Math.min(1, ad / pool) : 0;
      const open = t.patentUntil == null || num(t.patentUntil) <= num(world.t);
      return el('tr', {},
        el('td', { class: 'strong', text: t.name || `Технология №${t.id}` }),
        el('td', {}, el('span', { class: 'tag k-' + t.kind, text: TECH_KINDS[t.kind] || t.kind })),
        el('td', { text: ownerName(t, byId) }),
        el('td', { class: 'small', text: targetText(t) }),
        el('td', { text: yearOf(t.bornT) }),
        el('td', { class: open ? 'dim' : '', text: open ? 'общая' : 'год ' + yearOf(t.patentUntil) }),
        el('td', { class: 'r', text: fmtNum(ad, 0) }),
        el('td', { class: 'r' }, el('span', { class: 'mini-bar' }, el('i', { style: { width: share * 100 + '%' } })), ' ' + fmtPct(share, 0)));
    }));
  };
}
