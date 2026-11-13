// Вкладка «Кто кем владеет»: граф долей и кредитов между фирмами, банком и пенсионным фондом.
// Раскладка силовая, детерминированная и стартует от прежних позиций: между тиками граф не «встряхивается».
import { INDUSTRIES } from '../sim/schema.js';
import { el, svg, setText, fmtPct, fmtNum, fmtCompact, num, clamp, IND_COLORS, IND_LABELS, OWNER_COLORS, OWNER_LABELS } from './util.js';

const VW = 760, VH = 480;
const IND = Object.fromEntries(INDUSTRIES.map(i => [i.id, i]));
const BANK_COLOR = '#8d98a6', PF_COLOR = '#e0c27a';

// ── граф ──
function buildGraph(world, showBank) {
  const firms = (world.firms || []).filter(f => f.alive !== false);
  const byId = new Map(firms.map(f => [f.id, f]));
  const edges = [];
  for (const a of firms) {
    for (const [bid, share] of Object.entries(a.stakes || {})) {
      const b = byId.get(+bid);
      if (b && b !== a && num(share) > 0) edges.push({ from: 'f' + a.id, to: 'f' + b.id, type: 'stake', w: num(share), fin: true });
    }
    for (const [bid, sum] of Object.entries(a.vendorLoans || {})) {
      const b = byId.get(+bid);
      if (b && b !== a && num(sum) > 0) edges.push({ from: 'f' + a.id, to: 'f' + b.id, type: 'loan', w: num(sum), fin: true });
    }
  }
  const inGraph = new Set();
  for (const e of edges) { inGraph.add(e.from); inGraph.add(e.to); }
  const nodes = [];
  for (const f of firms) if (inGraph.has('f' + f.id)) nodes.push({ key: 'f' + f.id, kind: 'firm', f, value: Math.max(0, num(f.value)) });
  const pf = world.finance?.pensionFund;
  if (pf) {
    const pe = Object.entries(pf.stakes || {}).filter(([id, s]) => inGraph.has('f' + id) && num(s) > 0);
    if (pe.length) {
      nodes.push({ key: 'pf', kind: 'pf', value: Math.max(num(pf.value), 0) });
      for (const [id, s] of pe) edges.push({ from: 'pf', to: 'f' + id, type: 'pf', w: num(s), fin: false });
    }
  }
  if (showBank && nodes.length) {
    const debts = nodes.filter(n => n.kind === 'firm' && num(n.f.debt) > 0);
    if (debts.length) {
      nodes.push({ key: 'bank', kind: 'bank', value: 0 });
      for (const n of debts) edges.push({ from: 'bank', to: n.key, type: 'debt', w: num(n.f.debt), fin: false });
    }
  }
  markCycles(nodes, edges, byId);
  return { nodes, edges };
}

// Кольцо = сильно связная компонента из ≥2 фирм в графе «владеет/кредитует A→B» + «покупает B→A»
// (клиент по кредиту — покупатель; фирма, чья отрасль закупает продукцию отрасли владельца — тоже покупатель).
function markCycles(nodes, edges, byId) {
  const keys = nodes.filter(n => n.kind === 'firm').map(n => n.key);
  const adj = new Map(keys.map(k => [k, []]));
  for (const e of edges) {
    if (!e.fin || !adj.has(e.from) || !adj.has(e.to)) continue;
    adj.get(e.from).push(e.to);
    const a = byId.get(+e.from.slice(1)), b = byId.get(+e.to.slice(1));
    if (e.type === 'loan' || (IND[b.industry]?.inputs && IND[b.industry].inputs[a.industry] != null)) adj.get(e.to).push(e.from);
  }
  let idx = 0; const st = [], on = new Set(), ix = new Map(), low = new Map(), comp = new Map();
  const strong = v => {
    ix.set(v, idx); low.set(v, idx); idx++; st.push(v); on.add(v);
    for (const w of adj.get(v)) {
      if (!ix.has(w)) { strong(w); low.set(v, Math.min(low.get(v), low.get(w))); }
      else if (on.has(w)) low.set(v, Math.min(low.get(v), ix.get(w)));
    }
    if (low.get(v) === ix.get(v)) {
      const c = []; let w;
      do { w = st.pop(); on.delete(w); c.push(w); } while (w !== v);
      if (c.length >= 2) for (const k of c) comp.set(k, c[0]);
    }
  };
  for (const k of keys) if (!ix.has(k)) strong(k);
  for (const n of nodes) n.circ = comp.has(n.key);
  for (const e of edges) e.circ = !!(e.fin && comp.has(e.from) && comp.get(e.from) === comp.get(e.to));
}

