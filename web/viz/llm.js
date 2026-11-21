// LLM-topic components.
import { register, h } from './core.js';

// softmax toy: editable logits + temperature -> probabilities
// { logits: [{label:"river", value: 2.0, key:"river"}, ...], temperature: 1, editable: true }
register('softmax', (el, spec, ctx) => {
  const items = (spec.logits || []).map(x => ({ ...x }));
  let T = spec.temperature ?? 1;
  const rows = h('div', { class: 'bars' });
  const total = h('div', { class: 'viz-caption' });
  function draw() {
    const z = items.map(i => i.value / T);
    const m = Math.max(...z);
    const ex = z.map(v => Math.exp(v - m));
    const s = ex.reduce((a, b) => a + b, 0);
    rows.replaceChildren(...items.map((it, i) => {
      const p = ex[i] / s;
      return h('div', { class: 'bar-row', 'data-k': it.key || null },
        h('div', { class: 'bar-label', html: ctx.inline(it.label) }),
        h('div', { class: 'bar-logit', text: it.value.toFixed(1) }),
        h('div', { class: 'bar-track' }, h('div', { class: 'bar-fill', style: { width: (p * 100) + '%' } })),
        h('div', { class: 'bar-val', text: (p * 100).toFixed(p < 0.1 ? 1 : 0) + '%' }));
    }));
    total.textContent = `logit ÷ T, then e^z / Σe^z. T = ${T}`;
  }
  el.append(h('div', { class: 'viz-title', html: ctx.inline(spec.title || 'logits → softmax → probabilities') }), rows, total);
  const sl = h('div', { class: 'sliders' });
  sl.append(ctx.slider('temperature T', 0.1, 3, T, 0.05, v => { T = v; draw(); }));
  if (spec.editable !== false) items.forEach(it => sl.append(ctx.slider(`logit ${it.label}`, -5, 5, it.value, 0.1, v => { it.value = v; draw(); })));
  el.append(sl);
  draw();
});
