# How LLMs work (demo) — cheat sheet

Short reference for the demo topic. Hover any linked term.

## Pipeline

```viz flow
{ nodes: [
    {id: "tok", label: "tokens", sub: "IDs", key: "tok"},
    {id: "att", label: "N × attention", sub: "q · k → weights", key: "s"},
    {id: "lg", label: "logits", sub: "one per token", key: "z"},
    {id: "p", label: "softmax", sub: "÷ T first", key: "p"} ] }
```

{{Tokens|tok}} go through the {{attention layers|s}}, the last position becomes {{logits|z}}, and
softmax turns them into {{probabilities|p}} ([overview](msg:2026-01-05.2)).

## Attention (one head)

$$\k{s}{s_j} = \frac{\k{q}{q}\cdot\k{k}{k_j}}{\sqrt{d}} \qquad \k{a}{a_j} = \mathrm{softmax}_j(\k{s}{s_j})$$

- {{The query|q}} is what this token looks for; {{each key|k}} is how a token can be found.
- {{Scores|s}} become {{weights|a}} that sum to 1 ([explained](msg:2026-01-06.5)).

## Training

- Loss: $-\log p_{\text{correct}}$ ([cross-entropy loss](term:cross-entropy loss), [explained](msg:2026-01-08.5)).
- Update: `w ← w − lr · g` ([learning rate](term:learning rate)).
