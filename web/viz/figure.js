// `viz figure`: a real image (a media: file) with only the parts that matter brought forward.
// A busy textbook or Commons diagram has ten labels when the lesson needs two: this dims
// everything outside the focus regions, numbers them (with a list of what each one is), draws
// arrows (e.g. the direction to read it in) and can blank out labels that would distract.
//
//   ```viz figure
//   { src: "replication-fork.png",              // a file in topics/<t>/media/ (bin/learn image)
//     caption: "Look at **1** and **2** only",
//     focus: [ { x: .52, y: .18, w: .26, h: .22, label: "helicase unzips the helix", key: "helicase" },
//              { x: .08, y: .56, w: .36, h: .26, label: "the lagging strand, made in pieces" } ],
//     arrows: [ { from: [.95, .5], to: [.62, .5], label: "the fork moves this way" } ],
//     hide: [ { x: 0, y: .9, w: .3, h: .1 } ],     // blank patches over labels that don't matter
//     dim: .55 }                                   // how dark outside the focus regions (0 = off)
//   ```
// Coordinates are fractions of the image (0–1, from the top left), or pixels of the downloaded
// file: an item (region, patch or arrow) with any value above 1 is in pixels (units: "px" or
// "frac" forces one for the whole figure). Each focus region gets a highlight key (its
// `key`, or an automatic one) so hovering a region or its row in the list lights up both, and
// prose can point at it with {{text|key}}. Click the figure to see it full size.
import { register, h } from './core.js';
import { mediaImage, plain } from '../js/md.js';

const NS = 'http://www.w3.org/2000/svg';
function s(tag, attrs = {}, style = {}) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v);
  for (const [k, v] of Object.entries(style)) e.style.setProperty(k, v);
  return e;
}
const num = (v, what) => { if (typeof v !== 'number' || !isFinite(v) || v < 0) throw new Error(`${what}: expected a number ≥ 0, got ${JSON.stringify(v)}`); return v; };

