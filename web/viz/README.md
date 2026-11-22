# Visualization components

A message can contain a fenced block ```` ```viz <type> ```` whose body is a JS object literal.
The UI looks up `<type>` in the registry and calls `component(el, spec, ctx)`.

To add a reusable component:

1. Create `web/viz/<name>.js`:

   ```js
   import { register, h } from './core.js';
   register('mytoy', (el, spec, ctx) => {
     // el: empty <div class="viz viz-mytoy"> to draw into
     // spec: the parsed object from the message
     // ctx.d3            d3 v7
     // ctx.h(tag, attrs, ...children)   tiny DOM helper
     // ctx.md(src, cls)  markdown -> element (terms linked, nested viz mounted)
     // ctx.inline(src)   inline markdown -> HTML string (labels)
     // ctx.key(el, k)    tag an element with highlight key(s); same as data-k="k"
     // ctx.uid(name)     an id unique to this drawing ("ah" -> "ah-v12"), for SVG markers/gradients
     // ctx.color(k)      CSS colour of key k: the topic legend's colour if k is in it, else one
     //                   of the six highlight colours (per message)
     // ctx.legend([k…])  a row of swatches + labels from the topic legend (all entries if no keys);
     //                   hovering an item lights up the parts tagged with that key
     // ctx.highlight([k])  pin highlight of keys in this message (used by `steps`)
     // ctx.slider(label, min, max, value, step, onChange) -> <label> element
     // ctx.fixColors({ q: 'var(--vq)' })  give keys a fixed colour in this message/page
     // ctx.mountAll(el)  after re-rendering part of a component: link terms, recolour keys
   });
   ```
2. Import it in `web/viz/index.js`.
3. Document it (one example) in `docs/formats.md` under Visualizations, and add its name to the brief list in `docs/protocol.md`.

The open browser tab reloads by itself when files under `web/` change.

Conventions: tag every meaningful element with `data-k` so that linked highlighting works
across prose, formulas and viz. Use CSS variables (`--fg`, `--muted`, `--line`,
`--accent`, `--k0..--k5` for key colours, `--s0..--s5` for series) so dark mode works.

Reusing the built-in components inside your own: `import { registry } from './core.js'` and call
`registry.matrix(box, spec, ctx)` (or `tokens`, `bars`, ...), then post-process the DOM if needed.
`viz residual` does this for every matrix it shows.

## `viz js` blocks in messages

A ```` ```viz js ```` block is the body of `function (el, ctx, d3) { … }`: `el`, `ctx` and `d3`
are already in scope, so use them and don't declare them (`const d3 = ctx.d3` is a SyntaxError,
"Identifier 'd3' has already been declared"). Helpers like `ctx.slider()` and `ctx.legend()`
return elements: append them. SVG ids are page-wide, so marker/gradient/clip ids in a `viz js`
drawing are given the drawing's own suffix after it draws (references follow), and two messages
with `<marker id="ah">` keep their own arrowheads; use `ctx.uid("ah")` to know the final id.
Hover previews of a message (msg: links) show a drawing as a placeholder. `bin/learn post` parses every viz block (nothing runs) and refuses
a message whose drawing would show an error box; `bin/learn check` lists old ones.

## Components in this folder

- `core.js`: matrix, vector, bars, tokens, flow, plot, steps, js (see docs/formats.md).
- `llm.js`: `softmax` (editable logits + temperature).
- `residual.js`: `residual`, described below.
- `figure.js`: `figure`, a real image (a `media:` file) with focus regions (the rest dimmed,
  numbered, listed below with linked hover), arrows and blanked-out patches; click for full size.
  Example in `docs/formats.md`.

### `viz residual`: the residual stream, worked by hand

A tiny transformer, computed live in the browser from small readable weights: 3 tokens
(the river bank), d_model 4 with named dims (water, money, noun, shore), single-head attention
with d_head 2 and a causal mask, pre-norm RMSNorm (gain 1), a 3-unit ReLU MLP, 2 layers. Steps:
embedding lookup, then per layer RMSNorm → q/k/v → scores q·k/√d_head (masked) → softmax →
Σ a·v → ·W_O → add to x → RMSNorm → W_up + ReLU → W_down → add to x (23 steps).

What it shows: a step track, the residual stream (one column per stage, one row per token,
each cell that token's vector, with the cells the current step reads dashed and the one it
writes outlined), the current step (formula, a few sentences, the matrices with the selected
token's row marked and masked rows greyed, and the arithmetic for that token), and sliders for
the selected token's embedding row. Every number is recomputed on each edit; cells your edit
changed get a dot. ← / → step when the viz has focus. State survives re-renders of the page.

The default weights tell a story: in layer 1 "bank" attends to "river" but stays ambiguous
(water ≈ money); layer 1's MLP gives "river" shore-sense; in layer 2 bank's query matches keys
built from *shore*, which only river's layer-1 output has, so bank pulls it in and layer 2's MLP
confirms the riverbank sense.

```viz residual
{ token: "bank",        // selected token (index or word), default: the last
  step: "L2.mix",       // initial step: index, or "embed" / "L<n>.<norm1|qkv|scores|softmax|mix|wo|add1|norm2|up|down|add2>"
  editable: true,       // show the embedding sliders
  // optional overrides (defaults in residual.js DEFAULTS):
  // tokens: ["the","river","bank"], vocab: [...], dims: [...], embed: [[...] per vocab word],
  // layers: [{ Wq, Wk, Wv: d×dh, Wo: dh×d, Wup: d×f, Wdown: f×d, units: [f names] }, ...]
}
```

Highlight keys, usable from the surrounding prose (`{{x|x}}`, `\k{q}{q}`): vector types `x`,
`n` (normed), `q`, `k`, `v`, `s`/`a` (scores, weights), `o` (head output), `att` (what attention
adds), `h` (MLP hidden), `mlp` (what the MLP adds), weight matrices `E`, `Wq`, `Wk`, `Wv`, `Wo`,
`Wup`, `Wdown`; token words (`bank`), dim names (`water`), `hd1`/`hd2` (head dims), `u1`..`u3`
(MLP units). Each vector type has one fixed colour (CSS `--vx`, `--vn`, `--vq`, `--vk`, `--vv`,
`--va`, `--vatt`, `--vmlp`), in the viz and in the prose around it.
