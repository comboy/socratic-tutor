# File formats and markdown extensions

Reference for the tutor and the builder. Read the section you need when you write a message with
something unusual in it, or edit one of these files. The loop itself is in `docs/protocol.md`.

All personal data lives in the data home (`data/` in this checkout, or `$LEARN_HOME`); the code
never contains any. Layout:

| path (in the data home) | what | who edits |
|---|---|---|
| `topics/<slug>/topic.json` | title, goal, target level, focus, nested skill tree with levels, `needs`, `foundations` | `bin/learn level/focus/summary/tree`; you for the rest |
| `topics/<slug>/glossary.md` | every term introduced (format below) | `bin/learn term add`, or by hand |
| `topics/<slug>/notes.json` | the tutor's model of the learner: reviews, holes, parked questions, misconceptions | `bin/learn note` only |
| `topics/<slug>/progress.md` | "Resume here": the free-form part of the hand-over notes | you |
| `topics/<slug>/log.md` | dated session log, append-only, read on demand | `bin/learn log` |
| `topics/<slug>/cheatsheet.md` | reference sheet (pipeline, formulas), a wiki tab | you |
| `topics/<slug>/map.json` | concept map: how the subject works, as far as the learner knows | you (or a subagent) |
| `topics/<slug>/pages/<name>.md` | standalone wiki pages (worked examples, interactive walkthroughs) | you, or the wiki job |
| `topics/<slug>/tags.json` | extra skill tags for old journal entries | you |
| `topics/<slug>/journal/YYYY-MM-DD.jsonl` | every message both ways, grades, level changes | `bin/learn` only, never by hand |
| `learner/profile.md` | who the learner is, how they like to be taught (all topics) | tutors, reviewer job, the learner |
| `learner/knowledge.md` | knowledge across topics: islands, shaky foundations, connections, suggested topics | tutors, reviewer job |
| `feedback.md` | queue of remarks about the app and process, for the builder job | UI feedback box, `bin/learn feedback`, builder |
| `reports/*.md` | reports from background jobs (`bin/learn away`) | the jobs |
| `config.json` | optional settings (below) | the learner |
| `state/` | runtime only (inbox, session, jobs), gitignored | the app |

The data home is its own git repo: commit it with `bin/learn commit "message"`.

## Markdown extensions (what the UI renders)

Standard GitHub-flavoured markdown, plus:

**Callouts**

    :::question
    Why would post-norm weaken the residual benefit?
    :::

    :::recap         (also: note, warn, insight, details <Title>)
    …
    :::

`details` is collapsed by default. Use it for deeper dives the learner can open.

**Math (KaTeX)**: `$inline$` and `$$display$$`. Use `\k{key}{tex}` to tag a part of a
formula with a highlight key, e.g. `$$\k{s}{s_j} = \k{q}{q}\cdot \k{k}{k_j}$$`.

**Linked highlighting (the core trick)**: every element tagged with a key lights up
whenever the learner hovers any other element with the same key in the same message.
Use it to connect prose ↔ formula ↔ matrix rows ↔ diagram nodes.
- Prose: `{{the query vector|q}}` (text|key) or `{{q}}` (key used as text).
- KaTeX: `\k{q}{q}`.
- Viz: `key`, `rowKeys`, `colKeys`, `cellKeys`, and per-item `key` fields (below).
- An element may carry several keys separated by spaces: `{{q_bank|q bank}}`.
- Clicking a keyed element pins its highlight. Clicking again unpins it.

**References**
- `[text](msg:2026-11-13.42)`: link to an earlier message (hover shows a preview, click
  jumps there). Use it generously to point at earlier explanations instead of repeating
  them. Imported pre-web sessions have ids too (`bin/learn grep` finds them).
- `[text](term:softmax)`: glossary entry (spaces are fine: `[lr](term:learning rate)`).
  Glossary terms in your text are linked automatically, so you rarely need this.
- `[text](skill:6.3)`, `[text](map:attention)`: skill page, concept-map node.
- `[text](wiki:glossary)`, `wiki:sessions`, `wiki:session/2026-11-13`, `wiki:home`, `wiki:cheatsheet`, `wiki:you`: wiki pages.
  `wiki:pages` lists the topic's standalone pages and `wiki:page/<name>` opens one (see `pages/` below).