register('figure', (el, spec, ctx) => {
  const file = String(spec.src || '').trim();
  if (!file) throw new Error('figure needs src: a media file (download it with bin/learn image)');
  const loc = mediaImage(/^(media:|https?:)/.test(file) ? file : 'media:' + file);
  const src = loc ? loc.src : /^https?:/.test(file) ? file : null;
  if (!src) throw new Error(`no image ${file}`);
  const vid = el.dataset.viz || 'fig';
  const focus = spec.focus || [], arrows = spec.arrows || [], hide = spec.hide || [];
  focus.forEach((r, i) => ['x', 'y', 'w', 'h'].forEach(k => num(r[k], `focus[${i}].${k}`)));
  hide.forEach((r, i) => ['x', 'y', 'w', 'h'].forEach(k => num(r[k], `hide[${i}].${k}`)));
  arrows.forEach((a, i) => { if (!Array.isArray(a.from) || !Array.isArray(a.to)) throw new Error(`arrows[${i}] needs from: [x, y] and to: [x, y]`); [...a.from, ...a.to].forEach(v => num(v, `arrows[${i}]`)); });
  const keys = focus.map((r, i) => String(r.key || `${vid}-${i + 1}`));
  const label = (r, i) => String(r.n ?? i + 1);

  const img = h('img', { src, alt: plain(spec.caption || spec.alt || file, 200), draggable: 'false' });
  const svg = s('svg', { class: 'fig-over', 'aria-hidden': 'true' });
  const stage = h('div', { class: 'fig-stage', title: 'Click to see it full size' }, img, svg);
  el.append(stage);
  if (focus.some(r => r.label)) {
    el.append(h('ol', { class: 'fig-list' }, ...focus.map((r, i) => r.label ? h('li', { 'data-k': keys[i] },
      h('span', { class: 'fig-n', text: label(r, i) }), h('span', { class: 'fig-label', html: ctx.inline(r.label) })) : null)));
  }
  const info = loc?.info;
  const credit = info ? [info.author, info.license].filter(Boolean).join(' · ') : '';
  if (spec.caption || credit) {
    el.append(h('div', { class: 'media-cap fig-cap' },
      spec.caption ? h('span', { class: 'media-cap-text', html: ctx.inline(spec.caption) }) : null,
      credit ? h('span', { class: 'media-credit' }, credit, info.source ? h('span', {}, ' · ', h('a', { href: info.source, target: '_blank', rel: 'noopener', text: 'source' })) : null) : null));
  }

  function draw() {
    const W = img.naturalWidth, H = img.naturalHeight;
    if (!W || !H) return;
    // per item: pixels if any of its values is above 1, else fractions of the image
    const inPx = vals => spec.units === 'px' || (spec.units !== 'frac' && vals.some(v => v > 1));
    const box = r => { const p = inPx([r.x, r.y, r.w, r.h]), fx = p ? 1 : W, fy = p ? 1 : H; return { x: r.x * fx, y: r.y * fy, w: r.w * fx, h: r.h * fy }; };
    const u = Math.max(W, H) / 100;            // one "unit": badges and labels scale with the image
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.replaceChildren();
    const defs = s('defs');
    svg.append(defs);
    const F = focus.map(box);
    for (const r of hide.map(box)) svg.append(s('rect', { class: 'fig-hide', x: r.x, y: r.y, width: r.w, height: r.h }, { fill: spec.hideColor || '#fff' }));
    const dim = spec.dim ?? 0.55;
    if (dim > 0 && focus.length) {
      const mask = s('mask', { id: `fig-mask-${vid}`, maskUnits: 'userSpaceOnUse', x: 0, y: 0, width: W, height: H });
      mask.append(s('rect', { x: 0, y: 0, width: W, height: H, fill: '#fff' }));
      for (const r of F) mask.append(s('rect', { x: r.x, y: r.y, width: r.w, height: r.h, rx: u, fill: '#000' }));
      defs.append(mask);
      svg.append(s('rect', { class: 'fig-dim', x: 0, y: 0, width: W, height: H, mask: `url(#fig-mask-${vid})`, 'fill-opacity': dim }));
    }
    focus.forEach((r, i) => {
      const c = ctx.color(keys[i]);
      const g = s('g', { class: 'fig-region', 'data-k': keys[i] }, { '--kc': c });
      const b = F[i];
      g.append(s('rect', { class: 'fig-box', x: b.x, y: b.y, width: b.w, height: b.h, rx: u, 'vector-effect': 'non-scaling-stroke' }));
      // the number badge sits on the region's top-left corner, kept inside the image
      const cx = Math.min(Math.max(b.x, 2.6 * u), W - 2.6 * u), cy = Math.min(Math.max(b.y, 2.6 * u), H - 2.6 * u);
      g.append(s('circle', { class: 'fig-badge', cx, cy, r: 2.4 * u }));
      const t = s('text', { class: 'fig-badge-n', x: cx, y: cy, 'font-size': 2.9 * u, 'text-anchor': 'middle', 'dominant-baseline': 'central' });
      t.textContent = label(r, i);
      g.append(t);
      svg.append(g);
    });
    arrows.forEach((a, i) => {
      const c = a.key ? ctx.color(a.key) : 'var(--k1)';
      const id = `fig-ah-${vid}-${i}`;
      const m = s('marker', { id, viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: 5, markerHeight: 5, orient: 'auto-start-reverse' });
      m.append(s('path', { d: 'M0,0 L10,5 L0,10 z' }, { fill: c }));
      defs.append(m);
      const p = inPx([...a.from, ...a.to]), fx = p ? 1 : W, fy = p ? 1 : H;
      const [x1, y1, x2, y2] = [a.from[0] * fx, a.from[1] * fy, a.to[0] * fx, a.to[1] * fy];
      const g = s('g', { class: 'fig-arrow', ...(a.key ? { 'data-k': a.key } : {}) });
      g.append(s('line', { x1, y1, x2, y2, 'stroke-width': 1.1 * u, 'marker-end': `url(#${id})`, 'stroke-linecap': 'round' }, { stroke: c }));
      if (a.label) {
        // the label sits beyond the tail, on the side away from the head
        const dx = x1 - x2, dy = y1 - y2, len = Math.hypot(dx, dy) || 1;
        const lx = x1 + dx / len * 1.5 * u, ly = y1 + dy / len * 1.5 * u;
        const t = s('text', { class: 'fig-arrow-label', x: lx, y: ly, 'font-size': 2.6 * u, 'stroke-width': 0.8 * u,
          'text-anchor': Math.abs(dx) < len * 0.4 ? 'middle' : dx > 0 ? 'start' : 'end', 'dominant-baseline': Math.abs(dy) < len * 0.4 ? 'central' : dy > 0 ? 'hanging' : 'auto' }, { fill: c });
        t.textContent = plain(a.label, 80);
        g.append(t);
      }
      svg.append(g);
      // keep the label inside the image (it may start near an edge)
      const t = g.querySelector('text');
      if (t) try {
        const bb = t.getBBox(), pad = u * 0.6;
        const sx = bb.x < pad ? pad - bb.x : bb.x + bb.width > W - pad ? W - pad - bb.x - bb.width : 0;
        const sy = bb.y < pad ? pad - bb.y : bb.y + bb.height > H - pad ? H - pad - bb.y - bb.height : 0;
        if (sx || sy) t.setAttribute('transform', `translate(${sx} ${sy})`);
      } catch {}
    });
  }
  if (img.complete && img.naturalWidth) draw(); else img.addEventListener('load', draw, { once: true });
  img.addEventListener('error', () => {
    el.classList.add('viz-error');
    el.prepend(h('div', { class: 'viz-err-msg', text: `viz figure: can't load ${file} (is it in media/? bin/learn image list)` }));
  }, { once: true });

  // full size: the same figure, as large as the window allows
  stage.addEventListener('click', e => {
    e.stopPropagation();
    document.querySelector('.lightbox')?.remove();
    const big = stage.cloneNode(true);
    big.classList.add('fig-big');
    big.style.setProperty('--ar', `${img.naturalWidth || 4} / ${img.naturalHeight || 3}`);
    const cap = el.querySelector('.fig-cap');
    const list = el.querySelector('.fig-list');
    const box = h('div', { class: 'lightbox', title: 'Click or press Escape to close' }, big,
      list || cap ? h('div', { class: 'lightbox-cap fig-big-cap' }, list ? list.cloneNode(true) : null, cap ? h('div', { html: cap.innerHTML }) : null) : null);
    box.addEventListener('click', () => box.remove());
    document.body.append(box);
  });
});
