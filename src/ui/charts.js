// Спарклайны и большой график с наложением ветки для сравнения.
import { el, svg, openModal, fmtDate, num } from './util.js';
import { app } from './state.js';
import { METRICS, metricById } from './metrics.js';

export function makeSparkline(width = 96, height = 24) {
  const root = svg('svg', { class: 'spark', viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: 'none', width, height });
  const line = svg('polyline', { fill: 'none', 'stroke-width': 1.4, 'vector-effect': 'non-scaling-stroke' });
  const dot = svg('circle', { r: 2, class: 'spark-dot' });
  root.append(line, dot);
  let sig = '';
  root.update = (values, maxPoints = 120) => {
    const v = values.length > maxPoints ? values.slice(-maxPoints) : values;
    const s = v.length + ':' + (v[v.length - 1] ?? '') + ':' + (v[0] ?? '');
    if (s === sig) return;
    sig = s;
    if (v.length < 2) { line.setAttribute('points', ''); dot.setAttribute('r', 0); return; }
    let lo = Infinity, hi = -Infinity;
    for (const x of v) { if (x < lo) lo = x; if (x > hi) hi = x; }
    if (hi - lo < 1e-12) { lo -= 0.5; hi += 0.5; }
    const pts = v.map((x, i) => `${(i / (v.length - 1) * (width - 4) + 2).toFixed(1)},${(height - 3 - (x - lo) / (hi - lo) * (height - 6)).toFixed(1)}`);
    line.setAttribute('points', pts.join(' '));
    const [lx, ly] = pts[pts.length - 1].split(',');
    dot.setAttribute('cx', lx); dot.setAttribute('cy', ly); dot.setAttribute('r', 2);
  };
  return root;
}

// ── Большой график ──
const W = 820, H = 380, PL = 62, PR = 14, PT = 14, PB = 28;

function niceTicks(lo, hi, n = 5) {
  const span = hi - lo || 1;
  const raw = span / n, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map(k => k * mag).find(s => s >= raw) || mag;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(v);
  return out;
}

export function openBigChart(startId) {
  let metric = metricById(startId);
  const select = el('select', { onchange: () => { metric = metricById(select.value); draw(); } },
    ...METRICS.map(m => el('option', { value: m.id, text: m.label, selected: m.id === metric.id })));
  const legend = el('div', { class: 'legend' });
  const root = svg('svg', { class: 'bigchart', viewBox: `0 0 ${W} ${H}`, width: '100%' });
  const tip = el('div', { class: 'chart-tip hidden' });
  const wrap = el('div', { class: 'chart-wrap' }, root, tip);
  const note = el('div', { class: 'dim small' });
  const modal = openModal('График', el('div', {}, el('div', { class: 'row gap' }, select, legend), wrap, note), { wide: true, onClose: () => clearInterval(timer) });
  let timer = null;

  function series() {
    const w = app.world;
    const a = { t: w.history?.t || [], v: metric.series(w.history) };
    const c = app.compare ? { t: app.compare.history?.t || [], v: metric.series(app.compare.history) } : null;
    return { a, c };
  }

  function draw() {
    const { a, c } = series();
    root.replaceChildren();
    const all = [...a.v, ...(c ? c.v : [])].filter(Number.isFinite);
    const ts = [...a.t, ...(c ? c.t : [])];
    if (!all.length) { note.textContent = 'История пока пуста.'; return; }
    let lo = Math.min(...all), hi = Math.max(...all);
    if (hi - lo < 1e-12) { lo -= 0.5; hi += 0.5; }
    const pad = (hi - lo) * 0.06; lo -= pad; hi += pad;
    const t0 = Math.min(...ts), t1 = Math.max(...ts, t0 + 1);
    const X = t => PL + (t - t0) / (t1 - t0) * (W - PL - PR);
    const Y = v => H - PB - (v - lo) / (hi - lo) * (H - PT - PB);
    for (const v of niceTicks(lo, hi)) {
      root.append(svg('line', { x1: PL, x2: W - PR, y1: Y(v), y2: Y(v), class: 'grid' }),
        svg('text', { x: PL - 6, y: Y(v) + 4, class: 'axis', 'text-anchor': 'end', text: metric.fmt(v) }));
    }
    const years = Math.max(1, Math.round((t1 - t0) / 12 / 8));
    for (let yr = Math.ceil(t0 / 12); yr * 12 <= t1; yr += years) {
      root.append(svg('line', { x1: X(yr * 12), x2: X(yr * 12), y1: PT, y2: H - PB, class: 'grid v' }),
        svg('text', { x: X(yr * 12), y: H - 8, class: 'axis', 'text-anchor': 'middle', text: 'год ' + (yr + 1) }));
    }
    const path = (s, cls) => {
      const pts = s.t.map((t, i) => (Number.isFinite(s.v[i]) ? `${X(t).toFixed(1)},${Y(s.v[i]).toFixed(1)}` : null)).filter(Boolean);
      if (pts.length) root.append(svg('polyline', { points: pts.join(' '), class: cls, fill: 'none' }));
    };
    if (c) path(c, 'line-b');
    path(a, 'line-a');
    const cross = svg('line', { y1: PT, y2: H - PB, class: 'cross hidden' });
    root.append(cross);
    legend.replaceChildren(el('span', { class: 'key a', text: 'Текущая ветка' }), c ? el('span', { class: 'key b', text: 'Сравнение: ' + app.compare.name }) : null);
    note.textContent = c ? '' : 'Чтобы наложить вторую линию, выберите «Сравнить» у снимка в меню «Снимки».';

    root.onmousemove = e => {
      const r = root.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width * W;
      const t = t0 + (px - PL) / (W - PL - PR) * (t1 - t0);
      if (t < t0 || t > t1) { cross.classList.add('hidden'); tip.classList.add('hidden'); return; }
      const at = s => { let bi = -1, bd = 1e9; s.t.forEach((x, i) => { const d = Math.abs(x - t); if (d < bd) { bd = d; bi = i; } }); return bd <= 1 && bi >= 0 ? s.v[bi] : null; };
      const va = at(a), vb = c ? at(c) : null;
      cross.setAttribute('x1', X(t)); cross.setAttribute('x2', X(t)); cross.classList.remove('hidden');
      tip.classList.remove('hidden');
      tip.style.left = Math.min(r.width - 170, (X(t) / W) * r.width + 10) + 'px';
      tip.replaceChildren(el('div', { text: fmtDate(Math.round(t)) }),
        va != null ? el('div', { class: 'a', text: 'Текущая: ' + metric.fmt(va) }) : null,
        vb != null ? el('div', { class: 'b', text: 'Сравнение: ' + metric.fmt(vb) }) : null);
    };
    root.onmouseleave = () => { cross.classList.add('hidden'); tip.classList.add('hidden'); };
  }
  draw();
  timer = setInterval(() => { if (!root.matches(':hover')) draw(); }, 1000);
  return modal;
}
