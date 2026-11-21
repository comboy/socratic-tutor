// `viz residual`: a tiny transformer worked by hand, step by step.
// Three tokens, d_model 4 with labelled dims, single-head attention (d_head 2), causal mask,
// RMSNorm, a 3-unit ReLU MLP, two layers. Every number is computed live from the weights below
// (or the spec's), so tweaking an input embedding re-runs the whole forward pass.
// The point it makes visible: x is one vector per token per layer (the residual stream), the
// attention and MLP sublayers each *add* to it, and layer 2 reads layer-1 outputs of earlier tokens.
//
// spec (all optional): { token: 2 | "bank", step: 0 | "L2.mix", tokens, vocab, dims, embed, layers,
//   editable: true, id: "state key" }. layers[i] = { Wq, Wk, Wv (d×dh), Wo (dh×d), Wup (d×f),
//   Wdown (f×d), units: [f names] }. tokens must be words from vocab (embed has one row per vocab word).
import { register, registry, h } from './core.js';

export const DEFAULTS = {
  tokens: ['the', 'river', 'bank'],
  vocab: ['the', 'river', 'bank', 'loan', 'flows'],
  dims: ['water', 'money', 'noun', 'shore'],
  embed: [
    [0, 0, -1, 0],      // the: a function word, not a noun
    [1, 0, 1, 0],       // river: watery noun
    [0, 0.5, 1, 0],     // bank: a noun leaning "money" until context says otherwise
    [0, 1, 1, 0],       // loan
    [0.8, 0, -0.5, 0],  // flows
  ],
  layers: [
    { // layer 1: nouns look for water/money words; the MLP turns "water > money" into shore-sense
      Wq: [[0, 0], [0, 0], [1, 0], [0, 0]],
      Wk: [[1, 0], [0, 0], [0, 0], [0, 0]],
      Wv: [[1, 0], [0, 1], [0, 0], [0, 0]],
      Wo: [[0.5, 0, 0, 0], [0, 0.5, 0, 0]],
      units: ['water > money', 'money > water', 'function word'],
      Wup: [[1, -1, 0], [-1, 1, 0], [0, 0, -1], [0, 0, 0]],
      Wdown: [[0, 0, 0, 1], [0, 0.5, 0, -0.5], [0, 0, -0.25, 0]],
    },
    { // layer 2: nouns look for tokens that *already* carry shore-sense (written by layer 1)
      Wq: [[0, 0], [0, 0], [1, 0], [0, 0]],
      Wk: [[0, 0], [0, 0], [0, 0], [1, 0]],
      Wv: [[0, 0], [0, 0], [0, 0], [0, 1]],
      Wo: [[0, 0, 0, 0], [0, 0, 0, 1]],
      units: ['shore > money', 'money > shore', 'function word'],
      Wup: [[0, -1, 0], [-1, 1, 0], [0, 0, -1], [1, -1, 0]],
      Wdown: [[0, 0, 0, 0.5], [0, 0.5, 0, -0.5], [0, 0, -0.25, 0]],
    },
  ],
};

// ---------------------------------------------------------------- the maths (pure, testable)
const EPS = 1e-5;
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
const mul = (A, B) => A.map(r => B[0].map((_, j) => r.reduce((s, x, k) => s + x * B[k][j], 0)));
const add = (A, B) => A.map((r, i) => r.map((x, j) => x + B[i][j]));
function rmsnorm(X) {
  const r = X.map(x => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length + EPS));
  return { r, N: X.map((x, i) => x.map(v => v / r[i])) };
}
export function forward(ids, E, layers) {
  const x0 = ids.map(i => E[i].slice());
  const L = [];
  let X = x0;
  for (const W of layers) {
    const { r: r1, N } = rmsnorm(X);
    const Q = mul(N, W.Wq), K = mul(N, W.Wk), V = mul(N, W.Wv);
    const dh = W.Wq[0].length;
    const S = Q.map((q, i) => K.map((k, j) => (j <= i ? dot(q, k) / Math.sqrt(dh) : -Infinity)));
    const A = S.map(row => {
      const m = Math.max(...row);
      const e = row.map(s => (s === -Infinity ? 0 : Math.exp(s - m)));
      const z = e.reduce((a, b) => a + b, 0);
      return e.map(v => v / z);
    });
    const O = A.map(a => V[0].map((_, d) => a.reduce((s, w, j) => s + w * V[j][d], 0)));
    const D = mul(O, W.Wo), XA = add(X, D);
    const { r: r2, N: N2 } = rmsnorm(XA);
    const Hp = mul(N2, W.Wup), H = Hp.map(r => r.map(v => Math.max(0, v)));
    const M = mul(H, W.Wdown), Xout = add(XA, M);
    L.push({ X, r1, N, Q, K, V, S, A, O, D, XA, r2, N2, Hp, H, M, Xout, dh });
    X = Xout;
  }
  return { x0, L };
}
// stream stages: 0 = x(0); per layer l: 1+4l Δattn, 2+4l x mid-layer, 3+4l Δmlp, 4+4l x(l+1)
export function stage(m, s) {
  if (s === 0) return m.x0;
  const l = Math.floor((s - 1) / 4), L = m.L[l];
  return [L.D, L.XA, L.M, L.Xout][(s - 1) % 4];
}