**Visualizations**: fenced block with language `viz <type>`, whose body is a JS object
literal (JSON or relaxed: unquoted keys, trailing commas, comments). Types:

````
```viz matrix
{ name: "W_Q", rows: [[0.1, 0.4], [0.9, -0.2]], rowLabels: ["the","bank"],
  colLabels: ["q1","q2"], rowKeys: ["the","bank"], colKeys: ["d1","d2"],
  heat: true, digits: 2, caption: "…" }
```
```viz vector
{ name: "x_bank", values: [0.3,-1.2,0.8], labels: ["water","money","noun"], key: "x", heat: true }
```
```viz bars        // probability distribution / any labelled values
{ items: [{label:"river", value:0.6, key:"river"}, {label:"money", value:0.3}], format: "pct", sort: true }
```
```viz tokens      // token chips, optional attention arcs from one token
{ tokens: ["the","river","bank"], keys: ["the","river","bank"],
  weights: { from: 2, to: [0.1, 0.7, 0.2] }, causal: true }
```
```viz flow        // small left-to-right pipeline
{ nodes: [{id:"t", label:"tokens", key:"tok", sub:"IDs"}, {id:"e", label:"embedding"}],
  edges: [["t","e","lookup"]] }      // omit edges => chain in order
```
```viz plot        // function plot; sliders optional (a toy when present)
{ x: [-4, 4], y: [0, 1], fns: [{ f: "1/(1+Math.exp(-(a*x)))", label: "σ(ax)", key: "sig" }],
  sliders: [{ name: "a", min: 0.1, max: 5, value: 1, step: 0.1 }] }
```
```viz steps       // step-through: each step shows text and highlights keys in the message
{ steps: [ { md: "Compute $q = x W_Q$", hl: ["q","x"] }, { md: "Score every key", hl: ["k","s"] } ] }
```
```viz residual    // a 2-layer toy transformer worked by hand: embedding → (RMSNorm → q/k/v → masked
{ token: "bank" }  // scores → softmax → Σ a·v → W_O → +x → RMSNorm → MLP → +x) × 2, live maths,
```                // step-through, token picker, editable embeddings. Options: web/viz/README.md
```viz js          // anything else: a function body with (el, ctx) available
// ctx.d3, ctx.slider(label,min,max,value,step,onChange), ctx.key(element, key),
// ctx.md(markdownString) -> HTMLElement, ctx.color(key)
const svg = ctx.d3.select(el).append("svg").attr("width", 300).attr("height", 80);
```
````

If a toy will be reused, add it as a named component in `web/viz/` (see `web/viz/README.md`)
instead of copying a `viz js` block around.

Keep visuals small and purposeful: a viz should replace text the learner would otherwise
have to hold in their head. Use concrete small numbers (d=3 or 4), with labelled rows.

## Topic files

### topic.json

```json
{
  "title": "How LLMs work",
  "goal": "the learner's own words from the new-topic form",
  "target": 4,
  "focus": "6.5",
  "skills": [
    { "id": "6", "name": "Pretraining", "children": [
        { "id": "6.1", "name": "Loss & cross-entropy", "level": 3, "notes": "…" },
        { "id": "6.5", "name": "Data & scaling laws", "level": 0, "needs": ["6.1"] }
    ]}
  ]
}
```
A parent with children shows the average of its children. Its own `level` is ignored.
Ids are stable strings. Don't renumber; append new ids.

Optional per-skill fields (all rendered as markdown, so `msg:` links work everywhere):
- `summary`: markdown recap of what the learner has actually covered for this skill, in a
  few bullets with `msg:` links to the explanations. It's the "refresh my memory" text on
  the skill's wiki page. Update it when you teach something new in that skill.
- `misconceptions`: list of short strings, i.e. confusions seen and whether they were resolved.
- `unknown`: list of short strings, i.e. what's in this skill that hasn't been covered yet
  (shown as fog on the skill page).

### Skill dependencies: `needs` and `foundations` (topic.json)

The Tree view draws the skills as a tech tree ("Tiers", columns by depth) or compactly
("Branches", one panel per top-level branch, links across branches shown on hover). Its edges come
from `needs`:

