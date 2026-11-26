// A scene: one SVG stage, a list of steps (each with a caption), and ONE draw function of time.
// Used by prepared visuals (web/viz/visual.js, docs/visuals.md) as ctx.scene({...}).
//
// Why a function of time instead of chained transitions: every moment of the animation can then be
// drawn on its own. The learner can step, go back and replay; a tutor can embed one moment as a
// still (`?step=3`); and `bin/learn visuals check` can render each step headless and look at it,
// which is the point of preparing a drawing ahead (a transition that only exists while it runs
// can't be checked).
//
//   const sc = ctx.scene({ w: 760, h: 360, steps: [
//     { id: 'bud',  title: 'A vesicle buds', text: 'markdown caption…', dur: 2.5, hl: ['cargo'] },
//     { id: 'fuse', title: 'It fuses',       text: '…' } ] });
//   const g = sc.svg.append('g');              // sc.svg: a d3 selection, viewBox 0 0 w h
//   …build the shapes once…
//   sc.draw(f => {                             // called for every frame; set positions from f
//     const b = sc.ease(f.at('bud'));          // f.at(id | index): 0 before that step, 0→1 during, 1 after
//     vesicle.attr('cx', sc.lerp(100, 400, b));
//     sc.show(label, f.at('fuse') > 0.5);      // f.seg(id, a, b): progress inside part of a step
//   });                                        // f.t: 0…steps.length, f.i: current step, f.clock: seconds
//
// Controls (the same on every scene, so the learner learns them once): Back, Play/Next (plays one
// step and stops, so the caption can be read), Play all, one dot per step (click = play that step),
// ← / → / space when focused. Nothing moves until the learner asks (docs/design.md, "Never
// interrupt reading"), unless the scene sets `ambient: true` (thermal jiggle that is the point).
import { h } from './core.js';

