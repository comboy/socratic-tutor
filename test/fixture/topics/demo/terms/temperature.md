# temperature

Temperature $T$ is the number every {{logit|z}} is divided by just before softmax. It doesn't change
which token is ranked first, only how sure the model sounds about it ([explained](msg:2026-01-05.10)).

$$p_i = \frac{e^{\k{z}{z_i} / \k{T}{T}}}{\sum_j e^{z_j / T}}$$

## What changes as you turn it

- **Small {{T}}** (close to 0): the gaps between logits get stretched, so almost all the
  probability lands on the top token. Sampling then behaves like always picking the best one.
- **$T = 1$**: the model's own distribution, as trained.
- **Large {{T}}**: the gaps shrink, the distribution flattens and unlikely tokens get picked more.

```viz plot
{ x: [0.1, 4], y: [0, 1], fns: [{ f: "Math.exp(2/x)/(Math.exp(2/x)+Math.exp(1/x)+Math.exp(-0.5/x))", label: "p(top token)", key: "T" }] }
```

Related: [sampling](term:sampling), [the softmax notes](wiki:page/notes-on-softmax), [skill 3.2](skill:3.2).

:::fog
- Why $T=1$ is what the model was trained at, and what "calibrated" means
- Top-k and top-p sampling, which cut the tail off before sampling
:::
