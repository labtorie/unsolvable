// «Улица»: фигурки-классы и «парад доходов».
import { NEEDS, CLASSES } from '../sim/schema.js';
import { el, svg, setText, fmtPct, fmtCompact, num, clamp, CLASS_COLORS } from './util.js';

const FIG_MIN = 26, FIG_MAX = 150;

function person(color) {
  const s = svg('svg', { class: 'person', viewBox: '0 0 40 100', preserveAspectRatio: 'xMidYMax meet' });
  const mouth = svg('path', { class: 'mouth', fill: 'none', 'stroke-width': 1.6, 'stroke-linecap': 'round' });
  s.append(
    svg('g', { stroke: color, 'stroke-width': 5, 'stroke-linecap': 'round', fill: 'none' },
      svg('path', { d: 'M16 62 L14 96 M24 62 L26 96 M12 30 L5 58 M28 30 L35 58' })),
    svg('rect', { x: 10, y: 24, width: 20, height: 40, rx: 7, fill: color }),
    svg('circle', { cx: 20, cy: 12, r: 10, fill: color }),
    svg('circle', { cx: 16.5, cy: 10, r: 1.3, class: 'eye' }), svg('circle', { cx: 23.5, cy: 10, r: 1.3, class: 'eye' }),
    mouth,
  );
  s.setMood = sat => {
    const d = sat >= 0.62 ? 'M15 14.5 Q20 20 25 14.5' : sat < 0.38 ? 'M15.5 18.5 Q20 13 24.5 18.5' : 'M15.5 16 L24.5 16';
    mouth.setAttribute('d', d);
  };
  return s;
}

function moodColor(sat) {
  const h = clamp(sat, 0, 1) * 120;           // красный → зелёный
  return `hsl(${h.toFixed(0)} 45% 52%)`;
}

