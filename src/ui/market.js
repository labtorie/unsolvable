// «Рынок»: карточка на отрасль, фирмы — кружки (площадь ∝ доля рынка, цвет по собственнику).
import { INDUSTRIES } from '../sim/schema.js';
import { el, svg, setText, fmtPct, fmtNum, fmtCompact, num, OWNER_COLORS, OWNER_LABELS } from './util.js';

const VW = 200, VH = 112, R_FULL = 50, R_MIN = 3, GAP = 1.5;

function concentration(hhi) {
  if (hhi < 0.15) return ['конкуренция', 'c0'];
  if (hhi < 0.4) return ['олигополия', 'c1'];
  if (hhi < 0.7) return ['доминирование', 'c2'];
  return ['монополия', 'c3'];
}

// Устойчивая раскладка: кружки не пересобираются с нуля, а слегка раздвигаются из прежних мест.
// Маленькое изменение долей даёт маленькое смещение; порядок обхода фиксирован, случайности нет.
function relax(ns) {
  const cx = VW / 2, cy = VH / 2;
  for (let it = 0; it < 90; it++) {
    const pull = it < 70 ? 0.03 : 0;                       // под конец только расталкиваем
    for (const a of ns) { a.x += (cx - a.x) * pull; a.y += (cy - a.y) * pull * 1.6; }
    for (let i = 0; i < ns.length; i++) for (let j = i + 1; j < ns.length; j++) {
      const a = ns[i], b = ns[j];
      let dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
      const min = a.r + b.r + GAP;
      if (d >= min) continue;
      if (d < 1e-4) { const ang = (i * 2.4 + j * 1.3); dx = Math.cos(ang); dy = Math.sin(ang); d = 1; }
      const push = (min - d) / d, wa = (b.r * b.r) / (a.r * a.r + b.r * b.r);   // крупный двигается меньше
      a.x -= dx * push * wa; a.y -= dy * push * wa;
      b.x += dx * push * (1 - wa); b.y += dy * push * (1 - wa);
    }
    for (const a of ns) {
      a.x = Math.min(VW - a.r, Math.max(a.r, a.x));
      a.y = Math.min(VH - a.r, Math.max(a.r, a.y));
    }
  }
}

// Место для новой фирмы: ближайшее к центру свободное по спирали (детерминированно).
function findSpot(r, others) {
  for (let d = 0; d <= 130; d += 3) {
    const steps = d === 0 ? 1 : Math.max(10, Math.round(d / 3));
    for (let k = 0; k < steps; k++) {
      const a = (k / steps) * Math.PI * 2 + d * 0.37;
      const x = VW / 2 + Math.cos(a) * d * 1.25, y = VH / 2 + Math.sin(a) * d * 0.6;
      if (x - r < 0 || x + r > VW || y - r < 0 || y + r > VH) continue;
      if (others.every(p => Math.hypot(p.x - x, p.y - y) >= p.r + r + GAP)) return { x, y };
    }
  }
  return { x: VW / 2, y: VH / 2 };
}

