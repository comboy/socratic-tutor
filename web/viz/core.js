// Built-in visualization components. Each is (el, spec, ctx) => void.
// Add new ones with register('name', fn) in a new file under web/viz/ and import it
// from web/viz/index.js. See web/viz/README.md.
/* global d3 */
export const registry = {};
export function register(name, fn) { registry[name] = fn; }

const fmt = (v, digits = 2) => {
  if (typeof v !== 'number') return String(v);
  if (Number.isInteger(v) && Math.abs(v) < 1e5) return String(v);
  return v.toFixed(digits).replace(/\.?0+$/, m => (m.startsWith('.') ? '' : m)) || '0';
};
const keysOf = (...ks) => ks.filter(Boolean).join(' ');
function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v;
    else if (k === 'html') e.innerHTML = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') { for (const [p, x] of Object.entries(v)) { if (p.startsWith('--')) e.style.setProperty(p, x); else e.style[p] = x; } }
    else e.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null) e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return e;
}
export { h, fmt };

// Diverging colour for heat cells: blue (neg) — neutral — orange (pos)
function heat(v, maxAbs) {
  const t = maxAbs ? Math.max(-1, Math.min(1, v / maxAbs)) : 0;
  const a = Math.abs(t) * 0.55;
  return t >= 0 ? `rgba(214, 120, 40, ${a})` : `rgba(50, 110, 200, ${a})`;
}

// ---------------------------------------------------------------- matrix / vector
function matrix(el, spec, ctx) {
  const rows = spec.rows || spec.values && [spec.values] || [];
  const nR = rows.length, nC = Math.max(0, ...rows.map(r => r.length));
  const maxAbs = spec.heat ? Math.max(1e-9, ...rows.flat().filter(x => typeof x === 'number').map(Math.abs)) : 0;
  const t = h('table', { class: 'mx' });
  if (spec.colLabels) {
    const tr = h('tr', {}, spec.rowLabels ? h('th', { class: 'mx-corner' }) : null);
    spec.colLabels.forEach((c, j) => tr.append(h('th', { class: 'mx-col', 'data-k': keysOf(spec.colKeys?.[j]) || null, html: ctx.inline(c) })));
    t.append(h('thead', {}, tr));
  }
  const tb = h('tbody');
  rows.forEach((row, i) => {
    const rk = spec.rowKeys?.[i];
    const tr = h('tr');
    if (spec.rowLabels) tr.append(h('th', { class: 'mx-row', 'data-k': rk || null, html: ctx.inline(spec.rowLabels[i]) }));
    for (let j = 0; j < nC; j++) {
      const v = row[j];
      const ck = keysOf(rk, spec.colKeys?.[j], spec.cellKeys?.[i]?.[j]);
      const td = h('td', { class: 'mx-cell' + (spec.highlight?.some(([a, b]) => a === i && b === j) ? ' mx-mark' : ''),
        'data-k': ck || null, text: v == null ? '' : fmt(v, spec.digits ?? 2) });
      if (maxAbs && typeof v === 'number') td.style.background = heat(v, maxAbs);
      tr.append(td);
    }
    tb.append(tr);
  });
  t.append(tb);
  const wrap = h('div', { class: 'mx-wrap' });
  if (spec.name) wrap.append(h('div', { class: 'mx-name', 'data-k': spec.key || null, html: ctx.inline(spec.name) }), h('div', { class: 'mx-eq', text: '=' }));
  wrap.append(h('div', { class: 'mx-brackets' + (spec.colLabels ? ' has-head' : '') }, t));
  if (spec.shape !== false) wrap.append(h('div', { class: 'mx-shape', text: `${nR}×${nC}` }));
  el.append(wrap);
  if (spec.caption) el.append(ctx.md(spec.caption, 'viz-caption'));
}
register('matrix', matrix);
register('vector', (el, spec, ctx) => {
  const vals = spec.values || [];
  if (spec.vertical) {
    matrix(el, { ...spec, rows: vals.map(v => [v]), rowLabels: spec.labels, rowKeys: spec.keys, colLabels: null, values: null }, ctx);
  } else {
    matrix(el, { ...spec, rows: [vals], colLabels: spec.labels, colKeys: spec.keys, rowKeys: [spec.key], rowLabels: null, values: null }, ctx);
  }
});