```json
{
  "foundations": [
    { "id": "linalg", "name": "Linear algebra: vectors, dot products, matrix multiply", "level": 3,
      "why": "attention scores are dot products", "topic": "maths" }
  ],
  "skills": [ { "id": "4", "name": "Attention", "children": [
    { "id": "4.1", "name": "Q, K, V & dot-product scores", "level": 3, "needs": ["2.1", "linalg"] } ] } ]
}
```

- `needs`: ids this skill builds on: skills in this topic, or foundation ids. Soft: the learner
  may start a skill early; the tree shows it as "early" when a need is below level 2.
- `foundations`: knowledge from outside the topic that skills rely on (often maths). `id` is a
  word (skill ids are numbers), `level` is your estimate (`bin/learn level <topic> linalg 2`),
  `why` says what needs it, and `topic` names another topic that covers it, once one exists. A weak
  foundation is a good reason to suggest a short side topic (and to note it in
  `learner/knowledge.md`).
- Edit both with `bin/learn tree`: it prints the tree as an outline, and `tree --set` replaces it
  from one (levels, summaries and other fields are kept by id):

      @linalg Linear algebra: vectors, dot products, matrix multiply
      4 Attention
        4.1 Q, K, V & dot-product scores <- 2.1, linalg

### notes.json (via `bin/learn note` only)

```json
{ "next": 4, "items": [
  { "id": "n1", "kind": "review", "skill": "6.4", "text": "why post-norm weakens the residual", "created": "2026-11-21", "due": "2026-11-23", "status": "open" },
  { "id": "n2", "kind": "hole", "skill": "5.1", "text": "…", "ref": "2026-11-13.4", "status": "done", "closed": "2026-11-25", "outcome": "solid now" } ] }
```

Kinds: `review` (re-test later; optional `due`), `hole` (a suspected gap, worth probing when it's
relevant; never interrupt the current thread for it), `parked` (a learner question deferred),
`misconception` (a confusion seen; close it when resolved). The UI shows them on the wiki's "You"
page and on skill pages; `bin/learn resume` lists the open ones.

### Pending question rubric

`bin/learn post --expect "what a good answer needs"` stores the rubric on the question message
(field `expect`, never shown to the learner). `bin/learn resume` and `pending` print it, so a fresh
session can grade an answer to a question it didn't ask.

### progress.md and log.md

`progress.md` holds only "## Resume here (read first)": where we are, the plan, the learner's
state of mind, small debts ("msg X linked the wrong id"). It is the free-form part of the hand-over;
structured things live elsewhere (pending question + rubric in the journal, reviews/holes/parked in
notes.json, focus and levels in topic.json). `log.md` is the session history:
`bin/learn log "…"` appends a bullet under today's date.

### learner/profile.md, learner/knowledge.md

Short markdown files shared by every topic. `profile.md`: background and how the learner likes to
be taught (sections Background / How I like to learn / Interface preferences). `knowledge.md`:
Solid / Shaky foundations / Connections worth making / Suggested topics, one line each with
topic and skill ids, guesses marked "(hypothesis)". `bin/learn resume` prints both, so keep them
under ~2 KB each.

### feedback.md

A checklist: `- [ ] 2026-11-21 (learner, llms · learn): text`. The builder job turns `- [ ]` into
`- [x] … → done: what changed (commit)`. Continuation lines are indented.

### config.json (optional)

```json
{
  "agent": "claude",
  "handoffTokens": 400000,
  "handoffMessages": 80,
  "awayJobs": ["builder", "reviewer"],
  "agentMcp": false,
  "jobPermissionMode": "acceptEdits"
}
```

- `agent`: `"claude"` (default) or `{ "cmd": "codex", "interactive": ["{prompt}"], "headless":
  ["exec", "{prompt}"] }` for any other CLI agent (see `app/agent.js`).
- `handoffTokens`: context size at which the tutor hands over to a fresh session (Claude only).
  `handoffMessages`: the same, by tutor message count, for agents without a context meter.
- `awayJobs`: default jobs for the "I'm away" button / `bin/learn away`.
- `agentMcp`: `true` keeps the agent's MCP servers in tutor sessions (off by default: they cost
  context and the tutor doesn't use them).


### pages/<name>.md (optional)

A standalone wiki page, for reference material the learner wants to reopen: a worked example,
an interactive diagram, a summary that outgrew a message. It's the same markdown as messages
(callouts, KaTeX, `{{text|key}}` highlights, `viz` blocks, `msg:`/`skill:`/`term:` links), shown
under Wiki → Pages and linkable as `[text](wiki:page/<name>)`.
- `<name>` is lowercase a-z, 0-9 and `-` (e.g. `residual-stream`). Other file names are ignored.
- The first `# Heading` is the page title (else the name). The first plain paragraph is the
  summary in the page list.