const NS = 'http://www.w3.org/2000/svg';
const memo = new Map();   // where the learner left a scene survives re-renders of the page
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lerp = (a, b, p) => a + (b - a) * p;
const ease = p => { p = clamp(p); return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; };
// a small seeded generator: the same "random" motion on every run, so a checked frame is the frame the learner sees
function rng(seed = 1) { let a = seed >>> 0 || 1; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
// smooth pseudo-random wobble in [-1, 1] as a function of time (sum of three sines; n picks the phase)
const wobble = (time, n = 0, speed = 1) => (Math.sin(time * 1.7 * speed + n * 12.9898) + Math.sin(time * 2.9 * speed + n * 78.233) * 0.6 + Math.sin(time * 4.3 * speed + n * 37.719) * 0.35) / 1.95;

// Drawing helpers that don't need a scene (the topic's kit uses them too): ctx.tools
export function tools(ctx) {
  const d3 = window.d3;
  const sel = x => (x && x.node ? x : d3.select(x));
  const T = {
    clamp, lerp, ease, rng, wobble,
    mix: (a, b, p) => d3.interpolateRgb(a, b)(clamp(p)),
    // text that stays readable on whatever is behind it: theme colour plus a halo in the box's background
    label(parent, x, y, text, o = {}) {
      const t = sel(parent).append('text').attr('x', x).attr('y', y).attr('text-anchor', o.anchor || 'middle')
        .attr('font-size', o.size || 13).attr('font-weight', o.weight || (o.bold ? 650 : null))
        .attr('fill', o.fill || (o.muted ? 'var(--muted)' : 'var(--fg)')).attr('font-style', o.italic ? 'italic' : null)
        .style('pointer-events', 'none');
      if (o.halo !== false) t.attr('paint-order', 'stroke').attr('stroke', o.haloColor || 'var(--well)').attr('stroke-width', o.haloWidth || 3.5).attr('stroke-linejoin', 'round');
      const lines = String(text).split('\n');
      if (lines.length === 1) t.text(text); else lines.forEach((l, i) => t.append('tspan').attr('x', x).attr('dy', i ? '1.2em' : 0).text(l));
      if (o.key) ctx.key(t.node(), o.key);
      return t;
    },
    // text inside a filled shape: dark on the legend's mid-tone colours (reads in both themes)
    inlabel(parent, x, y, text, o = {}) { return T.label(parent, x, y, text, { halo: false, fill: o.fill || '#10202e', size: 12, weight: 600, ...o }); },
    // a straight or bowed arrow; returns the <path>. o: color, width, bow (px sideways), dash, head (false = none), key
    arrow(parent, a, b, o = {}) {
      const p = sel(parent), color = o.color || 'var(--fg)', id = ctx.uid('ah' + String(color).replace(/[^a-z0-9]/gi, ''));
      const svg = p.node().ownerSVGElement || p.node();
      if (o.head !== false && !svg.querySelector('#' + CSS.escape(id))) {
        let defs = d3.select(svg).select('defs'); if (defs.empty()) defs = d3.select(svg).insert('defs', ':first-child');
        defs.append('marker').attr('id', id).attr('viewBox', '0 0 10 10').attr('refX', 8.5).attr('refY', 5).attr('markerWidth', 6.5).attr('markerHeight', 6.5).attr('orient', 'auto-start-reverse')
          .append('path').attr('d', 'M0,1 L9,5 L0,9 z').attr('fill', color);
      }
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1, bow = o.bow || 0;
      const d = bow ? `M${a[0]},${a[1]} Q${mx - dy / L * bow},${my + dx / L * bow} ${b[0]},${b[1]}` : `M${a[0]},${a[1]} L${b[0]},${b[1]}`;
      const path = p.append('path').attr('d', d).attr('fill', 'none').attr('stroke', color).attr('stroke-width', o.width || 2).attr('stroke-linecap', 'round')
        .attr('stroke-dasharray', o.dash || null).attr('marker-end', o.head === false ? null : `url(#${id})`).style('pointer-events', 'none');
      if (o.key) ctx.key(path.node(), o.key);
      return path;
    },
    // fade and really hide: an element at opacity 0 still catches the pointer and the checker's eye
    show(s, on, max = 1) { const a = on === true ? max : on === false ? 0 : clamp(on) * max; sel(s).attr('opacity', a).style('display', a < 0.02 ? 'none' : null); return s; },
    // point at fraction p of a path element's length -> [x, y]
    along(pathNode, p) { const n = pathNode.node ? pathNode.node() : pathNode, L = n.getTotalLength(), q = n.getPointAtLength(clamp(p) * L); return [q.x, q.y]; },
    still: () => !!window.__vizStill,
  };
  return T;
}

export function makeScene(box, ctx, spec = {}, opts = {}) {
  const d3 = window.d3, T = ctx.tools || tools(ctx);
  const W = spec.w || 760, H = spec.h || 360;
  const steps = (spec.steps || []).map((s, i) => ({ dur: 2.5, ...s, id: s.id || 's' + (i + 1) }));
  const N = steps.length;
  const still = !!window.__vizStill;                 // headless check: draw one moment, never run
  const calm = still || matchMedia('(prefers-reduced-motion: reduce)').matches;
  const idx = id => { if (typeof id === 'number') return id; const k = steps.findIndex(s => s.id === id); if (k < 0) throw new Error(`scene: no step "${id}" (steps: ${steps.map(s => s.id).join(', ')})`); return k; };
  // which steps this embed may show: ?upto=3 stops there (show the start, ask what comes next)
  const stepNo = v => { if (v == null || v === '') return null; const n = Number(v); if (Number.isFinite(n)) return clamp(Math.round(n), 1, N) - 1; const k = steps.findIndex(s => s.id === String(v)); return k < 0 ? null : k; };
  const last = N ? (stepNo(opts.upto) ?? N - 1) : 0, limit = N ? last + 1 : 0;

  const stage = h('div', { class: 'sc-stage' });
  const svgEl = document.createElementNS(NS, 'svg');
  svgEl.setAttribute('viewBox', `0 0 ${W} ${H}`); svgEl.setAttribute('class', 'sc-svg'); svgEl.style.maxWidth = (spec.maxWidth || W) + 'px';
  stage.append(svgEl);
  const bar = h('div', { class: 'sc-bar' }), text = h('div', { class: 'sc-text' }), controls = h('div', { class: 'sliders sc-controls', hidden: '' });
  box.append(stage, bar, text, controls);
  box.classList.add('viz-scene'); box.tabIndex = 0;

  const key = `${opts.name || spec.name || ''}|${opts.step ?? ''}|${opts.t ?? ''}|${opts.upto ?? ''}`;
  const st = { t: 0, playing: false, auto: false, target: 0, clock: 0, raf: 0, lastTs: 0, hold: 0, visible: true };
  const start = opts.t != null && Number.isFinite(Number(opts.t)) ? clamp(Number(opts.t), 0, limit) : stepNo(opts.step) != null ? Math.min(stepNo(opts.step), last) + 1 : null;
  st.t = memo.has(key) && !still ? memo.get(key) : start ?? 0;
  let drawFn = null;

  // ---- controls: the same on every scene
  const B = (cls, label, title, fn) => h('button', { type: 'button', class: 'btn btn-small ' + cls, title, onclick: e => { e.stopPropagation(); fn(); } }, label);
  const back = B('', '◀ Back', 'Back one step (←)', () => rest(Math.ceil(st.t - 1e-6) - 1));
  const main = B('btn-primary sc-main', '', 'Play the next step (→ or space)', () => primary());
  const all = B('btn-quiet', '▶▶ Play all', 'Play every step in a row, pausing on each', () => { if (st.t >= limit - 1e-6) st.t = 0; st.auto = true; playTo(Math.floor(st.t + 1e-6) + 1); });
  const dots = h('div', { class: 'steps-dots sc-dots' }, steps.map((s, k) => h('button', { type: 'button', class: 'steps-dot', title: `Step ${k + 1}: ${s.title || ''}`, disabled: k > last ? '' : null, onclick: e => { e.stopPropagation(); st.auto = false; st.t = k; playTo(k + 1); } })));
  const where = h('span', { class: 'sc-where' });
  if (N && opts.controls !== 0 && opts.controls !== '0') bar.append(...[back, main, N > 2 ? all : null, dots, where].filter(Boolean)); else if (!N) bar.hidden = true; else bar.append(where);
  // captions: all stacked in one grid cell, one visible, so the box never changes height between steps
  const caps = steps.map((s, k) => { const c = h('div', { class: 'sc-cap' }); if (s.text && opts.text !== 0 && opts.text !== '0') c.append(ctx.md(s.text)); text.append(c); return c; });
  if (!caps.some(c => c.firstChild)) text.hidden = true;

  const capIndex = () => (st.t <= 0 ? 0 : Math.min(N - 1, Math.ceil(st.t - 1e-6) - 1));
  let shownCap = -1;
  function frame() {
    const t = st.t, i = N ? Math.min(N - 1, Math.floor(t)) : 0;
    const at = id => clamp(t - idx(id));
    const f = { t, i, id: steps[i]?.id, p: N ? clamp(t - i) : 0, clock: still ? 1.3 + t * 1.9 : st.clock, at, seg: (id, a, b) => clamp((at(id) - a) / (b - a)), is: id => idx(id) === capIndex(), still };
    if (drawFn) drawFn(f);
    const c = capIndex();
    if (c !== shownCap) {
      shownCap = c;
      caps.forEach((el, k) => el.classList.toggle('on', k === c));
      [...dots.children].forEach((d, k) => { d.classList.toggle('on', k === c); d.classList.toggle('done', k < c); });
      if (N) where.replaceChildren(h('span', { class: 'sc-count', text: `${c + 1} / ${N}` }), h('span', { class: 'sc-title', html: ctx.inline(steps[c].title || '') }));
      if (steps[c]?.hl) ctx.highlight(steps[c].hl);
    }
    const atRest = !st.playing, end = t >= limit - 1e-6;
    main.textContent = st.playing ? '❚❚ Pause' : end ? '↻ Replay' : t <= 0 ? '▶ Play' : 'Next ▶';
    back.disabled = t <= 0 && atRest;
    box.classList.toggle('sc-playing', st.playing);
  }
  function tick(ts) {
    st.raf = 0;
    const dt = Math.min(0.05, (ts - (st.lastTs || ts)) / 1000); st.lastTs = ts;
    if (!st.visible || document.hidden) { st.lastTs = 0; return; }
    st.clock += dt;
    if (st.playing) {
      if (st.hold > 0) { st.hold -= dt; if (st.hold <= 0) playTo(Math.floor(st.t + 1e-6) + 1); }
      else {
        const k = Math.min(N - 1, Math.floor(st.t + 1e-9));
        st.t = Math.min(st.target, st.t + dt / (steps[k].dur || 2.5));
        if (st.t >= st.target - 1e-9) {
          st.t = st.target;
          if (st.auto && st.t < limit - 1e-6) st.hold = Math.min(7, 1.4 + String(steps[k].text || '').length * 0.03);   // time to read the caption
          else { st.playing = false; st.auto = false; memo.set(key, st.t); }
        }
      }
    }
    frame();
    loop();
  }
  function loop() { if (!st.raf && !still && (st.playing || (spec.ambient && !calm)) && st.visible) st.raf = requestAnimationFrame(tick); }
  function playTo(target) {
    st.target = clamp(target, 0, limit); st.hold = 0;
    if (calm) { st.t = st.target; st.playing = false; st.auto = false; memo.set(key, st.t); frame(); return; }
    st.playing = true; st.lastTs = 0; frame(); loop();
  }
  function rest(t) { st.playing = false; st.auto = false; st.hold = 0; st.t = clamp(t, 0, limit); memo.set(key, st.t); frame(); loop(); }
  function primary() {
    if (st.playing) return rest(st.t);
    if (st.t >= limit - 1e-6) { st.t = 0; return playTo(1); }
    st.auto = false;
    playTo(Number.isInteger(st.t) ? st.t + 1 : st.target > st.t ? st.target : Math.ceil(st.t));
  }
  box.addEventListener('keydown', e => {
    if (e.target.closest('input, button, textarea') && e.key === ' ') return;
    if (e.key === 'ArrowRight') { e.preventDefault(); if (!st.playing && st.t < limit) primary(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); rest(Math.ceil(st.t - 1e-6) - 1); }
    else if (e.key === ' ') { e.preventDefault(); primary(); }
  });
  if (!still && 'IntersectionObserver' in window) new IntersectionObserver(es => { st.visible = es.some(e => e.isIntersecting); if (st.visible) { st.lastTs = 0; loop(); } }).observe(box);

  const sc = {
    ...T, svg: d3.select(svgEl), w: W, h: H, steps, el: box,
    layer: name => d3.select(svgEl).append('g').attr('class', name ? 'sc-layer-' + name : null),
    draw(fn) { drawFn = fn; frame(); loop(); if ((opts.play === 1 || opts.play === '1') && !still && st.t < limit) playTo(Math.floor(st.t) + 1); return sc; },
    redraw: frame,
    // a slider or other control under the caption: sc.control(ctx.slider(...))
    control(node) { controls.hidden = false; controls.append(node); return node; },
    goto: k => rest(idx(k) + 1), play: k => { st.t = idx(k); playTo(idx(k) + 1); },
    get t() { return st.t; },
  };
  (window.__scenes ||= []).push({ name: opts.name || null, steps: steps.map(s => ({ id: s.id, title: s.title || '' })), ambient: !!spec.ambient });
  return sc;
}
