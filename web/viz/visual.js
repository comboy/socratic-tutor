// `visual`: a drawing or animation prepared ahead of the lesson, kept in the topic
// (topics/<slug>/visuals/<name>.js) and dropped into a message, a term page or a wiki page with
// one line:
//
//   ![Watch which side the sugar ends up on](visual:budding-and-fusion?step=3)
//
// (or ```viz visual { name: "budding-and-fusion", step: 3 }```). Why prepared: a drawing written
// inside a reply is composed in seconds and can't be looked at before the learner sees it; one
// made ahead is rendered, checked step by step and reviewed first (`bin/learn visuals`,
// docs/visuals.md). The file is the body of function (el, ctx, d3, opts, kit), like `viz js`:
//   opts  the parameters of this embed (?step=3&hl=lumen -> { step: 3, hl: "lumen" })
//   kit   the topic's own drawing kit (visuals/_kit.js): how its recurring things are drawn
//   ctx   as in `viz js`, plus ctx.scene({ w, h, steps }) (web/viz/scene.js) and ctx.tools
import { register, h } from './core.js';
import { makeScene } from './scene.js';
import { topicSlug } from '../js/md.js';

const cache = new Map();   // url -> Promise<string | null>
function load(url) {
  if (!cache.has(url)) cache.set(url, fetch(url, { cache: 'no-cache' }).then(r => (r.ok ? r.text() : null)).catch(() => null));
  return cache.get(url);
}
// a visual that changed on disk is drawn fresh the next time the page renders it
export function forgetVisuals() { cache.clear(); }

// the header comment: /* visual \n key: value … */  (app/visuals.js reads the same)
export function header(src) {
  const m = String(src).match(/^\s*\/\*+\s*visual\b[^\n]*\n([\s\S]*?)\*\//), out = {};
  let k = null;
  for (const line of (m ? m[1] : '').split('\n')) {
    const kv = line.match(/^\s*([a-z][a-z-]*)\s*:\s*(.*)$/);
    if (kv) { k = kv[1]; out[k] = kv[2].trim(); } else if (k && line.trim()) out[k] += ' ' + line.trim();
  }
  return out;
}

function fail(box, msg) {
  box.replaceChildren();
  box.classList.add('viz-error');
  box.append(h('div', { class: 'viz-err-msg', text: 'visual: ' + msg }));
}

register('visual', (box, spec, ctx) => {
  spec = spec || {};
  const name = String(spec.name || ''), slug = topicSlug();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error(`"${name}" is not a visual's name (bin/learn visuals lists them)`);
  if (!slug) throw new Error('no topic is open');
  const { name: _n, caption, ...opts } = spec;
  opts.name = name;
  box.classList.add('viz-loading');
  window.__vizLoading = (window.__vizLoading || 0) + 1;
  Promise.all([load(`/visuals/${slug}/${name}.js`), load(`/visuals/${slug}/_kit.js`)]).then(([src, kitSrc]) => {
    if (!box.isConnected && !window.__vizStill) return;
    if (src == null) return fail(box, `there is no prepared visual "${name}" in this topic (bin/learn visuals lists them)`);
    const head = header(src);
    try {
      const vctx = Object.create(ctx);
      vctx.scene = s => makeScene(stageBox, vctx, s, opts);
      vctx.opts = opts;
      if (caption) box.append(h('div', { class: 'viz-title', html: ctx.inline(caption) }));
      const stageBox = h('div', { class: 'visual-body' });
      box.append(stageBox);
      const kit = kitSrc ? new Function('ctx', 'd3', kitSrc)(vctx, window.d3) || {} : {};
      new Function('el', 'ctx', 'd3', 'opts', 'kit', src)(stageBox, vctx, window.d3, opts, kit);
      for (const r of box.__legends || []) if (!r.parentNode) box.append(r);
      // keys to light up from the embed: ?hl=lumen,cargo
      if (opts.hl) ctx.highlight(String(opts.hl).split(',').map(s => s.trim()).filter(Boolean));
      // honest labelling: what kind of picture this is and what it leaves out, under every use
      // (the first sentence always; the rest folded, so a careful list of omissions doesn't bury the drawing)
      if (head.simplified && opts.note !== 0 && opts.note !== '0') {
        const cut = head.simplified.length > 190 ? head.simplified.search(/[.:;] (?=[A-Z])/) : -1;
        const first = cut > 20 ? head.simplified.slice(0, cut + 1) : head.simplified, rest = cut > 20 ? head.simplified.slice(cut + 2) : '';
        const body = h('div', { class: 'visual-note-body' }, ctx.md(first));
        if (rest) body.append(h('details', {}, h('summary', { text: 'What else is simplified' }), ctx.md(rest)));
        box.append(h('div', { class: 'visual-note' }, h('span', { class: 'visual-note-tag', text: head.kind || 'Schematic' }), body));
      }
      box.dataset.visual = name;
      ctx.mountAll(box);
    } catch (e) { fail(box, `${name}: ${e.message}`); if (window.__vizStill) console.error(`visual ${name}: ${e.stack || e}`); }
  }).finally(() => { box.classList.remove('viz-loading'); window.__vizLoading--; });
});