// ---------------------------------------------------------------- bars
register('bars', (el, spec, ctx) => {
  let items = (spec.items || []).map((it, i) => (typeof it === 'number' ? { label: String(i), value: it } : it));
  if (spec.sort) items = [...items].sort((a, b) => b.value - a.value);
  const max = spec.max ?? Math.max(1e-9, ...items.map(i => Math.abs(i.value)));
  const f = v => spec.format === 'pct' ? (v * 100).toFixed(v < 0.1 ? 1 : 0) + '%' : fmt(v, spec.digits ?? 2);
  const box = h('div', { class: 'bars' });
  for (const it of items) {
    box.append(h('div', { class: 'bar-row', 'data-k': it.key || null },
      h('div', { class: 'bar-label', html: ctx.inline(it.label) }),
      h('div', { class: 'bar-track' }, h('div', { class: 'bar-fill' + (it.value < 0 ? ' neg' : ''), style: { width: (Math.abs(it.value) / max * 100) + '%' } })),
      h('div', { class: 'bar-val', text: f(it.value) })));
  }
  if (spec.title) el.append(h('div', { class: 'viz-title', html: ctx.inline(spec.title) }));
  el.append(box);
  if (spec.caption) el.append(ctx.md(spec.caption, 'viz-caption'));
});

// ---------------------------------------------------------------- tokens (+ attention arcs)
register('tokens', (el, spec, ctx) => {
  const toks = spec.tokens || [];
  const keys = spec.keys || [];
  const A = spec.attn || null;                     // full matrix [i][j]: weight of token i attending to j
  let from = spec.weights?.from ?? (A ? toks.length - 1 : null);
  const wrap = h('div', { class: 'tok-wrap' });
  const svg = d3.select(wrap).append('svg').attr('class', 'tok-arcs');
  const row = h('div', { class: 'tok-row' });
  wrap.append(row);
  const chips = toks.map((t, i) => {
    const c = h('div', { class: 'tok', 'data-k': keys[i] || null, 'data-i': i }, h('span', { class: 'tok-text', text: t }), h('span', { class: 'tok-idx', text: i }));
    if (A) c.addEventListener('mouseenter', () => { from = i; draw(); });
    row.append(c);
    return c;
  });
  el.append(wrap);
  if (spec.caption) el.append(ctx.md(spec.caption, 'viz-caption'));
  const weightsFor = i => (A ? A[i] : spec.weights?.to) || [];
  function draw() {
    svg.selectAll('*').remove();
    if (from == null) return;
    const w = weightsFor(from);
    const base = wrap.getBoundingClientRect();
    const cx = i => { const r = chips[i].getBoundingClientRect(); return r.left - base.left + r.width / 2; };
    const H = 54;
    svg.attr('width', base.width).attr('height', H);
    chips.forEach((c, i) => {
      c.classList.toggle('tok-from', i === from);
      c.classList.toggle('tok-masked', !!spec.causal && i > from);
      const wv = w[i];
      c.style.setProperty('--w', wv == null ? 0 : wv);
      c.querySelector('.tok-w')?.remove();
      if (wv != null) c.append(h('span', { class: 'tok-w', text: (wv * 100).toFixed(0) + '%' }));
    });
    w.forEach((wv, j) => {
      if (!wv || (spec.causal && j > from)) return;
      const x1 = cx(from), x2 = cx(j);
      const lift = j === from ? 18 : Math.min(H - 6, 14 + Math.abs(x2 - x1) * 0.25);
      const p = j === from
        ? `M${x1 - 6},${H} C${x1 - 14},${H - lift} ${x1 + 14},${H - lift} ${x1 + 6},${H}`
        : `M${x1},${H} C${x1},${H - lift} ${x2},${H - lift} ${x2},${H}`;
      svg.append('path').attr('d', p).attr('class', 'tok-arc').attr('stroke-width', 1 + wv * 7).attr('opacity', 0.25 + wv * 0.75);
    });
  }
  requestAnimationFrame(draw);
  new ResizeObserver(draw).observe(wrap);
});

// ---------------------------------------------------------------- flow (small pipeline)
register('flow', (el, spec, ctx) => {
  const nodes = spec.nodes || [];
  const labels = new Map();
  for (const e of spec.edges || []) { const [a, b, l] = Array.isArray(e) ? e : [e.from, e.to, e.label]; labels.set(a + '>' + b, l || ''); }
  const box = h('div', { class: 'flow' + (spec.vertical ? ' flow-v' : '') });
  nodes.forEach((n, i) => {
    if (i > 0) {
      const l = labels.get(nodes[i - 1].id + '>' + n.id) || '';
      box.append(h('div', { class: 'flow-arrow' }, h('span', { class: 'flow-elabel', html: ctx.inline(l) }), h('span', { class: 'flow-glyph', text: spec.vertical ? '↓' : '→' })));
    }
    box.append(h('div', { class: 'flow-node' + (n.dim ? ' dim' : '') + (n.unknown ? ' unknown' : ''), 'data-k': n.key || null },
      h('div', { class: 'flow-label', html: ctx.inline(n.label) }),
      n.sub ? h('div', { class: 'flow-sub', html: ctx.inline(n.sub) }) : null));
  });
  el.append(box);
  if (spec.caption) el.append(ctx.md(spec.caption, 'viz-caption'));
});