export function createStreet(root) {
  const modeBtn = el('button', { class: 'btn small', text: 'Парад доходов', 'aria-pressed': 'false' });
  const head = el('div', { class: 'sect-head' }, el('h2', { text: 'Улица' }), el('span', { class: 'dim small', text: 'ширина — численность, рост — доход после налогов' }), el('span', { class: 'grow' }), modeBtn);
  const row = el('div', { class: 'street' });
  const canvas = el('canvas', { class: 'parade-canvas' });
  const legend = el('div', { class: 'parade-legend' });
  const parade = el('div', { class: 'parade', hidden: true }, canvas, legend);
  root.append(head, row, parade);

  let paradeOn = false;
  modeBtn.onclick = () => {
    paradeOn = !paradeOn;
    modeBtn.setAttribute('aria-pressed', paradeOn);
    modeBtn.classList.toggle('on', paradeOn);
    row.hidden = paradeOn; parade.hidden = !paradeOn;
    lastWorld && renderParade(lastWorld);
  };

  const nodes = new Map();
  function makeNode(c) {
    const color = CLASS_COLORS[c.id] || '#999';
    const fig = person(color);
    const figBox = el('div', { class: 'fig' }, fig);
    const name = el('div', { class: 'cls-name' });
    const share = el('span', { class: 'cls-share' }), inc = el('span', { class: 'cls-inc' });
    const cells = NEEDS.map(n => {
      const fill = el('i', { style: { background: color } });
      return { n, fill, cell: el('span', { class: 'cell', title: n.label }, fill) };
    });
    const basket = el('div', { class: 'basket', title: 'Корзина потребностей' }, ...cells.map(c => c.cell));
    const hBar = el('i'), sBar = el('i');
    const meters = el('div', { class: 'meters' },
      el('span', { class: 'meter', title: 'Здоровье' }, el('b', { text: 'здор.' }), el('span', { class: 'bar' }, hBar)),
      el('span', { class: 'meter', title: 'Настроение (удовлетворённость)' }, el('b', { text: 'настр.' }), el('span', { class: 'bar' }, sBar)));
    const box = el('div', { class: 'cls', style: { '--c': color } }, figBox, name, el('div', { class: 'cls-nums' }, share, inc), basket, meters);
    return { box, fig, figBox, name, share, inc, cells, hBar, sBar };
  }

  let lastWorld = null;
  function renderParade(world) {
    const hs = (world.households || []).filter(h => num(h.netIncome) >= 0).slice().sort((a, b) => num(a.netIncome) - num(b.netIncome));
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth || 600, H = canvas.clientHeight || 200;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const n = hs.length;
    if (!n) { g.fillStyle = '#8a93a1'; g.fillText('Нет данных о домохозяйствах', 10, 20); return; }
    const max = Math.max(1e-9, num(hs[n - 1].netIncome));
    const base = H - 4, top = 14, bw = W / n;
    g.strokeStyle = '#2d323b'; g.beginPath(); g.moveTo(0, base + 0.5); g.lineTo(W, base + 0.5); g.stroke();
    for (let i = 0; i < n; i++) {
      const h = hs[i];
      const ph = Math.max(2, (num(h.netIncome) / max) * (base - top));
      const x = i * bw, w = Math.max(1, bw - (bw > 4 ? 1 : 0.2));
      g.fillStyle = CLASS_COLORS[h.classId] || '#999';
      if (w >= 5) {
        const r = Math.min(w * 0.36, ph * 0.3);
        g.fillRect(x + w * 0.2, base - ph + r * 2, w * 0.6, Math.max(0, ph - r * 2));
        g.beginPath(); g.arc(x + w / 2, base - ph + r, r, 0, 6.2832); g.fill();
      } else g.fillRect(x, base - ph, w, ph);
    }
    g.fillStyle = '#8a93a1'; g.font = '10px system-ui, sans-serif';
    g.fillText(`${n} домохозяйств по возрастанию дохода · самый высокий: ${fmtCompact(max)}/мес`, 6, 10);
    if (!legend.children.length) {
      for (const c of CLASSES) legend.append(el('span', { class: 'lg' }, el('i', { style: { background: CLASS_COLORS[c.id] } }), c.label));
    }
  }

  return function render(world) {
    lastWorld = world;
    if (paradeOn) { renderParade(world); return; }
    const classes = (world.stats?.classes || []).filter(c => num(c.count) > 0);
    const maxInc = Math.max(1e-9, ...classes.map(c => num(c.avgNetIncome)));
    const seen = new Set();
    // порядок как в CLASSES
    const order = id => { const i = CLASSES.findIndex(c => c.id === id); return i < 0 ? 99 : i; };
    classes.sort((a, b) => order(a.id) - order(b.id));
    for (const c of classes) {
      seen.add(c.id);
      let nd = nodes.get(c.id);
      if (!nd) {
        nd = makeNode(c); nodes.set(c.id, nd);
        const after = [...nodes].filter(([id]) => id !== c.id && order(id) > order(c.id)).sort((a, b) => order(a[0]) - order(b[0]))[0];
        row.insertBefore(nd.box, after ? after[1].box : null);
      }
      nd.box.hidden = false;
      nd.box.style.flexGrow = Math.max(0.01, num(c.share)) * 100;
      const h = FIG_MIN + (FIG_MAX - FIG_MIN) * Math.sqrt(clamp(num(c.avgNetIncome) / maxInc, 0, 1));
      nd.figBox.style.height = h.toFixed(0) + 'px';
      nd.fig.style.width = (h * 0.4).toFixed(0) + 'px';
      nd.fig.setMood(num(c.satisfaction, 0.5));
      nd.fig.style.setProperty('--mood', moodColor(num(c.satisfaction, 0.5)));
      setText(nd.name, c.label || c.id);
      nd.name.title = c.label || c.id;
      setText(nd.share, fmtPct(c.share, 0));
      setText(nd.inc, fmtCompact(c.avgNetIncome) + '/мес');
      for (const { n, fill } of nd.cells) fill.style.height = (clamp(num(c.needsMet?.[n.id]), 0, 1) * 100).toFixed(0) + '%';
      nd.hBar.style.width = (clamp(num(c.health), 0, 1) * 100).toFixed(0) + '%';
      nd.sBar.style.width = (clamp(num(c.satisfaction), 0, 1) * 100).toFixed(0) + '%';
      nd.sBar.style.background = moodColor(num(c.satisfaction));
      nd.box.title = `${c.label}: ${c.count} дом., доход ${fmtCompact(c.avgNetIncome)}, богатство ${fmtCompact(c.avgWealth)}`;
    }
    for (const [id, nd] of nodes) if (!seen.has(id)) nd.box.hidden = true;
    if (!classes.length && !row.dataset.empty) row.dataset.empty = '1';
  };
}