// ---------------------------------------------------------------- presentation helpers
// one colour per vector type, everywhere (prose, formulas, matrices, stream)
const TYPE = { x: '--vx', E: '--vx', n: '--vn', q: '--vq', Wq: '--vq', k: '--vk', Wk: '--vk', v: '--vv', Wv: '--vv',
  s: '--va', a: '--va', o: '--vatt', att: '--vatt', Wo: '--vatt', h: '--vmlp', mlp: '--vmlp', Wup: '--vmlp', Wdown: '--vmlp' };
const r2 = v => { const r = Math.round(v * 100) / 100; return Object.is(r, -0) ? 0 : r; };
const show = v => (v === -Infinity ? '−∞' : Number.isFinite(v) ? r2(v) : '?');
// same format as the core matrix: integers bare, otherwise 2 decimals; a real minus sign
const num = v => { const x = show(v); const s = typeof x === 'number' && !Number.isInteger(x) ? x.toFixed(2) : String(x); return s.startsWith('-') ? '−' + s.slice(1) : s; };
const vtex = v => `[${v.map(num).join(',\\ ')}]`;
const txt = s => `\\text{${String(s).replace(/[{}\\]/g, '')}}`;
// "a·b + c·d" for the nonzero terms of a dot product (zero weights skipped), or "0"
function terms(a, b) {
  const t = a.map((x, i) => [x, b[i]]).filter(([x, w]) => r2(x) !== 0 && w !== 0);
  return t.length ? t.map(([x, w]) => `${num(x)}\\cdot${w < 0 ? `(${num(w)})` : num(w)}`).join(' + ') : '0';
}
// "terms = value", without repeating a value that the terms already are ("0 = 0")
const eq = (tm, v) => (tm === num(v) ? num(v) : `${tm} = ${num(v)}`);

