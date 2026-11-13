// Правая колонка: строй, компас, показатели со спарклайнами, лента событий.
import { el, svg, setText, fmtPct, fmtDate, num, clamp } from './util.js';
import { METRICS } from './metrics.js';
import { makeSparkline, openBigChart } from './charts.js';
import { createWhy } from './why.js';

const C = 150, R = 64, TRAIL = 60;

function compass() {
  const root = svg('svg', { class: 'compass', viewBox: `0 0 ${C} ${C}`, width: C, height: C });
  const m = C / 2;
  root.append(
    svg('rect', { x: m - R, y: m - R, width: R * 2, height: R * 2, class: 'cp-bg' }),
    svg('line', { x1: m - R, x2: m + R, y1: m, y2: m, class: 'cp-axis' }),
    svg('line', { x1: m, x2: m, y1: m - R, y2: m + R, class: 'cp-axis' }),
    svg('text', { x: m - R + 3, y: m - 3, class: 'cp-lab', text: 'рынок' }),
    svg('text', { x: m + R - 3, y: m - 3, class: 'cp-lab', 'text-anchor': 'end', text: 'государство' }),
    svg('text', { x: m + 3, y: m - R + 10, class: 'cp-lab', text: 'авторитаризм' }),
    svg('text', { x: m + 3, y: m + R - 4, class: 'cp-lab', text: 'свободы' }),
  );
  const segs = Array.from({ length: TRAIL }, () => svg('line', { class: 'cp-trail' }));
  const dot = svg('circle', { r: 5, class: 'cp-dot' });
  root.append(...segs, dot);
  root.update = (x, y, hx, hy) => {
    const P = (a, b) => [m + clamp(a, -1, 1) * R, m - clamp(b, -1, 1) * R];
    const n = Math.min(TRAIL, hx.length, hy.length);
    for (let i = 0; i < TRAIL; i++) {
      const s = segs[i], k = n - TRAIL + i;   // k-й с конца
      if (k < 1) { s.setAttribute('opacity', 0); continue; }
      const idx = hx.length - n + k;
      const [x1, y1] = P(hx[idx - 1], hy[idx - 1]), [x2, y2] = P(hx[idx], hy[idx]);
      s.setAttribute('x1', x1); s.setAttribute('y1', y1); s.setAttribute('x2', x2); s.setAttribute('y2', y2);
      s.setAttribute('opacity', (0.15 + 0.85 * (i / TRAIL)).toFixed(2));
    }
    const [dx, dy] = P(x, y);
    dot.setAttribute('cx', dx); dot.setAttribute('cy', dy);
  };
  return root;
}

export function createPanel(statusRoot, feedRoot) {
  const why = createWhy();
  // Строй
  const label = el('div', { class: 'regime-label' });
  const defacto = el('div', { class: 'regime-defacto' });
  const mods = el('div', { class: 'chips' });
  const arch = el('div', { class: 'arch' });
  const cp = compass();
  statusRoot.append(
    el('section', { class: 'card' }, el('h2', { text: 'Строй' }), label, defacto, mods,
      el('div', { class: 'regime-row' }, arch, cp)),
  );

  // Показатели
  const list = el('div', { class: 'metrics' });
  const rows = METRICS.map(m => {
    const val = el('span', { class: 'm-val' });
    const spark = makeSparkline();
    const q = el('button', { class: 'why-btn', text: '?', title: 'Почему?', 'aria-label': 'Почему: ' + m.label,
      onclick: e => { e.stopPropagation(); why.toggle(m.id, m.label, e.currentTarget); } });
    const row = el('div', { class: 'metric', role: 'button', tabindex: 0, title: 'Показать большой график', onclick: () => openBigChart(m.id),
      onkeydown: e => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); openBigChart(m.id); } } },
      el('span', { class: 'm-name', text: m.label }), val, spark, q);
    list.append(row);
    return { m, val, spark };
  });
  statusRoot.append(el('section', { class: 'card' }, el('h2', { text: 'Показатели' }), list));

  // Лента
  const feed = el('div', { class: 'feed' });
  feedRoot.append(el('h2', { class: 'feed-h', text: 'Лента событий' }), feed);
  let feedSig = '';

  return function render(world) {
    const rg = world.regime || {};
    setText(label, rg.label || 'Строй не определён');
    // defacto задан, когда результат расходится с законами; строй по закону лежит в lawLabel.
    const dfText = rg.defacto ? (rg.lawLabel || rg.top?.[0]?.label || '') : '';
    defacto.hidden = !dfText;
    if (dfText) setText(defacto, 'по закону: ' + dfText);
    const modKey = (rg.modifiers || []).join('|');
    if (mods.dataset.k !== modKey) {
      mods.dataset.k = modKey;
      mods.replaceChildren(...(rg.modifiers || []).map(t => el('span', { class: 'chip', text: typeof t === 'string' ? t : t?.label || '' })));
    }
    const top = (rg.top || []).slice(0, 3);
    const aKey = top.map(t => t.label + Math.round(num(t.score) * 100)).join('|');
    if (arch.dataset.k !== aKey) {
      arch.dataset.k = aKey;
      arch.replaceChildren(el('div', { class: 'dim small', text: 'близость к архетипам' }), ...(top.length ? top.map(t => el('div', { class: 'arch-row' },
        el('span', { class: 'arch-name', text: t.label || t.id }),
        el('span', { class: 'arch-bar' }, el('i', { style: { width: clamp(num(t.score), 0, 1) * 100 + '%' } })),
        el('b', { text: Math.round(num(t.score) * 100) + '%' }))) : [el('span', { class: 'dim small', text: 'нет данных' })]));
    }
    const hs = world.history?.series || {};
    cp.update(num(rg.compass?.x), num(rg.compass?.y), hs.compassX || [], hs.compassY || []);

    why.update(world);
    for (const r of rows) {
      let cur = r.m.cur(world);
      const series = r.m.series(world.history);
      if (!Number.isFinite(cur)) cur = series.length ? series[series.length - 1] : 0;
      setText(r.val, r.m.fmt(cur));
      r.spark.update(series);
    }

    // события: новые сверху
    const ev = world.events || [];
    const sig = ev.length + ':' + (ev[ev.length - 1]?.text || '') + ':' + (ev[ev.length - 1]?.t ?? '');
    if (sig !== feedSig) {
      feedSig = sig;
      const sorted = ev.slice().reverse().sort((a, b) => num(b.t) - num(a.t)).slice(0, 120);
      feed.replaceChildren(...(sorted.length ? sorted.map(e => el('div', { class: 'ev ' + (e.type || '') },
        el('span', { class: 'ev-t', text: fmtDate(e.t) }), el('span', { class: 'ev-x', text: e.text || '' })))
        : [el('div', { class: 'dim small pad', text: 'Пока тишина. Это ненадолго.' })]));
    }
  };
}
