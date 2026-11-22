// Rich content: markdown + viz mounting + glossary auto-links + linked highlighting + hover cards.
import { md, vizSpecs, esc, setMedia } from './md.js';
import { registry, h } from '../viz/index.js';
import { termMatcher } from './terms.js';

const cfg = { terms: [], matcher: null, resolveTerm: () => null, resolveMsg: () => null, hoverCard: null, onRef: () => {}, legend: [], legendMap: new Map() };
export function configure(o) {
  Object.assign(cfg, o);
  if (o.terms) buildTermIndex(o.terms);
  if (o.media) setMedia(o.media.slug, o.media.index);
  if (o.legend) cfg.legendMap = new Map((o.legend || []).filter(x => x?.key && x.color).map(x => [String(x.key), x.color]));
}

// ---------------------------------------------------------------- render
// Render markdown into el (replacing contents). Returns el.
export function renderInto(el, src, { terms = true, scope = true } = {}) {
  el.innerHTML = md(src);
  if (scope) el.classList.add('hl-scope');
  finish(el, { terms });
  return el;
}
export function rich(src, cls = '', opts) { const d = document.createElement('div'); d.className = 'md ' + cls; return renderInto(d, src, { scope: false, ...opts }); }

function finish(el, { terms = true } = {}) {
  mountAll(el);
  if (terms) linkTerms(el);
  colorKeys(el.closest('.hl-scope') || el);
}

export function mountAll(root) {
  for (const box of root.querySelectorAll('[data-viz]')) {
    if (box.__mounted) continue;
    box.__mounted = true;
    const spec = vizSpecs.get(box.dataset.viz);
    if (!spec) continue;
    const comp = registry[spec.type];
    const ctx = makeCtx(box);
    try {
      if (!comp) throw new Error(`unknown viz type "${spec.type}" (known: ${Object.keys(registry).join(', ')})`);
      const parsed = spec.type === 'js' ? null : new Function(`return (${spec.src}\n)`)();
      comp(box, parsed, ctx, spec.src);
    } catch (e) {
      box.classList.add('viz-error');
      box.append(h('div', { class: 'viz-err-msg', text: `viz ${spec.type}: ${e.message}` }), h('details', {}, h('summary', { text: 'source' }), h('pre', { text: spec.src })));
    }
  }
}

function makeCtx(box) {
  const scope = () => box.closest('.hl-scope') || box;
  return {
    d3: window.d3,
    h,
    md: (src, cls = '') => { const d = rich(src, cls); return d; },
    inline: s => (s == null ? '' : md(String(s), { inline: true })),
    key: (el, k) => { el.setAttribute('data-k', k); return el; },
    color: k => keyColor(scope(), k),
    // the topic's legend as a row of swatches (all entries, or these keys); each item carries its
    // key, so hovering it lights up the parts of the drawing tagged with ctx.key(el, key)
    legend: keys => legendRow(keys, scope()),
    highlight: keys => setPinned(scope(), keys, true),
    // fixed colours for keys in this scope ({ q: 'var(--vq)' }), so a key keeps one colour
    // whatever order the keys appear in (e.g. one colour per vector type)
    fixColors: map => { const s = scope(); s.__fixed = { ...(s.__fixed || {}), ...map }; colorKeys(s); },
    mountAll: el => { mountAll(el); linkTerms(el); colorKeys(scope()); },
    slider: (label, min, max, value, step, onChange) => {
      const out = h('output', { text: value });
      const inp = h('input', { type: 'range', min, max, step, value });
      inp.addEventListener('input', () => { out.textContent = inp.value; onChange(Number(inp.value)); });
      return h('label', { class: 'slider' }, h('span', { class: 'slider-label', html: md(String(label), { inline: true }) }), inp, out);
    },
  };
}