register('residual', (el, spec, ctx) => {
  const cfg = { ...DEFAULTS, ...spec };
  const T = cfg.tokens, D = cfg.dims, LAY = cfg.layers;
  const ids = T.map(w => { const i = cfg.vocab.indexOf(w); if (i < 0) throw new Error(`token "${w}" is not in vocab`); return i; });
  const dh = LAY[0].Wq[0].length;
  const HD = Array.from({ length: dh }, (_, i) => 'hd' + (i + 1));
  const key = cfg.id || 'residual:' + T.join(' ');
  const st = memo.get(key) || { step: 0, t: T.length - 1, embed: cfg.embed.map(r => r.slice()) };
  memo.set(key, st);
  const base = forward(ids, cfg.embed, LAY);
  let m = forward(ids, st.embed, LAY);

  ctx.fixColors?.(Object.fromEntries([
    ...Object.entries(TYPE).map(([k, v]) => [k, `var(${v})`]),
    ...[...T, ...D, ...HD, 'u1', 'u2', 'u3', 'u4'].map(k => [k, 'var(--vsel)']),
  ]));

  // ---------------------------------------------------------- steps
  const STEPS = [];
  const writesAt = [];                         // stage -> index of the step that writes it
  const add1 = (s, w) => { if (w != null) writesAt[w] = STEPS.length; STEPS.push(s); };
  const upTo = t => T.map((_, j) => j).filter(j => j <= t);
  add1({ id: 'embed', l: -1, part: 'Input', short: 'embed', type: 'x', title: 'Embedding lookup', writes: 0, reads: () => [] , render: stepEmbed }, 0);
  LAY.forEach((_, l) => {
    const b = 4 * l, xin = b, mid = b + 2;
    const S = (id, part, short, type, title, render, reads, writes) => add1({ id: `L${l + 1}.${id}`, l, part, short, type, title, render, reads, writes }, writes);
    S('norm1', 'Attention', 'norm', 'n', 'RMSNorm', stepNorm(1), t => [[xin, [t]]], null);
    S('qkv', 'Attention', 'q k v', 'q', 'Queries, keys, values', stepQKV, t => [[xin, upTo(t)]], null);
    S('scores', 'Attention', 'q·k', 's', 'Scores with the causal mask', stepScores, t => [[xin, upTo(t)]], null);
    S('softmax', 'Attention', 'softmax', 'a', 'Softmax: attention weights', stepSoftmax, t => [[xin, upTo(t)]], null);
    S('mix', 'Attention', 'Σ a·v', 'o', 'Weighted sum of values', stepMix, t => [[xin, upTo(t)]], null);
    S('wo', 'Attention', '·W_O', 'att', 'Back to d_model with W_O', stepWo, t => [[xin, upTo(t)]], b + 1);
    S('add1', 'Attention', '+ x', 'x', 'Residual add (attention)', stepAdd(1), t => [[xin, [t]], [b + 1, [t]]], mid);
    S('norm2', 'MLP', 'norm', 'n', 'RMSNorm', stepNorm(2), t => [[mid, [t]]], null);
    S('up', 'MLP', 'up·ReLU', 'h', 'MLP up-projection and ReLU', stepUp, t => [[mid, [t]]], null);
    S('down', 'MLP', 'down', 'mlp', 'MLP down-projection', stepDown, t => [[mid, [t]]], b + 3);
    S('add2', 'MLP', '+ x', 'x', 'Residual add (MLP)', stepAdd(2), t => [[mid, [t]], [b + 3, [t]]], b + 4);
  });
  if (typeof cfg.step === 'string' && st.fresh !== false) { const i = STEPS.findIndex(s => s.id === cfg.step); if (i >= 0) st.step = i; }
  else if (typeof cfg.step === 'number' && st.fresh !== false) st.step = cfg.step;
  if (cfg.token != null && st.fresh !== false) st.t = typeof cfg.token === 'number' ? cfg.token : Math.max(0, T.indexOf(cfg.token));
  st.fresh = false;
  st.step = Math.max(0, Math.min(STEPS.length - 1, st.step));
  st.t = Math.max(0, Math.min(T.length - 1, st.t));

  // ---------------------------------------------------------- shell
  const tokSeg = h('div', { class: 'seg rs-toks no-terms' });
  const prev = h('button', { class: 'btn btn-small', text: '← Prev', onclick: () => go(st.step - 1) });
  const next = h('button', { class: 'btn btn-small btn-primary', text: 'Next →', onclick: () => go(st.step + 1) });
  const where = h('div', { class: 'rs-where' });
  const track = h('div', { class: 'rs-track no-terms' });
  const stream = h('div', { class: 'rs-stream no-terms' });
  const detail = h('div', { class: 'rs-detail' });
  const tweak = h('div', { class: 'rs-tweak no-terms' });
  const panel = (title, note, ...kids) => h('div', { class: 'rs-panel' },
    h('div', { class: 'rs-ph no-terms' }, h('span', { class: 'rs-pt', html: ctx.inline(title) }), h('span', { class: 'spacer' }), note), ...kids);
  const legend = h('span', { class: 'rs-legend' },
    h('span', { class: 'rs-lg rs-lg-read', text: 'read' }), h('span', { class: 'rs-lg rs-lg-write', text: 'written' }),
    h('span', { class: 'rs-lg rs-lg-future', text: 'not yet computed' }), h('span', { class: 'rs-lg rs-lg-chg', text: 'changed by your edit' }));
  el.append(
    h('div', { class: 'rs-bar no-terms' }, h('span', { class: 'rs-bar-label', text: 'Token' }), tokSeg, h('span', { class: 'spacer' }), where, h('span', { class: 'rs-nav' }, prev, next)),
    track,
    panel('Residual stream: one $x$ per token, per stage', legend, stream),
    panel('This step', null, detail),
    cfg.editable === false ? null : panel('Tweak the input', h('span', { class: 'rs-note', text: 'everything above is recomputed from these numbers' }), tweak),
  );
  el.tabIndex = 0;
  el.addEventListener('keydown', e => {
    if (e.target.closest('input')) return;
    if (e.key === 'ArrowRight') { go(st.step + 1); e.preventDefault(); }
    if (e.key === 'ArrowLeft') { go(st.step - 1); e.preventDefault(); }
  });

  function go(i) { st.step = Math.max(0, Math.min(STEPS.length - 1, i)); draw(); }
  function pick(t) { st.t = t; drawTweak(); draw(); }

  // step track: Input | Layer 1 [Attention | MLP] | Layer 2 [...]
  function drawTrack() {
    const groups = [];
    STEPS.forEach((s, i) => {
      const g = s.l < 0 ? 'Input' : `Layer ${s.l + 1}`;
      let G = groups.at(-1);
      if (!G || G.name !== g) groups.push(G = { name: g, parts: [] });
      let P = G.parts.at(-1);
      if (!P || P.name !== s.part) G.parts.push(P = { name: s.part, steps: [] });
      P.steps.push([s, i]);
    });
    const chip = (G, s, i) => h('button', {
      class: 'rs-chip' + (i === st.step ? ' on' : '') + (i < st.step ? ' done' : ''), title: `${G.name} · ${s.title}`,
      style: `--c: var(${TYPE[s.type]})`, html: ctx.inline(s.short), onclick: () => go(i) });
    const part = (G, P) => h('div', { class: 'rs-tp' },
      G.name === 'Input' ? null : h('div', { class: 'rs-tp-h', text: P.name }),
      h('div', { class: 'rs-tp-b' }, ...P.steps.map(([s, i]) => chip(G, s, i))));
    track.replaceChildren(...groups.map(G => h('div', { class: 'rs-tg' + (G.name === 'Input' ? ' solo' : '') },
      h('div', { class: 'rs-tg-h', text: G.name }),
      h('div', { class: 'rs-tg-b' }, ...G.parts.map(P => part(G, P))))));
  }

  function drawToks() {
    tokSeg.replaceChildren(...T.map((w, i) => h('button', { class: i === st.t ? 'on' : '', 'data-k': w, text: w, onclick: () => pick(i) })));
  }

  // ---------------------------------------------------------- residual stream table
  // columns: stages left to right (x(0), +attn, = x, +MLP, = x(1), ...); rows: tokens; each cell
  // is that token's vector at that stage, drawn as a column of D numbers
  function drawStream() {
    const s = STEPS[st.step], t = st.t;
    const reads = new Set(); for (const [sg, toks] of s.reads(t)) for (const j of toks) reads.add(sg + ':' + j);
    const nStages = 1 + 4 * LAY.length;
    const info = sg => {
      const l = Math.floor((sg - 1) / 4), kind = sg === 0 ? 'x0' : ['att', 'mid', 'mlp', 'out'][(sg - 1) % 4];
      const type = kind === 'att' ? 'att' : kind === 'mlp' ? 'mlp' : 'x';
      const [lab, desc] = kind === 'x0' ? ['$x^{(0)}$', 'x(0): the embedding row']
        : kind === 'att' ? ['+ attn', `what attention adds in layer ${l + 1}`]
          : kind === 'mid' ? ['$=x$', `x in the middle of layer ${l + 1} (after attention, before the MLP)`]
            : kind === 'mlp' ? ['+ MLP', `what the MLP adds in layer ${l + 1}`]
              : [`$=x^{(${l + 1})}$`, `x(${l + 1}): x after layer ${l + 1}`];
      return { l, kind, type, lab, desc, future: st.step < writesAt[sg], gap: sg % 4 === 1 };
    };
    const I = Array.from({ length: nStages }, (_, sg) => info(sg));
    const grid = h('div', { class: 'rs-sgrid', style: `--s: ${nStages}` });
    grid.append(h('div', { class: 'rs-gh rs-blank', style: 'grid-column: span 2' }), h('div', { class: 'rs-gh', text: 'input' }),
      ...LAY.map((_, l) => h('div', { class: 'rs-gh rs-gap', style: 'grid-column: span 4', text: `layer ${l + 1}` })));
    grid.append(h('div', { class: 'rs-blank', style: 'grid-column: span 2' }), ...I.map((x, sg) => h('button', {
      class: `rs-stg rs-${x.kind}` + (x.gap ? ' rs-gap' : '') + (x.future ? ' future' : '') + (sg === s.writes ? ' cur' : ''),
      style: `--c: var(${TYPE[x.type]})`, 'data-k': x.type, title: x.desc + ' · click: jump to the step that computes it', html: ctx.inline(x.lab), onclick: () => go(writesAt[sg]) })));
    T.forEach((w, j) => {
      grid.append(h('button', { class: 'rs-tokl' + (j === t ? ' on' : ''), 'data-k': w, title: `select ${w}`, onclick: () => pick(j) }, w),
        h('div', { class: 'rs-diml' + (j === t ? ' on' : '') }, ...D.map(d => h('span', { 'data-k': d, text: d }))));
      I.forEach((x, sg) => {
        const vals = stage(m, sg)[j], was = stage(base, sg)[j];
        const maxAbs = Math.max(1, ...stage(m, sg).flat().map(Math.abs));
        const cls = `rs-vec rs-${x.kind}` + (x.gap ? ' rs-gap' : '') + (x.future ? ' future' : '') + (j === t ? ' on' : '') +
          (reads.has(sg + ':' + j) ? ' read' : '') + (sg === s.writes && j === t ? ' write' : '');
        grid.append(h('div', { class: cls, style: `--c: var(${TYPE[x.type]})`, title: `${w} · ${x.desc}`, onclick: () => { st.t = j; drawTweak(); go(writesAt[sg]); } },
          ...vals.map((v, d) => h('span', {
            class: 'rs-n' + (r2(v) < 0 ? ' neg' : '') + (r2(v) === 0 ? ' zero' : '') + (Math.abs(v - was[d]) > 0.005 ? ' chg' : ''),
            'data-k': `${w} ${D[d]}`, style: `background: ${tint(v, maxAbs)}`, text: num(v) }))));
      });
    });
    stream.replaceChildren(grid);
  }
  const tint = (v, max) => `color-mix(in srgb, var(--c) ${Math.round(6 + 44 * Math.min(1, Math.abs(v) / max))}%, var(--card))`;

  // ---------------------------------------------------------- matrices (core `matrix`, tinted + row marks)
  function mat(o) {
    const box = h('div', { class: 'rs-m', style: `--c: var(${TYPE[o.type]})` });
    registry.matrix(box, { name: o.name, key: o.key || o.type, rows: o.rows.map(r => r.map(show)), rowLabels: o.rowLabels || T, rowKeys: o.rowKeys || o.rowLabels || T,
      colLabels: o.colLabels || D, colKeys: o.colKeys || o.colLabels || D }, ctx);
    const max = Math.max(1e-9, ...o.rows.flat().filter(Number.isFinite).map(Math.abs));
    box.querySelectorAll('tbody tr').forEach((tr, i) => {
      if (o.on?.includes(i)) tr.classList.add('rs-on');
      if (o.off?.includes(i)) tr.classList.add('rs-off');
      tr.querySelectorAll('td.mx-cell').forEach((td, j) => {
        const v = o.rows[i][j];
        if (v === -Infinity) { td.classList.add('rs-masked'); return; }
        if (r2(v) < 0) td.classList.add('neg');
        td.style.background = tint(v, max);
      });
    });
    // room for the row labels (the core matrix leaves a fixed 64px; unit names are longer)
    const longest = Math.max(...(o.rowLabels || T).map(l => String(l).length));
    const br = box.querySelector('.mx-brackets');
    if (br) br.style.marginLeft = Math.max(40, Math.round(longest * 6.3 + 30)) + 'px';
    if (o.sub) box.append(h('div', { class: 'rs-m-sub', html: ctx.inline(o.sub) }));
    return box;
  }
  const op = s => h('div', { class: 'rs-op', html: ctx.inline(s) });
  const line = (...kids) => h('div', { class: 'rs-line' }, ...kids);
  const unitsOf = l => (LAY[l].units || LAY[l].Wup[0].map((_, i) => 'unit ' + (i + 1)));
  const UK = l => unitsOf(l).map((_, i) => 'u' + (i + 1));
  const sub = j => txt(T[j]);
  const fromNote = l => (l > 0 ? `\n\n:::note Layer ${l + 1} input\nThese rows are $x^{(${l})}$, the outputs of layer ${l}, not the embeddings. Whatever layer ${l} added to {{${T[0]}}} and {{${T[1] || T[0]}}} is in them.\n:::` : '');

  function body(s, { formula, text, rows, work }) {
    const tk = T[st.t];
    detail.replaceChildren(
      h('div', { class: 'rs-dh no-terms', style: `--c: var(${TYPE[s.type]})` },
        h('span', { class: 'rs-crumb', text: s.l < 0 ? 'Input' : `Layer ${s.l + 1} · ${s.part}` }), h('b', { text: s.title }),
        h('span', { class: 'spacer' }), h('span', { class: 'rs-for' }, 'selected token ', h('b', { 'data-k': tk, text: tk }))),
      formula ? ctx.md(`$$${formula}$$`, 'rs-formula') : '',
      ctx.md(text, 'rs-text'),
      h('div', { class: 'rs-mats no-terms' }, ...rows.map(r => line(...r))),
      work ? h('div', { class: 'rs-work' }, h('div', { class: 'rs-work-h no-terms' }, 'The numbers for ', h('b', { 'data-k': tk, text: tk })), ctx.md(work, 'rs-work-md')) : '');
  }

  // ---------------------------------------------------------- the steps
  function stepEmbed(s, t) {
    const E = st.embed;
    body(s, {
      formula: `\\k{x}{x^{(0)}_{${sub(t)}}} = \\k{E}{E}[\\,\\text{id}(${sub(t)})\\,]`,
      text: `Each token's id picks one row of the {{embedding table|E}}. That row is the token's starting {{x|x}}: a vector of ${D.length} numbers, one per dimension (here the dimensions have names; in a real model they don't). No token has looked at any other yet. This is the only time the table is used.`,
      rows: [[
        mat({ name: '$E$', type: 'E', rows: E, rowLabels: cfg.vocab.map((w, i) => `${w} #${i}`), rowKeys: cfg.vocab.map(w => (T.includes(w) ? w : null)), on: [ids[t]], off: cfg.vocab.map((w, i) => i).filter(i => !ids.includes(i)), sub: 'vocabulary × d_model' }),
        op('→'),
        mat({ name: '$X^{(0)}$', type: 'x', rows: m.x0, on: [t], sub: 'one row per token in the text' }),
      ]],
      work: `$x^{(0)}_{${sub(t)}} = E[${ids[t]}] = ${vtex(m.x0[t])}$`,
    });
  }
  function stepNorm(which) {
    return (s, t) => {
      const L = m.L[s.l], X = which === 1 ? L.X : L.XA, r = which === 1 ? L.r1 : L.r2, N = which === 1 ? L.N : L.N2;
      const name = which === 1 ? `$X^{(${s.l})}$` : `$X$ mid-layer ${s.l + 1}`;
      body(s, {
        formula: `\\k{n}{n_{t}} = \\frac{\\k{x}{x_{t}}}{\\text{rms}(x_t)},\\quad \\text{rms}(x) = \\sqrt{\\tfrac{1}{${D.length}}\\textstyle\\sum_i x_i^2 + \\epsilon}`,
        text: `{{RMSNorm|n}} rescales a copy of each token's {{x|x}} to a standard size before the ${which === 1 ? 'attention' : 'MLP'} sublayer reads it. The stream itself is not changed: $x$ carries on unnormalised, and only this copy {{n|n}} goes into the next matrices. (Real RMSNorm also multiplies by a learned gain per dimension; it is 1 here.)` + (which === 1 ? fromNote(s.l) : ''),
        rows: [[mat({ name, type: 'x', rows: X, on: [t] }), op('÷'), mat({ name: '$\\text{rms}$', type: 'n', key: 'n', rows: r.map(v => [v]), colLabels: ['rms'], colKeys: [null], on: [t] }), op('='), mat({ name: '$N$', type: 'n', rows: N, on: [t] })]],
        work: `$\\text{rms}(x_{${sub(t)}}) = \\sqrt{(${X[t].map(v => `${num(v)}^2`).join(' + ')})/${D.length}} = ${num(r[t])}$\n\n$n_{${sub(t)}} = ${vtex(X[t])} \\,/\\, ${num(r[t])} = ${vtex(N[t])}$`,
      });
    };
  }
  function stepQKV(s, t) {
    const L = m.L[s.l], W = LAY[s.l], cols = HD.map((_, i) => String(i + 1));
    const wm = (nm, M, type) => mat({ name: nm, type, rows: M, rowLabels: D, rowKeys: D, colLabels: cols, colKeys: HD });
    const rm = (nm, M, type) => mat({ name: nm, type, rows: M, colLabels: cols, colKeys: HD, on: [t], off: T.map((_, j) => j).filter(j => j > t) });
    body(s, {
      formula: `\\k{q}{q_t} = \\k{n}{n_t}\\,\\k{Wq}{W_Q},\\quad \\k{k}{k_t} = \\k{n}{n_t}\\,\\k{Wk}{W_K},\\quad \\k{v}{v_t} = \\k{n}{n_t}\\,\\k{Wv}{W_V}`,
      text: `Three small matrices project each normalised vector from d_model = ${D.length} down to d_head = ${dh}: a {{query|q}} (what this token is looking for), a {{key|k}} (how it can be found) and a {{value|v}} (what it hands over if found). Every token gets all three, from the same weights. Each row of a $W$ belongs to one input dimension: hover a dimension to see which numbers it feeds.` + fromNote(s.l),
      rows: [
        [mat({ name: '$N$', type: 'n', rows: L.N, on: [t], off: T.map((_, j) => j).filter(j => j > t) })],
        [wm('$W_Q$', W.Wq, 'Wq'), op('→'), rm('$Q$', L.Q, 'q')],
        [wm('$W_K$', W.Wk, 'Wk'), op('→'), rm('$K$', L.K, 'k')],
        [wm('$W_V$', W.Wv, 'Wv'), op('→'), rm('$V$', L.V, 'v')],
      ],
      work: HD.map((_, c) => `$\\k{q}{q}_{${sub(t)},${c + 1}} = ${eq(terms(L.N[t], W.Wq.map(r => r[c])), L.Q[t][c])}$`).join('\n\n') +
        `\n\nso $\\k{q}{q_{${sub(t)}}} = ${vtex(L.Q[t])}$, and the same way $\\k{k}{k_{${sub(t)}}} = ${vtex(L.K[t])}$, $\\k{v}{v_{${sub(t)}}} = ${vtex(L.V[t])}$` +
        (t < T.length - 1 ? `\n\nThe greyed-out rows belong to later tokens. ${T[t]} won't use them (causal mask), though those tokens use them for themselves.` : ''),
    });
  }
  function stepScores(s, t) {
    const L = m.L[s.l], cols = HD.map((_, i) => String(i + 1)), off = T.map((_, j) => j).filter(j => j > t);
    body(s, {
      formula: `\\k{s}{s_{tj}} = \\frac{\\k{q}{q_t}\\cdot\\k{k}{k_j}}{\\sqrt{d_{head}}}\\ \\text{ for } j \\le t,\\qquad s_{tj} = -\\infty \\text{ for } j > t`,
      text: `The selected token's {{query|q}} is compared with the {{key|k}} of every token it is allowed to see: itself and the ones before it. Dividing by $\\sqrt{${dh}}$ keeps scores from growing with d_head. Later positions get $-\\infty$ ({{causal mask|s}}), so softmax will give them weight 0. Each row of $S$ is one token's view.` + fromNote(s.l),
      rows: [[mat({ name: '$Q$', type: 'q', rows: L.Q, colLabels: cols, colKeys: HD, on: [t] }), op('·'), mat({ name: '$K$', type: 'k', rows: L.K, colLabels: cols, colKeys: HD, on: upTo(t), off }), op('→'),
        mat({ name: '$S$', type: 's', rows: L.S, colLabels: T, colKeys: T, on: [t], sub: 'row: who is looking · column: who is seen' })]],
      work: upTo(t).map(j => `$s_{${sub(t)},${sub(j)}} = (${terms(L.Q[t], L.K[j])}) / ${num(Math.sqrt(dh))} = ${num(L.S[t][j])}$`).join('\n\n') +
        (t < T.length - 1 ? `\n\n$s_{${sub(t)},j} = -\\infty$ for ${T.slice(t + 1).map(w => `{{${w}}}`).join(', ')}: later tokens are masked.` : ''),
    });
  }
  function stepSoftmax(s, t) {
    const L = m.L[s.l], vis = upTo(t);
    const tok = h('div', { class: 'rs-arcs' });
    registry.tokens(tok, { tokens: T, keys: T, weights: { from: t, to: L.A[t] }, causal: true }, ctx);
    body(s, {
      formula: `\\k{a}{a_{tj}} = \\frac{e^{s_{tj}}}{\\sum_{j' \\le t} e^{s_{tj'}}}`,
      text: `Softmax turns each row of scores into weights that are positive and sum to 1. The masked entries ($e^{-\\infty} = 0$) get exactly 0. The arcs show where ${T[t]} looks.`,
      rows: [[mat({ name: '$S$', type: 's', rows: L.S, colLabels: T, colKeys: T, on: [t] }), op('→'), mat({ name: '$A$', type: 'a', rows: L.A, colLabels: T, colKeys: T, on: [t], sub: 'each row sums to 1' })], [tok]],
      work: `$e^{s}$: ${vis.map(j => `$e^{${num(L.S[t][j])}} = ${num(Math.exp(L.S[t][j]))}$`).join(', ')}\n\n` +
        `$\\text{sum} = ${num(vis.reduce((z, j) => z + Math.exp(L.S[t][j]), 0))}$, so $a_{${sub(t)}} = ${vtex(L.A[t])}$`,
    });
  }
  function stepMix(s, t) {
    const L = m.L[s.l], cols = HD.map((_, i) => String(i + 1)), off = T.map((_, j) => j).filter(j => j > t);
    body(s, {
      formula: `\\k{o}{o_t} = \\sum_{j \\le t} \\k{a}{a_{tj}}\\,\\k{v}{v_j}`,
      text: `The head's output for ${T[t]} is the weighted average of the {{values|v}} it can see. This is the only place in the whole layer where information moves from one token to another.` +
        (s.l > 0 ? ` In layer ${s.l + 1} those values come from $x^{(${s.l})}$ of the earlier tokens, so ${T[t]} receives what layer ${s.l} wrote into them.` : ''),
      rows: [[mat({ name: '$A$', type: 'a', rows: L.A, colLabels: T, colKeys: T, on: [t] }), op('·'), mat({ name: '$V$', type: 'v', rows: L.V, colLabels: cols, colKeys: HD, on: upTo(t), off }), op('='), mat({ name: '$O$', type: 'o', rows: L.O, colLabels: cols, colKeys: HD, on: [t] })]],
      work: `$o_{${sub(t)}} = ${upTo(t).map(j => `${num(L.A[t][j])}\\cdot${vtex(L.V[j])}`).join(' + ')} = ${vtex(L.O[t])}$`,
    });
  }
  function stepWo(s, t) {
    const L = m.L[s.l], W = LAY[s.l], cols = HD.map((_, i) => String(i + 1));
    body(s, {
      formula: `\\k{att}{\\Delta^{\\text{attn}}_t} = \\k{o}{o_t}\\,\\k{Wo}{W_O}`,
      text: `{{W_O|Wo}} maps the ${dh}-number head output back up to d_model = ${D.length}, into the stream's own dimensions. Each row of $W_O$ says where one output number gets written. (With several heads, their outputs are concatenated first and one $W_O$ maps them all.) The result is {{what attention adds|att}}.`,
      rows: [[mat({ name: '$O$', type: 'o', rows: L.O, colLabels: cols, colKeys: HD, on: [t] }), op('·'), mat({ name: '$W_O$', type: 'Wo', rows: W.Wo, rowLabels: cols, rowKeys: HD }), op('='), mat({ name: '$\\Delta^{\\text{attn}}$', type: 'att', rows: L.D, on: [t] })]],
      work: D.map((d, c) => `$\\Delta_{${txt(d)}} = ${eq(terms(L.O[t], W.Wo.map(r => r[c])), L.D[t][c])}$`).join('\n\n'),
    });
  }
  function stepAdd(which) {
    return (s, t) => {
      const L = m.L[s.l], X = which === 1 ? L.X : L.XA, Dl = which === 1 ? L.D : L.M, Y = which === 1 ? L.XA : L.Xout;
      const dk = which === 1 ? 'att' : 'mlp', dn = which === 1 ? '\\Delta^{\\text{attn}}' : '\\Delta^{\\text{mlp}}';
      const out = which === 1 ? `$X$ mid-layer ${s.l + 1}` : `$X^{(${s.l + 1})}$`;
      const last = s.l === LAY.length - 1;
      body(s, {
        formula: `\\k{x}{x_t} \\leftarrow \\k{x}{x_t} + \\k{${dk}}{${dn}_t}`,
        text: which === 1
          ? `The residual connection: {{attention's result|att}} is *added* to {{x|x}}, not swapped in for it. Everything $x$ held before is still there, plus what this token gathered from the others.`
          : `The {{MLP's result|mlp}} is added to {{x|x}} too. That is the end of layer ${s.l + 1}: $x^{(${s.l + 1})}$ ` + (last
            ? `is the final hidden state. The output head would multiply it by $W_{unembed}$ to score every next token.`
            : `is what layer ${s.l + 2} reads, for every token.`),
        rows: [[mat({ name: which === 1 ? `$X^{(${s.l})}$` : `$X$ mid`, type: 'x', rows: X, on: [t] }), op('+'), mat({ name: `$${dn}$`, type: dk, rows: Dl, on: [t] }), op('='), mat({ name: out, type: 'x', rows: Y, on: [t] })]],
        work: `$${vtex(X[t])} + ${vtex(Dl[t])} = ${vtex(Y[t])}$`,
      });
    };
  }
  function stepUp(s, t) {
    const L = m.L[s.l], W = LAY[s.l], U = unitsOf(s.l), uk = UK(s.l);
    body(s, {
      formula: `\\k{h}{h_t} = \\text{ReLU}(\\k{n}{n_t}\\,\\k{Wup}{W_{up}})`,
      text: `Each column of {{W_up|Wup}} is a detector pattern; the dot product says how well this token's vector matches it. ReLU zeroes the detectors that don't match. The MLP works on one token at a time: no information moves between tokens here. (Real MLPs are about 4× wider than d_model; this one has ${U.length} units.)`,
      rows: [
        [mat({ name: '$N$', type: 'n', rows: L.N2, on: [t] }), op('·'), mat({ name: '$W_{up}$', type: 'Wup', rows: W.Wup, rowLabels: D, rowKeys: D, colLabels: U, colKeys: uk })],
        [mat({ name: '$N W_{up}$', type: 'h', key: 'h', rows: L.Hp, colLabels: U, colKeys: uk, on: [t] }), op('ReLU →'), mat({ name: '$H$', type: 'h', rows: L.H, colLabels: U, colKeys: uk, on: [t] })],
      ],
      work: U.map((u, c) => `${u}: $\\text{ReLU}(${terms(L.N2[t], W.Wup.map(r => r[c]))}) = \\text{ReLU}(${num(L.Hp[t][c])}) = ${num(L.H[t][c])}$`).join('\n\n'),
    });
  }
  function stepDown(s, t) {
    const L = m.L[s.l], W = LAY[s.l], U = unitsOf(s.l), uk = UK(s.l);
    const fired = U.map((u, c) => [u, L.H[t][c], c]).filter(([, v]) => r2(v) !== 0);
    body(s, {
      formula: `\\k{mlp}{\\Delta^{\\text{mlp}}_t} = \\k{h}{h_t}\\,\\k{Wdown}{W_{down}}`,
      text: `Each row of {{W_down|Wdown}} is what one detector writes into $x$ when it fires, scaled by how strongly it fired. Detectors at 0 write nothing. The result is {{what the MLP adds|mlp}}.`,
      rows: [[mat({ name: '$H$', type: 'h', rows: L.H, colLabels: U, colKeys: uk, on: [t] }), op('·'), mat({ name: '$W_{down}$', type: 'Wdown', rows: W.Wdown, rowLabels: U, rowKeys: uk }), op('='), mat({ name: '$\\Delta^{\\text{mlp}}$', type: 'mlp', rows: L.M, on: [t] })]],
      work: (fired.length ? fired.map(([u, v, c]) => `${u} fired ${num(v)}: adds $${num(v)}\\cdot${vtex(W.Wdown[c])}$`).join('\n\n') : 'No detector fired for this token, so the MLP adds nothing.') +
        `\n\n$\\Delta^{\\text{mlp}}_{${sub(t)}} = ${vtex(L.M[t])}$`,
    });
  }

  // ---------------------------------------------------------- tweak panel
  function drawTweak() {
    if (cfg.editable === false) return;
    const t = st.t, row = ids[t];
    const changed = st.embed.some((r, i) => r.some((v, j) => v !== cfg.embed[i][j]));
    const sl = h('div', { class: 'sliders rs-sliders' });
    D.forEach((d, j) => {
      const s = ctx.slider(d, -2, 2, st.embed[row][j], 0.1, v => { st.embed[row][j] = v; recompute(); });
      ctx.key(s, d);
      sl.append(s);
    });
    tweak.replaceChildren(
      h('div', { class: 'rs-tw-h' }, h('span', {}, 'Embedding row of ', h('b', { 'data-k': T[t], text: T[t] }), ` (E[${row}]). Try `, h('i', { text: hint(t) }), '.'),
        h('span', { class: 'spacer' }), h('button', { class: 'btn btn-small', text: 'Reset all', disabled: !changed, onclick: () => { st.embed = cfg.embed.map(r => r.slice()); recompute(); drawTweak(); } })),
      sl);
  }
  const hint = t => (T[t] === 'river' ? 'water → 0: no shore-sense for river after layer 1, so bank gets none in layer 2'
    : T[t] === 'bank' ? 'money → 1.2: the money detector wins over shore'
      : 'water → 1: in layer 1 bank now splits its attention between “the” and river');
  function recompute() {
    m = forward(ids, st.embed, LAY);
    draw();
    const b = tweak.querySelector('.rs-tw-h .btn');
    if (b) b.disabled = !st.embed.some((r, i) => r.some((v, j) => v !== cfg.embed[i][j]));
  }

  function draw() {
    const s = STEPS[st.step];
    prev.disabled = st.step === 0; next.disabled = st.step === STEPS.length - 1;
    where.replaceChildren(h('span', { class: 'rs-count', text: `${st.step + 1} / ${STEPS.length}` }), h('span', { text: (s.l < 0 ? '' : `Layer ${s.l + 1} · `) + s.title }));
    drawToks(); drawTrack(); drawStream();
    s.render(s, st.t);
    ctx.mountAll(el);
  }
  drawTweak();
  draw();
});
const memo = new Map();   // viz state survives re-renders of the page (topic file updates)