- `skill:` links in the page put its skills in the page header, and list the page on those
  skills' wiki pages. So link the related skills, e.g. a "Related skills" line at the end.
- The browser updates when the file changes. `bin/learn check` validates its links and warns
  about `wiki:page/<name>` links to pages that don't exist.

### tags.json (optional)

`{"2026-11-12.27": ["4", "4.1"], ...}`: skill tags for journal entries that were posted
without `--skill` (e.g. imported terminal sessions). The UI merges them into the entries.

### glossary.md

```markdown
## softmax
aliases: soft-max
skill: 3
size: —
see: logits, temperature
Turns any list of scores into positive weights that sum to 1: e^x / Σe^x.

Optional longer explanation (any markdown, viz blocks allowed). Shown on the term's page.

## PPO
full: **P**roximal **P**olicy **O**ptimization
parts: policy, policy gradient, KL penalty
skill: 7.2
An RL algorithm that improves the policy in small, clipped steps.
```
- `## term` starts an entry. Metadata lines (`aliases`, `skill`, `size`, `see`, `refs`,
  `full`, `parts`) go directly under the heading, in any order. The first paragraph after them is the short definition (the
  hover tooltip), so keep it to 1–2 sentences. Everything after that is the long body.
- `refs`: message ids where it was explained best (comma separated). The UI also finds
  occurrences automatically, so refs are only for the canonical explanation.
- `skill` may be a comma list (`4.4, 6.1`). The first one is the primary skill.
- `full`: the expansion of an acronym or abbreviated name, as inline markdown (bold the
  initials). Shown after the term in the tooltip header, on the term page and in glossary
  lists ("PPO — Proximal Policy Optimization"). Use it instead of opening the short
  definition with the expansion; older entries that do that still render fine.
- `parts`: the sub-terms the expansion or definition is built from (comma list of glossary
  terms or aliases). Listed with their own short definitions on the term page ("Built
  from"), and as links in the tooltip. Unlike `see` (merely related), these are what the
  term is made of. Add the missing ones to the glossary; `bin/learn check` warns otherwise.
- An unknown key (a typo like `ful:`) ends the metadata block and becomes the definition;
  `bin/learn check` warns about it.
- The glossary can be sorted A–Z or newest first. "Newest" is derived from the first message
  that mentions the term (or its earliest `refs` id), so there is no date field to keep.
- Blank lines between the heading and the metadata are tolerated. The metadata block
  ends at the first line that isn't `key: value`.
- Auto-linking matches the term and each alias separately. Each form is case-insensitive
  unless that form has capitals (so "KV cache" needs exact case, while an alias "kv cache"
  matches any case). A plural -s/-es is allowed. The longest form wins where names
  overlap ("residual connection" beats "residual"). Only the first occurrence per message
  is linked.

### map.json

The concept map: how the whole thing works, drawn as boxes on a grid. Nodes are coloured
by the learner's level on the linked skill. Level 0 is drawn as "fog" (unknown territory,
dashed). Clicking a node shows its description, terms, and every message that discussed
those terms.

```json
{
  "title": "How an LLM works",
  "cols": 6,
  "groups": [ { "id": "fwd", "label": "Forward pass (inference)", "col": 0, "row": 0, "w": 6, "h": 3 } ],
  "nodes": [
    { "id": "embed", "label": "Embedding lookup", "col": 1, "row": 1, "skill": "2",
      "terms": ["embedding table", "hidden state"], "desc": "markdown: what happens here",
      "sub": "token id → 4096 floats" }
  ],
  "edges": [ { "from": "tok", "to": "embed", "label": "IDs" } ]
}
```
`col`/`row` are grid cells. Nodes and groups take an optional `w`/`h` span. Groups may
nest (the inner one is drawn on top, so list it after the outer one). Edges between
different top-level groups are drawn faint until a connected node is hovered or selected,
so draw cross-region edges freely. `rowHeight` (default 100) sets the row height. A node may set `"status": "unknown"`
to force fog regardless of level, e.g. for a region the learner hasn't heard of yet.