// ---------------------------------------------------------------- glossary auto-linking
// Every occurrence of a glossary term (or alias, plural, other capitalisation: terms.js) gets a
// hover card. The first one in a rendered block is underlined clearly, repeats more faintly
// (.term-again), so a term-heavy message doesn't turn into a wall of underlines.
function buildTermIndex(entries) { cfg.matcher = termMatcher(entries); }
// Never inside code, formulas, links/buttons, highlight spans, viz drawings (an HTML span inside
// SVG <text> doesn't render, and chart labels aren't prose; captions and step text are rendered
// with ctx.md and get their own links), page titles, callout labels and <summary> (clickable).
const SKIP = 'code, pre, a, button, .katex, .term, .tipref, .lk, h1, .viz, .mx, .tok, .callout-label, summary, .no-terms, input, textarea, svg';
export function linkTerms(root) {
  if (!cfg.matcher) return;
  const seen = new Set();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: n => (n.nodeValue.trim() && !n.parentElement.closest(SKIP) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });
  const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const text = node.nodeValue;
    const hits = cfg.matcher.find(text);
    if (!hits.length) continue;
    const frag = document.createDocumentFragment();
    let last = 0;
    for (const m of hits) {
      const id = m.entry.term;
      frag.append(text.slice(last, m.index));
      const s = document.createElement('span');
      s.className = seen.has(id) ? 'term term-again' : 'term';
      s.dataset.term = id; s.textContent = m.text;
      frag.append(s);
      seen.add(id);
      last = m.end;
    }
    frag.append(text.slice(last));
    node.replaceWith(frag);
  }
}

// ---------------------------------------------------------------- linked highlighting
// A key's colour: a viz's own fixColors, else the topic legend (topic.json "legend": one colour per
// recurring thing, the same in every message and page), else the next of the six highlight colours.
const PALETTE = 6;
function keyColor(scope, k) {
  if (scope.__fixed?.[k]) return scope.__fixed[k];
  if (cfg.legendMap.has(k)) return cfg.legendMap.get(k);
  scope.__colors = scope.__colors || new Map();
  if (!scope.__colors.has(k)) scope.__colors.set(k, scope.__colors.size % PALETTE);
  return `var(--k${scope.__colors.get(k)})`;
}
function colorKeys(scope) {
  for (const el of scope.querySelectorAll('[data-k]')) {
    const k = el.getAttribute('data-k').split(/\s+/)[0];
    if (k) el.style.setProperty('--kc', keyColor(scope, k));
  }
}
const keysOf = el => (el.getAttribute('data-k') || '').split(/\s+/).filter(Boolean);
export function legendEntries(keys) {
  const all = (cfg.legend || []).filter(x => x?.key);
  return keys ? [].concat(keys).map(k => all.find(x => x.key === k) || { key: k, label: k }) : all;
}
export function legendRow(keys, scope = null) {
  const row = h('div', { class: 'viz-legend' }, ...legendEntries(keys).map(x => h('span', { class: 'vl-item', 'data-k': x.key, title: x.term ? `${x.label || x.key} (glossary: ${x.term})` : '' },
    h('span', { class: 'vl-sw', style: { background: x.color || (scope ? keyColor(scope, x.key) : 'var(--faint)') } }), h('span', { class: 'vl-label', text: x.label || x.key }))));
  return row;
}
function apply(scope, keys, cls) {
  const set = new Set(keys);
  for (const el of scope.querySelectorAll('[data-k]')) {
    const ks = keysOf(el);
    const hit = ks.find(k => set.has(k));
    el.classList.toggle(cls, !!hit);
    if (hit) el.style.setProperty('--hc', keyColor(scope, hit));
  }
  scope.classList.toggle('has-' + cls, set.size > 0);
}
function setPinned(scope, keys, replace) {
  scope.__pinned = replace ? new Set(keys) : scope.__pinned || new Set();
  apply(scope, [...scope.__pinned], 'pin');
}

document.addEventListener('mouseover', e => {
  const el = e.target.closest?.('[data-k]');
  if (!el) return;
  const scope = el.closest('.hl-scope') || document.body;
  apply(scope, keysOf(el), 'hl');
  el.addEventListener('mouseleave', () => apply(scope, [], 'hl'), { once: true });
});
document.addEventListener('click', e => {
  const el = e.target.closest?.('[data-k]');
  if (!el || e.target.closest('button, input, a')) return;
  const scope = el.closest('.hl-scope') || document.body;
  const ks = keysOf(el);
  const cur = scope.__pinned || new Set();
  const on = ks.some(k => cur.has(k));
  setPinned(scope, on ? [...cur].filter(k => !ks.includes(k)) : [...cur, ...ks], true);
});

