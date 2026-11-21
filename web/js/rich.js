// Rich content: markdown + viz mounting + glossary auto-links + linked highlighting + hover cards.
import { md, vizSpecs, esc } from './md.js';
import { registry, h } from '../viz/index.js';

const cfg = { terms: [], termRe: null, resolveTerm: () => null, resolveMsg: () => null, hoverCard: null, onRef: () => {} };
export function configure(o) { Object.assign(cfg, o); if (o.terms) buildTermIndex(o.terms); }

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
function reEsc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function buildTermIndex(entries) {
  const forms = [];
  for (const e of entries) for (const f of [e.term, ...(e.aliases || [])]) if (f && f.length > 1) forms.push({ form: f, entry: e });
  forms.sort((a, b) => b.form.length - a.form.length);
  cfg.forms = forms;
  cfg.formMap = new Map(forms.map(f => [f.form.toLowerCase(), f]));
  cfg.termRe = forms.length ? new RegExp(`(?<![\\w-])(${forms.map(f => reEsc(f.form)).join('|')})(?:e?s)?(?![\\w])`, 'gi') : null;
}
const SKIP = 'code, pre, a, button, .katex, .term, .lk, h1, h2, .mx, .tok, .callout-label, summary, .no-terms, input, textarea';
export function linkTerms(root) {
  if (!cfg.termRe) return;
  const seen = new Set();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: n => (n.nodeValue.trim() && !n.parentElement.closest(SKIP) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });
  const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const text = node.nodeValue;
    cfg.termRe.lastIndex = 0;
    let m, last = 0, frag = null;
    while ((m = cfg.termRe.exec(text))) {
      const f = cfg.formMap.get(m[1].toLowerCase());
      if (!f) continue;
      // case-sensitive for forms with capitals (acronyms, names)
      if (/[A-Z]/.test(f.form) && m[1] !== f.form) continue;
      const id = f.entry.term;
      if (seen.has(id)) continue;
      seen.add(id);
      frag = frag || document.createDocumentFragment();
      frag.append(text.slice(last, m.index));
      const s = document.createElement('span');
      s.className = 'term'; s.dataset.term = id; s.textContent = m[0];
      frag.append(s);
      last = m.index + m[0].length;
    }
    if (frag) { frag.append(text.slice(last)); node.replaceWith(frag); }
  }
}

// ---------------------------------------------------------------- linked highlighting
const PALETTE = 6;
function keyColor(scope, k) {
  if (scope.__fixed?.[k]) return scope.__fixed[k];
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
  const t = e.target.closest?.('.term, .ref-msg, .ref-term, .ref-skill');
  if (!t) return;
  const level = levelOf(t);
  clearTimeout(hideT);
  if (cards[level]?.for === t) { closeFrom(level + 1); return; }
  clearTimeout(showT);
  showT = setTimeout(() => showCardFor(t, level), cards.length > level ? 80 : 280);
  t.addEventListener('mouseleave', () => { clearTimeout(showT); scheduleHide(level); }, { once: true });
});
document.addEventListener('click', e => {
  const t = e.target.closest?.('.term, [data-ref]');
  if (!t) return;
  e.preventDefault();
  closeAll();
  if (t.classList.contains('term')) cfg.onRef('term', t.dataset.term, t);
  else cfg.onRef(t.dataset.ref, t.dataset.id, t);
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAll(); });

export { esc, md };