// ── раскладка ──
const pos = new Map();          // key → { x, y } (целевые позиции; живут между тиками)
function seedPos(n, i, nodes, edges) {
  if (pos.has(n.key)) return;
  const nb = edges.map(e => (e.from === n.key ? e.to : e.to === n.key ? e.from : null)).filter(k => k && pos.has(k))[0];
  const hash = (parseInt(String(n.key).replace(/\D/g, ''), 10) || 7) * 2.399963;
  if (nb) { const p = pos.get(nb); pos.set(n.key, { x: p.x + Math.cos(hash) * 60, y: p.y + Math.sin(hash) * 60 }); }
  else { const rr = 40 + 22 * Math.sqrt(i); pos.set(n.key, { x: VW / 2 + Math.cos(hash) * rr, y: VH / 2 + Math.sin(hash) * rr * 0.7 }); }
}
function relax(nodes, edges, iters) {
  const P = nodes.map(n => pos.get(n.key));
  const idxOf = new Map(nodes.map((n, i) => [n.key, i]));
  const E = edges.map(e => [idxOf.get(e.from), idxOf.get(e.to)]).filter(([a, b]) => a != null && b != null);
  for (let it = 0; it < iters; it++) {
    const cool = 1 - it / iters * 0.7;
    const fx = new Float64Array(nodes.length), fy = new Float64Array(nodes.length);
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      let dx = P[j].x - P[i].x, dy = P[j].y - P[i].y, d = Math.hypot(dx, dy);
      if (d < 1e-3) { dx = Math.cos(i * 2.4 + j); dy = Math.sin(i * 2.4 + j); d = 1; }
      const min = nodes[i].r + nodes[j].r + 16;
      const f = (9000 / (d * d)) + (d < min ? (min - d) * 0.6 : 0);
      fx[i] -= dx / d * f; fy[i] -= dy / d * f; fx[j] += dx / d * f; fy[j] += dy / d * f;
    }
    for (const [a, b] of E) {
      const dx = P[b].x - P[a].x, dy = P[b].y - P[a].y, d = Math.hypot(dx, dy) || 1;
      const L = nodes[a].r + nodes[b].r + 110, f = (d - L) * 0.03;
      fx[a] += dx / d * f; fy[a] += dy / d * f; fx[b] -= dx / d * f; fy[b] -= dy / d * f;
    }
    for (let i = 0; i < nodes.length; i++) {
      fx[i] += (VW / 2 - P[i].x) * 0.006; fy[i] += (VH / 2 - P[i].y) * 0.008;
      const m = Math.hypot(fx[i], fy[i]), cap = 10 * cool;
      const k = m > cap ? cap / m : 1;
      P[i].x = clamp(P[i].x + fx[i] * k, nodes[i].r + 6, VW - nodes[i].r - 6);
      P[i].y = clamp(P[i].y + fy[i] * k, nodes[i].r + 6, VH - nodes[i].r - 18);
    }
  }
}

function sentimentLabel(s) {
  return s < -0.6 ? 'паника' : s < -0.2 ? 'тревога' : s < 0.2 ? 'штиль' : s < 0.6 ? 'оптимизм' : 'мания';
}

const rc = (node, ...kids) => node.replaceChildren(...kids.filter(x => x != null));