// ---------------------------------------------------------------- plot (with sliders)
register('plot', (el, spec, ctx) => {
  const W = spec.width || 460, H = spec.height || 220, m = { t: 10, r: 14, b: 28, l: 40 };
  const params = Object.fromEntries((spec.sliders || []).map(s => [s.name, s.value ?? s.min]));
  const names = (spec.sliders || []).map(s => s.name);
  const fns = (spec.fns || []).map(f => ({ ...f, fn: new Function('x', ...names, `with (Math) { return (${f.f}); }`) }));
  const svg = d3.select(el).append('svg').attr('class', 'plot').attr('viewBox', `0 0 ${W} ${H}`).attr('width', '100%').style('max-width', W + 'px');
  const x = d3.scaleLinear().domain(spec.x || [-5, 5]).range([m.l, W - m.r]);
  const yAuto = !spec.y;
  const y = d3.scaleLinear().range([H - m.b, m.t]);
  const gx = svg.append('g').attr('class', 'axis').attr('transform', `translate(0,${H - m.b})`);
  const gy = svg.append('g').attr('class', 'axis').attr('transform', `translate(${m.l},0)`);
  const lines = svg.append('g');
  const legend = h('div', { class: 'plot-legend' });
  fns.forEach((f, i) => legend.append(h('span', { class: 'plot-key', 'data-k': f.key || null, style: { '--c': `var(--s${i % 6})` }, html: ctx.inline(f.label || f.f) })));
  function draw() {
    const xs = d3.range(0, 241).map(i => x.domain()[0] + (x.domain()[1] - x.domain()[0]) * i / 240);
    const data = fns.map(f => xs.map(xv => { let v; try { v = f.fn(xv, ...names.map(n => params[n])); } catch { v = NaN; } return [xv, v]; }));
    if (yAuto) { const all = data.flat().map(d => d[1]).filter(Number.isFinite); y.domain(d3.extent(all.length ? all : [0, 1])).nice(); }
    else y.domain(spec.y);
    gx.call(d3.axisBottom(x).ticks(6)); gy.call(d3.axisLeft(y).ticks(5));
    lines.selectAll('path').data(data).join('path').attr('class', 'plot-line')
      .attr('data-k', (_, i) => fns[i].key || null)
      .attr('stroke', (_, i) => `var(--s${i % 6})`)
      .attr('d', d3.line().defined(d => Number.isFinite(d[1]) && d[1] >= y.domain()[0] - 1e3 && d[1] <= y.domain()[1] + 1e3).x(d => x(d[0])).y(d => y(Math.max(y.domain()[0], Math.min(y.domain()[1], d[1])))));
  }
  el.append(legend);
  const sl = h('div', { class: 'sliders' });
  for (const s of spec.sliders || []) sl.append(ctx.slider(s.label || s.name, s.min, s.max, params[s.name], s.step || (s.max - s.min) / 100, v => { params[s.name] = v; draw(); }));
  if (spec.sliders?.length) el.append(sl);
  if (spec.caption) el.append(ctx.md(spec.caption, 'viz-caption'));
  draw();
});

// ---------------------------------------------------------------- steps (walk-through)
register('steps', (el, spec, ctx) => {
  const steps = spec.steps || [];
  let i = 0;
  const body = h('div', { class: 'steps-body' });
  const count = h('span', { class: 'steps-count' });
  const prev = h('button', { class: 'btn btn-small', text: '← Prev', onclick: () => go(i - 1) });
  const next = h('button', { class: 'btn btn-small btn-primary', text: 'Next →', onclick: () => go(i + 1) });
  const dots = h('div', { class: 'steps-dots' }, steps.map((_, k) => h('button', { class: 'steps-dot', title: `Step ${k + 1}`, onclick: () => go(k) })));
  el.append(h('div', { class: 'steps-bar' }, prev, count, next, dots), body);
  function go(k) {
    i = Math.max(0, Math.min(steps.length - 1, k));
    body.replaceChildren(ctx.md(steps[i].md || ''));
    ctx.mountAll(body);
    count.textContent = `Step ${i + 1} / ${steps.length}`;
    prev.disabled = i === 0; next.disabled = i === steps.length - 1;
    [...dots.children].forEach((d, k2) => d.classList.toggle('on', k2 === i));
    ctx.highlight(steps[i].hl || []);
  }
  el.addEventListener('keydown', e => { if (e.key === 'ArrowRight') go(i + 1); if (e.key === 'ArrowLeft') go(i - 1); });
  el.tabIndex = 0;
  if (steps.length) go(0);
});

// ---------------------------------------------------------------- js (escape hatch)
register('js', (el, _spec, ctx, src) => { new Function('el', 'ctx', 'd3', src)(el, ctx, d3); });