// ---------------------------------------------------------------- hover cards
// Cards stack: a link inside card N opens card N+1 and card N stays open.
const cards = [];            // [{ el, for }]
let showT = null, hideT = null;
const levelOf = el => { const c = el.closest?.('.hovercard'); return c ? +c.dataset.level + 1 : 0; };
function closeFrom(level) { while (cards.length > level) cards.pop().el.remove(); }
function scheduleHide(level) { clearTimeout(hideT); hideT = setTimeout(() => closeFrom(level), 240); }
function closeAll() { clearTimeout(showT); clearTimeout(hideT); closeFrom(0); }
function showCardFor(target, level) {
  if (!target.isConnected) return;
  const content = cfg.hoverCard?.(target);
  closeFrom(level);
  if (!content) return;
  const c = document.createElement('div');
  c.className = 'hovercard';
  c.dataset.level = level;
  c.style.zIndex = 50 + level;
  c.addEventListener('mouseenter', () => { clearTimeout(hideT); if (cards.length > level + 1) scheduleHide(level + 1); });
  c.addEventListener('mouseleave', () => scheduleHide(0));
  c.append(content);
  document.body.append(c);
  cards.push({ el: c, for: target });
  const r = target.getBoundingClientRect();
  const cw = Math.min(420, window.innerWidth - 24);
  c.style.width = cw + 'px';
  let left = Math.min(Math.max(12, r.left), window.innerWidth - cw - 12);
  const parent = cards[level - 1]?.el.getBoundingClientRect();
  const ch = c.offsetHeight;
  let top;
  if (parent && (parent.right + 6 + cw < window.innerWidth - 8 || parent.left - 6 - cw > 8)) {
    // nested: beside the parent card, level with the link, so the parent stays readable
    left = parent.right + 6 + cw < window.innerWidth - 8 ? parent.right + 6 : parent.left - 6 - cw;
    top = Math.min(Math.max(8, r.top - 12), window.innerHeight - ch - 8);
  } else {
    top = r.bottom + 8 + ch < window.innerHeight ? r.bottom + 6 : Math.max(8, r.top - ch - 6);
  }
  c.style.left = left + 'px';
  c.style.top = Math.max(8, top) + 'px';
  requestAnimationFrame(() => c.classList.add('on'));
}
document.addEventListener('mouseover', e => {
  const t = e.target.closest?.('.term, .tipref, .ref-msg, .ref-term, .ref-skill');
  if (!t) return;
  const level = levelOf(t);
  clearTimeout(hideT);
  if (cards[level]?.for === t) { closeFrom(level + 1); return; }
  clearTimeout(showT);
  showT = setTimeout(() => showCardFor(t, level), cards.length > level ? 80 : 280);
  t.addEventListener('mouseleave', () => { clearTimeout(showT); scheduleHide(level); }, { once: true });
});
document.addEventListener('click', e => {
  // a tip has nothing to open: a click just shows its card right away
  const tip = e.target.closest?.('.tipref');
  if (tip) { clearTimeout(showT); clearTimeout(hideT); if (cards[levelOf(tip)]?.for !== tip) showCardFor(tip, levelOf(tip)); return; }
  const t = e.target.closest?.('.term, [data-ref]');
  if (!t) return;
  e.preventDefault();
  closeAll();
  if (t.classList.contains('term')) cfg.onRef('term', t.dataset.term, t);
  else cfg.onRef(t.dataset.ref, t.dataset.id, t);
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeAll(); closeLightbox(); } });

// ---------------------------------------------------------------- image lightbox
// Click an image in rendered content to see it as large as the window allows, with its caption
// and credit; a click anywhere or Escape closes it.
function closeLightbox() { document.querySelector('.lightbox')?.remove(); }
document.addEventListener('click', e => {
  if (e.target.closest?.('.lightbox')) { if (!e.target.closest('a')) closeLightbox(); return; }
  const img = e.target.closest?.('.md img');
  if (!img || e.target.closest('a, button, .viz')) return;
  const cap = img.closest('.media-fig')?.querySelector('.media-cap');
  const box = h('div', { class: 'lightbox', title: 'Click or press Escape to close' },
    h('img', { src: img.currentSrc || img.src, alt: img.alt }),
    cap ? h('div', { class: 'lightbox-cap', html: cap.innerHTML }) : img.alt ? h('div', { class: 'lightbox-cap', text: img.alt }) : null);
  closeLightbox();
  document.body.append(box);
});

export { esc, md };