export function createOwnership(root) {
  let colorMode = 'industry', showBank = false, selected = null, world = null, force = true, sig = '', lastLayoutSig = '', worldKey = '';
  const nodesDom = new Map();    // key → { g, circle, label, x, y, r, tr }
  let graph = { nodes: [], edges: [] };

  const modeBtns = [['industry', 'по отрасли'], ['owner', 'по собственнику']].map(([id, t]) =>
    el('button', { class: 'seg-btn', text: t, onclick: () => { colorMode = id; paint(); } }));
  const bankChk = el('input', { type: 'checkbox', onchange: () => { showBank = bankChk.checked; force = true; if (world) render(world); } });
  const legend = el('div', { class: 'parade-legend' });
  const defs = svg('defs', {}, ...[['stake', '#9aa6b5'], ['loan', '#9aa6b5'], ['circ', '#e8694f'], ['pf', PF_COLOR], ['debt', '#59606c']].map(([id, c]) =>
    svg('marker', { id: 'arr-' + id, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 9, markerHeight: 9, markerUnits: 'userSpaceOnUse', orient: 'auto-start-reverse' }, svg('path', { d: 'M0 1 L10 5 L0 9 z', fill: c }))));
  const edgeLayer = svg('g', { class: 'og-edges' }), nodeLayer = svg('g', { class: 'og-nodes' });
  const canvas = svg('svg', { class: 'og-canvas', viewBox: `0 0 ${VW} ${VH}`, preserveAspectRatio: 'xMidYMid meet' }, defs, edgeLayer, nodeLayer);
  canvas.addEventListener('click', e => { if (e.target === canvas) { selected = null; paint(); } });
  const empty = el('div', { class: 'empty', hidden: true }, el('b', { text: 'Связей между фирмами пока нет.' }),
    el('div', { text: 'Эта вкладка показывает, кто кем владеет: доли фирм друг в друге (сплошные линии, толщина — размер доли) и кредиты клиентам на покупку собственной продукции (пунктир). Когда фирмы начнут скупать акции друг друга и кредитовать своих покупателей, здесь появится граф. Замкнутые кольца «я вкладываюсь в тебя, ты покупаешь у меня» подсвечиваются красным: так выглядит пузырь изнутри.' }));
  const detail = el('div', { class: 'og-detail' });
  const kvBox = el('div', { class: 'og-kv' });
  const topBody = el('tbody');
  const topTable = el('table', { class: 'tbl compact' },
    el('thead', {}, el('tr', {}, el('th', { text: 'Фирма' }), el('th', { class: 'r', text: 'Стоимость' }), el('th', { class: 'r', text: 'Круговая выручка' }))), topBody);

  root.append(
    el('div', { class: 'sect-head' }, el('h2', { text: 'Кто кем владеет' }),
      el('span', { class: 'dim small', text: 'сплошная — доля в другой фирме, пунктир — кредит клиенту, красное — замкнутое кольцо' }), el('span', { class: 'grow' }),
      el('label', { class: 'row gap small dim' }, bankChk, 'долги банку'),
      el('div', { class: 'seg' }, ...modeBtns)),
    el('div', { class: 'og-layout' },
      el('div', { class: 'og-main' }, canvas, empty, legend),
      el('div', { class: 'og-side' }, el('h2', { text: 'Рынок капитала' }), kvBox, detail, el('h2', { class: 'sub-h', text: 'Топ-10 по стоимости' }), topTable)));

  // ── анимация ──
  let anim = false;
  function tick() {
    let moving = false;
    for (const n of graph.nodes) {
      const d = nodesDom.get(n.key), p = pos.get(n.key);
      if (!d || !p) continue;
      d.x += (p.x - d.x) * 0.22; d.y += (p.y - d.y) * 0.22; d.r += (n.r - d.r) * 0.22;
      if (Math.abs(p.x - d.x) + Math.abs(p.y - d.y) + Math.abs(n.r - d.r) < 0.1) { d.x = p.x; d.y = p.y; d.r = n.r; } else moving = true;
      d.g.setAttribute('transform', `translate(${d.x.toFixed(1)} ${d.y.toFixed(1)})`);
      d.circle.setAttribute('r', d.r.toFixed(1));
      d.label.setAttribute('y', (d.r + 11).toFixed(1));
    }
    drawEdges();
    if (moving) requestAnimationFrame(tick); else anim = false;
  }
  const kick = () => { if (!anim) { anim = true; requestAnimationFrame(tick); } };

  let edgeDom = [];
  function drawEdges() {
    for (const e of edgeDom) {
      const a = nodesDom.get(e.from), b = nodesDom.get(e.to);
      if (!a || !b) continue;
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d;
      const bend = Math.min(40, d * 0.14), nx = -uy * bend, ny = ux * bend;
      const x1 = a.x + ux * a.r, y1 = a.y + uy * a.r, x2 = b.x - ux * (b.r + 3), y2 = b.y - uy * (b.r + 3);
      e.path.setAttribute('d', `M${x1.toFixed(1)} ${y1.toFixed(1)} Q${((x1 + x2) / 2 + nx).toFixed(1)} ${((y1 + y2) / 2 + ny).toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`);
    }
  }

  function colorOf(n) {
    if (n.kind === 'pf') return PF_COLOR;
    if (n.kind === 'bank') return BANK_COLOR;
    return colorMode === 'owner' ? OWNER_COLORS[n.f.owner] || '#999' : IND_COLORS[n.f.industry] || '#999';
  }
  const nameOf = n => n.kind === 'pf' ? 'Пенсионный фонд' : n.kind === 'bank' ? 'Банк' : n.f.name || `Фирма №${n.f.id}`;

  function paint() {
    if (!world) return;
    const nb = new Set();
    if (selected) for (const e of graph.edges) { if (e.from === selected) nb.add(e.to); if (e.to === selected) nb.add(e.from); }
    for (const n of graph.nodes) {
      const d = nodesDom.get(n.key); if (!d) continue;
      d.circle.setAttribute('fill', colorOf(n));
      d.circle.setAttribute('class', 'og-node ' + n.kind + (n.circ ? ' circ' : '') + (selected === n.key ? ' sel' : ''));
      d.g.setAttribute('opacity', !selected || selected === n.key || nb.has(n.key) ? 1 : 0.35);
    }
    for (const e of edgeDom) e.path.setAttribute('opacity', !selected || e.from === selected || e.to === selected ? 1 : 0.15);
    const items = colorMode === 'owner'
      ? Object.entries(OWNER_LABELS).map(([k, l]) => [OWNER_COLORS[k], l])
      : INDUSTRIES.filter(i => graph.nodes.some(n => n.f?.industry === i.id)).map(i => [IND_COLORS[i.id], i.label]);
    if (graph.nodes.some(n => n.kind === 'pf')) items.push([PF_COLOR, 'пенсионный фонд']);
    if (graph.nodes.some(n => n.kind === 'bank')) items.push([BANK_COLOR, 'банк']);
    legend.replaceChildren(...items.map(([c, l]) => el('span', { class: 'lg' }, el('i', { style: { background: c } }), l)));
    modeBtns.forEach((b, i) => b.classList.toggle('on', ['industry', 'owner'][i] === colorMode));
    fillDetail();
  }

  function fillDetail() {
    const n = graph.nodes.find(x => x.key === selected);
    if (!n) { detail.replaceChildren(el('div', { class: 'dim small', text: 'Клик по узлу покажет, кто в нём и во что он вложен.' })); return; }
    const kv = (k, v) => el('div', { class: 'kv' }, el('span', { text: k }), el('b', { text: v }));
    const nameByKey = k => nameOf(graph.nodes.find(x => x.key === k) || { kind: 'firm', f: { id: k } });
    const out = graph.edges.filter(e => e.from === n.key), inn = graph.edges.filter(e => e.to === n.key);
    const fmtE = (e, who) => `${nameByKey(who)} — ${e.type === 'stake' || e.type === 'pf' ? fmtPct(e.w, 0) : fmtCompact(e.w)}`;
    const list = (title, arr, side) => arr.length ? el('div', {}, el('div', { class: 'dim small', text: title }), el('ul', { class: 'plain' }, ...arr.map(e => el('li', { class: e.circ ? 'bad' : '', text: (e.type === 'loan' ? 'кредит: ' : e.type === 'debt' ? 'долг: ' : '') + fmtE(e, side === 'to' ? e.to : e.from) })))) : null;
    rc(detail,
      el('div', { class: 'og-dh' }, el('b', { text: nameOf(n) }), n.circ ? el('span', { class: 'tag circ', text: 'в кольце' }) : null),
      n.kind === 'firm' ? el('div', { class: 'dim small', text: `${IND_LABELS[n.f.industry] || n.f.industry} · ${OWNER_LABELS[n.f.owner] || n.f.owner}` }) : null,
      kv('Стоимость', fmtCompact(n.value)),
      n.kind === 'firm' ? kv('Круговая выручка', fmtCompact(n.f.circularRevenue)) : null,
      list('Владеет / кредитует:', out, 'to'), list('Ему принадлежит / кредитует его:', inn, 'from'));
  }

  function fillSummary(w) {
    const F = w.finance || {};
    const hist = F.indexHist || [];
    let delta = null;
    if (hist.length >= 2) { const base = hist.length > 12 ? hist[hist.length - 13] : hist[0]; if (base > 0) delta = F.index / base - 1; }
    const kv = (k, v, cls) => el('div', { class: 'kv' }, el('span', { text: k }), el('b', { class: cls || '', text: v }));
    rc(kvBox,
      kv('Индекс', fmtNum(num(F.index, 100), 1) + (delta != null ? ` (${delta >= 0 ? '+' : '−'}${fmtNum(Math.abs(delta) * 100, 0)}% за год)` : ''), delta != null && delta < -0.15 ? 'bad' : ''),
      kv('P/E рынка', num(F.pe) > 0 ? fmtNum(F.pe, 1) : '—'),
      kv('Круговая выручка', fmtPct(F.circularShare, 1), num(F.circularShare) > 0.15 ? 'warn' : ''),
      kv('Долг под залог акций', fmtCompact(F.marginDebt)),
      kv('Настроение рынка', `${sentimentLabel(num(F.sentiment))} (${fmtNum(num(F.sentiment), 2)})`),
      kv('Пенсионный фонд', fmtCompact(F.pensionFund?.value)),
      num(F.crashes) > 0 ? kv('Обвалов за год', fmtNum(F.crashes, 0)) : null);
    const top = (w.firms || []).filter(f => f.alive !== false && num(f.value) > 0).sort((a, b) => b.value - a.value).slice(0, 10);
    topBody.replaceChildren(...(top.length ? top.map(f => {
      const share = num(f.revenue) > 0 ? num(f.circularRevenue) / f.revenue : 0;
      return el('tr', { class: 'clickable' + (selected === 'f' + f.id ? ' sel' : ''), onclick: () => { if (graph.nodes.some(n => n.key === 'f' + f.id)) { selected = 'f' + f.id; paint(); } } },
        el('td', {}, el('i', { class: 'dot', style: { background: IND_COLORS[f.industry] || '#999' } }), f.name || `Фирма №${f.id}`),
        el('td', { class: 'r', text: fmtCompact(f.value) }),
        el('td', { class: 'r' + (num(f.circularRevenue) > 0 ? ' warn' : ' dim'), text: num(f.circularRevenue) > 0 ? `${fmtCompact(f.circularRevenue)}${share > 0 ? ` · ${fmtPct(share, 0)}` : ''}` : '—' }));
    }) : [el('tr', {}, el('td', { class: 'dim small', colspan: 3, text: 'Рыночных оценок пока нет.' }))]));
  }

  function render(w) {
    world = w;
    const wk = w.seed + ':' + w.preset;
    if (wk !== worldKey) { worldKey = wk; pos.clear(); for (const d of nodesDom.values()) d.g.remove(); nodesDom.clear(); lastLayoutSig = ''; selected = null; }
    const s = w.seed + ':' + w.t;
    if (s === sig && !force) return;
    sig = s;
    graph = buildGraph(w, showBank);
    const maxV = Math.max(1e-9, ...graph.nodes.map(n => n.value));
    for (const n of graph.nodes) n.r = n.kind === 'bank' ? 11 : n.kind === 'pf' ? 9 + 16 * Math.sqrt(n.value / maxV) : 6 + 20 * Math.sqrt(n.value / maxV);
    empty.hidden = graph.nodes.length > 0;
    canvas.classList.toggle('hidden', !graph.nodes.length);
    if (selected && !graph.nodes.some(n => n.key === selected)) selected = null;

    // узлы
    const keys = new Set(graph.nodes.map(n => n.key));
    for (const [k, d] of nodesDom) if (!keys.has(k)) { d.g.remove(); nodesDom.delete(k); pos.delete(k); }
    for (const k of [...pos.keys()]) if (!keys.has(k)) pos.delete(k);
    const ordered = graph.nodes.slice().sort((a, b) => (a.key < b.key ? -1 : 1));
    ordered.forEach((n, i) => seedPos(n, i, ordered, graph.edges));
    const layoutSig = graph.nodes.map(n => n.key + ':' + Math.round(n.r)).join(',') + '|' + graph.edges.map(e => e.from + '>' + e.to + e.type).join(',');
    if (layoutSig !== lastLayoutSig) { relax(ordered, graph.edges, 140); lastLayoutSig = layoutSig; }
    for (const n of graph.nodes) {
      let d = nodesDom.get(n.key);
      const p = pos.get(n.key);
      if (!d) {
        const circle = svg('circle', { r: 0 });
        const label = svg('text', { class: 'og-label', 'text-anchor': 'middle' });
        const g = svg('g', { class: 'og-g', transform: `translate(${p.x} ${p.y})` }, circle, label, svg('title', {}, ''));
        g.addEventListener('click', e => { e.stopPropagation(); selected = selected === n.key ? null : n.key; paint(); });
        nodeLayer.append(g);
        d = { g, circle, label, x: p.x, y: p.y, r: 0 };
        nodesDom.set(n.key, d);
      }
      setText(d.label, nameOf(n).replace(/^[^«]*«?/, '').replace(/»$/, '').slice(0, 16) || nameOf(n));
      if (n.kind !== 'firm') setText(d.label, nameOf(n));
      d.g.lastChild.textContent = `${nameOf(n)} — стоимость ${fmtCompact(n.value)}`;
    }
    // рёбра (пересоздаём: толщины меняются каждый месяц, интерактива у них нет)
    const maxLoan = Math.max(1e-9, ...graph.edges.filter(e => e.type === 'loan').map(e => e.w));
    const maxDebt = Math.max(1e-9, ...graph.edges.filter(e => e.type === 'debt').map(e => e.w));
    edgeLayer.replaceChildren();
    edgeDom = graph.edges.map(e => {
      const width = e.type === 'loan' ? 1 + 5 * e.w / maxLoan : e.type === 'debt' ? 0.6 + 2 * e.w / maxDebt : 1 + 10 * clamp(e.w, 0, 1);
      const path = svg('path', { class: `og-edge ${e.type}${e.circ ? ' circ' : ''}`, 'stroke-width': width.toFixed(1), fill: 'none',
        'marker-end': `url(#arr-${e.circ ? 'circ' : e.type})` });
      edgeLayer.append(path);
      return { ...e, path };
    });
    // клик по ребру не нужен; порядок: красные поверх
    edgeDom.filter(e => e.circ).forEach(e => edgeLayer.append(e.path));
    fillSummary(w);
    force = false;
    paint();
    kick();
  }
  return render;
}
