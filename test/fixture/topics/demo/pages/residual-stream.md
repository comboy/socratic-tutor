# How x is built, layer by layer

Each token's {{x|x}} gets {{attention's output|att}} and {{the MLP's output|mlp}} added to it, once per layer. See [Q, K, V](skill:4.1) and [the causal mask](skill:4.4).

```viz residual
{ token: "bank" }
```