export function createMarket(root) {
  const grid = el('div', { class: 'market-grid' });
  root.append(grid);
  const popup = el('div', { class: 'firm-pop hidden' });
  document.body.append(popup);
  let popId = null, lastWorld = null;

  const cards = new Map();
  for (const ind of INDUSTRIES) {
    const tag = el('span', { class: 'tag' }), short = el('span', { class: 'tag short', hidden: true });
    const price = el('b'), count = el('b');
    const canvas = svg('svg', { class: 'bubbles', viewBox: `0 0 ${VW} ${VH}`, preserveAspectRatio: 'xMidYMid meet' });
    const card = el('div', { class: 'mcard' },
      el('div', { class: 'mc-name', text: ind.label }),
      el('div', { class: 'mc-tags' }, tag, short),
      el('div', { class: 'mc-sub' }, el('span', {}, 'цена ', price), el('span', {}, 'фирм ', count)),
      canvas);
    grid.append(card);
    cards.set(ind.id, { ind, tag, short, price, count, canvas, nodes: new Map(), sig: '' });
  }

  // ── анимация ──
  let anim = false;
  function tick() {
    let moving = false;
    for (const c of cards.values()) {
      for (const [id, n] of c.nodes) {
        const k = 0.2;
        n.x += (n.tx - n.x) * k; n.y += (n.ty - n.y) * k; n.r += (n.tr - n.r) * k;
        if (Math.abs(n.tx - n.x) < 0.05 && Math.abs(n.ty - n.y) < 0.05 && Math.abs(n.tr - n.r) < 0.05) { n.x = n.tx; n.y = n.ty; n.r = n.tr; }
        else moving = true;
        if (n.dying && n.r < 0.4) { n.circle.remove(); c.nodes.delete(id); continue; }
        n.circle.setAttribute('cx', n.x.toFixed(2)); n.circle.setAttribute('cy', n.y.toFixed(2)); n.circle.setAttribute('r', Math.max(0, n.r).toFixed(2));
      }
    }
    if (moving) requestAnimationFrame(tick); else anim = false;
  }
  const kick = () => { if (!anim) { anim = true; requestAnimationFrame(tick); } };

  function showPopup(firmId, ev) {
    popId = firmId;
    fillPopup();
    popup.classList.remove('hidden');
    if (ev) {
      const w = 260, h = popup.offsetHeight || 260;
      popup.style.left = Math.max(8, Math.min(innerWidth - w - 8, ev.clientX + 12)) + 'px';
      popup.style.top = Math.max(8, Math.min(innerHeight - h - 8, ev.clientY + 12)) + 'px';
    }
  }
  function hidePopup() { popId = null; popup.classList.add('hidden'); }
  document.addEventListener('mousedown', e => { if (!popup.contains(e.target) && !e.target.closest?.('.bubbles circle')) hidePopup(); });
  window.addEventListener('keydown', e => { if (e.key === 'Escape') hidePopup(); });

  function fillPopup() {
    const f = lastWorld?.firms?.find(x => x.id === popId);
    if (!f) { popup.replaceChildren(el('div', { class: 'dim', text: 'Фирмы больше нет.' })); return; }
    const staff = Object.values(f.employees || {}).reduce((a, b) => a + num(b), 0);
    const ind = INDUSTRIES.find(i => i.id === f.industry);
    const kv = (k, v) => el('div', { class: 'kv' }, el('span', { text: k }), el('b', { text: v }));
    popup.replaceChildren(
      el('div', { class: 'fp-head' }, el('i', { style: { background: OWNER_COLORS[f.owner] || '#999' } }), el('b', { text: f.name || `Фирма №${f.id}` }),
        el('button', { class: 'btn ghost small', text: '×', onclick: hidePopup })),
      el('div', { class: 'dim small', text: `${ind?.label || f.industry} · ${OWNER_LABELS[f.owner] || f.owner}${f.alive === false ? ' · закрыта' : ''}` }),
      kv('Доля рынка', fmtPct(f.marketShare, 1)), kv('Цена', fmtNum(f.price, 2)), kv('Наценка', fmtPct(f.markup, 0)),
      kv('Прибыль (мес.)', fmtCompact(f.profit)), kv('Работники', fmtNum(staff, 0)), kv('Капитал', fmtCompact(f.capital)), kv('Долг', fmtCompact(f.debt)),
      kv('Возраст', fmtNum(Math.max(0, num(lastWorld.t) - num(f.bornT)), 0) + ' мес.'),
      el('div', { class: 'fp-acq' }, el('span', { class: 'dim small', text: 'Поглощены:' }),
        (f.acquired?.length) ? el('ul', {}, ...f.acquired.slice(-12).map(n => el('li', { text: n }))) : el('span', { class: 'dim small', text: ' никто' })),
    );
  }

  return function render(world) {
    lastWorld = world;
    const byInd = {};
    for (const f of world.firms || []) if (f.alive !== false) (byInd[f.industry] ||= []).push(f);
    for (const c of cards.values()) {
      const live = byInd[c.ind.id] || [];
      const m = world.markets?.[c.ind.id] || {};
      const sumShare = live.reduce((a, f) => a + num(f.marketShare), 0);
      const shareOf = f => (sumShare > 0 ? num(f.marketShare) : live.length ? 1 / live.length : 0);
      const hhi = m.hhi != null ? num(m.hhi) : live.reduce((a, f) => a + shareOf(f) ** 2, 0);
      const [label, cls] = live.length ? concentration(hhi) : ['нет фирм', 'c0'];
      setText(c.tag, label); c.tag.className = 'tag ' + cls;
      c.tag.title = `HHI ${fmtNum(hhi, 2)}`;
      const price = m.price != null && num(m.price) > 0 ? num(m.price) : live.reduce((a, f) => a + num(f.price) * shareOf(f), 0);
      setText(c.price, fmtNum(price, 2)); setText(c.count, live.length);
      const sh = num(m.shortage);
      c.short.hidden = !(sh > 0);
      if (sh > 0) setText(c.short, 'дефицит ' + fmtPct(sh, 0));

      const items = live.map(f => ({ id: f.id, r: Math.max(R_MIN, R_FULL * Math.sqrt(Math.min(1, shareOf(f)))), f }));
      const sig = items.map(i => i.id + ':' + Math.round(i.r * 2)).join(',');
      const fresh = [];
      for (const it of items) {
        let n = c.nodes.get(it.id);
        if (!n) {
          const circle = svg('circle', { cx: VW / 2, cy: VH / 2, r: 0, class: 'bub' });
          circle.addEventListener('click', e => showPopup(it.id, e));
          circle.append(svg('title', {}, ''));
          c.canvas.append(circle);
          n = { circle, x: VW / 2, y: VH / 2, r: 0, tx: VW / 2, ty: VH / 2, tr: 0, dying: false };
          c.nodes.set(it.id, n);
          fresh.push(it.id);
        }
        n.dying = false;
        n.circle.setAttribute('fill', OWNER_COLORS[it.f.owner] || '#999');
        n.circle.firstChild.textContent = `${it.f.name || '#' + it.id} — ${fmtPct(it.f.marketShare, 1)}`;
        n.tr = it.r;
      }
      const liveIds = new Set(items.map(i => i.id));
      for (const [id, n] of c.nodes) if (!liveIds.has(id)) { n.dying = true; n.tr = 0; }

      // Раскладку трогаем только когда состав или размеры заметно изменились, и всегда от прежних мест.
      if (sig !== c.sig) {
        c.sig = sig;
        const ns = [];
        const sorted = items.slice().sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);   // порядок не зависит от размеров
        for (const it of sorted) {
          const n = c.nodes.get(it.id);
          if (fresh.includes(it.id)) { const p = findSpot(it.r, ns); n.tx = p.x; n.ty = p.y; n.x = p.x; n.y = p.y; }
          ns.push({ id: it.id, x: n.tx, y: n.ty, r: it.r });
        }
        relax(ns);
        for (const p of ns) { const n = c.nodes.get(p.id); n.tx = p.x; n.ty = p.y; }
      }
    }
    kick();
    if (popId != null) fillPopup();
  };
}
