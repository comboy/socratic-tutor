# File formats and markdown extensions

Reference for the tutor and the builder. Read the section you need when you write a message with
something unusual in it, or edit one of these files. The loop itself is in `docs/protocol.md`.

All personal data lives in the data home (`data/` in this checkout, or `$LEARN_HOME`); the code
never contains any. Layout:

| path (in the data home) | what | who edits |
|---|---|---|
| `topics/<slug>/topic.json` | title, goal, target level, focus, nested skill tree with levels, `needs`, `foundations`, `legend` | `bin/learn level/focus/summary/tree/legend`; you for the rest |
| `topics/<slug>/glossary.md` | every term introduced (format below) | `bin/learn term add`, or by hand |
| `topics/<slug>/notes.json` | the tutor's model of the learner: reviews, holes, parked questions, misconceptions | `bin/learn note` only |
| `topics/<slug>/progress.md` | "Resume here": the free-form part of the hand-over notes | you |
| `topics/<slug>/log.md` | dated session log, append-only, read on demand | `bin/learn log` |
| `topics/<slug>/cheatsheet.md` | reference sheet (pipeline, formulas), a wiki tab | you |
| `topics/<slug>/map.json` | concept map: how the subject works, as far as the learner knows | you (or a subagent) |
| `topics/<slug>/pages/<name>.md` | standalone wiki pages (worked examples, interactive walkthroughs) | you, or the wiki job |
| `topics/<slug>/terms/<name>.md` | a glossary term's own article: what the learner knows about it | you, right after the reply that taught it; the wiki job catches up |
| `topics/<slug>/tags.json` | extra skill tags for old journal entries | you |
| `topics/<slug>/media/` | downloaded images + `index.json` (author, licence, source) | `bin/learn image` |
| `topics/<slug>/journal/YYYY-MM-DD.jsonl` | every message both ways, grades, level changes, tags (format below) | `bin/learn` only, never by hand |
| `learner/profile.md` | who the learner is, how they like to be taught (all topics) | tutors, reviewer job, the learner |
| `learner/knowledge.md` | knowledge across topics: islands, shaky foundations, connections, suggested topics | tutors, reviewer job |
| `learner/pills/<slug>.md` | the knowledge pill: what the learner knows in a topic as one portable file | generated: `bin/learn pill --all` (the reviewer job) |
| `feedback.md` | queue of remarks about the app and process, for the builder job | UI "Change the app" page, `bin/learn feedback`, builder |
| `reports/*.md` | reports from background jobs (`bin/learn away`) | the jobs |
| `config.json` | optional settings (below) | the learner |
| `state/` | runtime only (inbox, session, jobs), gitignored | the app |

The data home is versioned apart from the code: its own git repo, normally a real `data/` folder in
the checkout (a symlink works, but the agent's permissions then prompt on every file). `learner/`
can live outside the data home (config.json's `learner`); a `learner` link keeps the paths above
working either way. Commit with
`bin/learn commit "message" [-- paths]`: it commits the data home and the learner folder in
whichever repo holds each, and nothing else in a shared repo. `bin/learn status` shows where both are.

## Markdown extensions (what the UI renders)

Standard GitHub-flavoured markdown, plus:

**Callouts**

    :::question
    Why would post-norm weaken the residual benefit?
    :::

    :::recap         (also: note, warn, insight, aside, fog, details <Title>)
    …
    :::

`details` is collapsed by default. Use it for deeper dives the learner can open. `aside` is a
book's [i] box: something fun or interesting that is off the main line (where a name comes from,
a bit of history, a surprising number), drawn smaller and dimmed so it reads as optional and the
explanation around it stays undiluted; `:::aside Why "ribosome"?` gives it its own label. `fog` is drawn
faded with a dashed border, labelled "Not covered yet": what lies beyond what the learner has
learned (mainly at the end of a term page, see `terms/` below).

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
  Glossary terms in your text are linked automatically (every occurrence, see glossary.md
  below), so you rarely need this.
- `[text](skill:6.3)`, `[text](map:attention)`: skill page, concept-map node.
- `[text](wiki:glossary)`, `wiki:sessions`, `wiki:session/2026-11-13`, `wiki:home`, `wiki:cheatsheet`, `wiki:you`: wiki pages.
  `wiki:pages` lists the topic's standalone pages and `wiki:page/<name>` opens one (see `pages/` below).
  `wiki:term/<term>` opens a term's full page in the wiki (`term:` opens it in the side panel).

**Tips: hover notes for one message**: `[template strand](tip:the strand being read, the one being copied)`.
The phrase reads as ordinary text; hovering it shows the note in the same card as a glossary
term (labelled "in this message"). Use it for a context-specific reminder that isn't a glossary
entry: what a symbol or a label means *here*, which of two things "it" is, a number's unit. The
note is markdown (`**bold**`, `$x$`, glossary terms get their own nested cards), may contain
spaces and one level of parentheses (`(tip:read 3′→5′ (backwards))`), but no line breaks, and
in a table no `|`. A real term goes in the glossary instead: it then works in every message.

**Images**: `![Replication fork](media:dna-replication-en.png)` shows an image downloaded into
the topic with `bin/learn image`, with the alt text as its caption and the author,
licence and a source link under it. It works offline. Click any image for a large view.
`bin/learn image "File:DNA replication en.svg"` (or a Commons page/image URL) downloads it,
`bin/learn image search "words"` finds candidates on Wikimedia Commons, and a local file works
too: `bin/learn image fig.png --author "…" --license "CC BY 4.0" [--source url]`. A message that
hotlinks a Commons image shows the local copy once that file has been downloaded. `post` refuses,
and `check` reports, a `media:` file that isn't in the topic's `media/` folder.

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
```viz figure      // a real image (media: file) with only what matters brought forward: the rest dimmed,
{ src: "replication-fork.png", caption: "Look at **1** and **2** only",   // numbered regions + a list,
  focus: [ { x: .52, y: .18, w: .26, h: .22, label: "helicase unzips it", key: "helicase" },
           { x: .08, y: .56, w: .36, h: .26, label: "lagging strand, in pieces" } ],
  arrows: [ { from: [.95, .5], to: [.62, .5], label: "the fork moves this way" } ],  // e.g. reading direction
  hide: [ { x: 0, y: .9, w: .3, h: .1 } ] }   // blank out labels that would distract
```                // x, y, w, h: fractions of the image from the top left (or pixels: any value > 1);
                   // look at the downloaded file to place them. Hover a row = its region lights up.
```viz js          // anything else: a function body with el, ctx and d3 already in scope
// (don't declare them: `const d3 = …` is a SyntaxError). ctx.slider(label,min,max,value,step,onChange)
// returns an element: append it. ctx.key(element, key), ctx.md(markdownString) -> HTMLElement, ctx.color(key),
// ctx.uid("ah") -> an id unique to this drawing (marker/gradient ids are scoped automatically)
const svg = ctx.d3.select(el).append("svg").attr("width", 300).attr("height", 80);
```
````

If a toy will be reused, add it as a named component in `web/viz/` (see `web/viz/README.md`)
instead of copying a `viz js` block around. Draw with the topic's legend colours
(`ctx.color(key)`, `ctx.legend()`; see "Visual language" below), not ad-hoc hex values.

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

### Visual language: `legend` (topic.json)

One colour per recurring thing in the topic (a base, a strand, an enzyme, a class of molecule),
the same in every drawing, highlight and page, so colour carries meaning across lessons instead
of being reinvented in each diagram:

```json
"legend": [
  { "key": "adenine", "color": "#5cb85c", "label": "A (adenine)", "term": "adenine" },
  { "key": "template", "color": "#9aa7b4", "label": "template strand", "term": "template strand" }
]
```

- `{{the template strand|template}}` in prose, `\k{template}{…}` in formulas and `ctx.color("template")`
  in a `viz js` drawing all get the legend colour (keys not in the legend keep the six rotating
  highlight colours). Tag drawn shapes with `ctx.key(el, "template")` so hovering links them up.
- `el.append(ctx.legend(["adenine", "template"]))` draws the key under a drawing: swatches with
  labels, and hovering one lights up its parts. Prefer it to hand-drawn legends.
- `term` (optional) ties the colour to a glossary term: its page shows the swatch.
- The wiki's Cheat sheet tab lists the legend ("Colours in diagrams"), and `bin/learn resume` prints
  it, so every session draws with the same colours.
- Edit with `bin/learn legend [t] set <key> <#color> "label" [--term name]` / `legend [t] rm <key>`
  (it warns when a colour already means something else). Mid-tone colours (like `#5b9bd5`) read on
  both themes; dark text (`#10202e`) on a filled shape stays readable.
- One colour means one thing: before giving a new kind of thing a colour, check the legend; reuse
  the entry if it's the same thing, pick an unused colour if it isn't.

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
notes.json, focus and levels in topic.json). It goes stale quietly, because notes change every
lesson and this file only when someone rewrites it: `check` warns, and `resume` flags under "Resume
here", when it names a note id that's already closed (a mention that says so, "n9 closed", is fine).
Rewrite the stale lines then; the next tutor reads this section first. `log.md` is the session history:
`bin/learn log "…"` appends a bullet under today's date.

### learner/profile.md, learner/knowledge.md

Short markdown files shared by every topic. `profile.md`: background and how the learner likes to
be taught (sections In my own words / Background / Observations so far / Working with this
workspace / Interface preferences; the knowledge pill quotes the first three, so keep what's about
how they learn apart from what's about this app).
"In my own words" is written by the learner and agents never edit it; the other sections are
derived, so write them as observations with the reason behind each, not as hard rules. `knowledge.md`:
Solid / Shaky foundations / Connections worth making / Suggested topics, one line each with
topic and skill ids, guesses marked "(hypothesis)". `bin/learn resume` prints both, so keep them
under ~2 KB each.

### learner/pills/<slug>.md

The knowledge pill: where the learner stands in one topic, as a short markdown file to attach to any
chat, tutor or agent so it knows at what level to talk to them. Its reader knows the subject, so it
never explains it, and it isn't the learning process (checks, reasons, notes stay here): skills
grouped by level, foundations, what was corrected recently and may not have stuck (open
`misconception` notes, first clause each), and about them (profile.md: Background, "In my own
words", the leads of the observations about how they learn; sections about this app, "Working with
this workspace" and "Interface preferences", stay out). Many pills together are a picture of the
person. Made by `app/pill.js`, so nobody edits it by hand: improve the sources instead (levels,
skill names that read well on their own, closing a misconception note once it's re-checked).
`bin/learn pill [t]` prints it, `--write` / `--all` saves it; the UI shows it under Wiki → You with
a Copy button.

### feedback.md

A checklist: `- [ ] 2026-11-21 (learner, llms · learn): text`. The builder job turns `- [ ]` into
`- [x] … → done: what changed (commit)`. Continuation lines are indented.

### config.json (optional)

```json
{
  "agent": "claude",
  "handoffTokens": 400000,
  "handoffMessages": 80,
  "agentMcp": false,
  "tutorPermissionMode": "auto",
  "jobPermissionMode": "auto",
  "learner": "../learner"
}
```

- `learner`: where `learner/` (profile, knowledge, pills) lives, relative to the data home's real
  location or absolute. Default: `learner/` inside the data home. Set it when the learner folder is
  shared with other tools, e.g. a learning repo with `learner/` at its top and this app's data in
  `tutor/`. The app links `<data home>/learner` to it (gitignored).

- `host`: the address the server listens on. Default `127.0.0.1` (this machine only); an IP such
  as a VPN address or `0.0.0.0` makes it reachable from other machines, with an access token
  (`docs/setup.md`, "Running on a server"). `bin/learn --host <ip>` and `LEARN_HOST` override it.

- `agent`: `"claude"` (default) or `{ "cmd": "codex", "interactive": ["{prompt}"], "headless":
  ["exec", "{prompt}"] }` for any other CLI agent (see `app/agent.js`).
- `handoffTokens`: context size at which the tutor hands over to a fresh session (Claude only).
  `handoffMessages`: the same, by tutor message count, for agents without a context meter.
- `awayJobs`: fixed jobs for the "I'm going away" button / `bin/learn away`, instead of letting
  the planner (`docs/jobs/plan.md`) choose. Unset by default: the planner decides.
- `agentMcp`: `true` keeps the agent's MCP servers in tutor sessions (off by default: they cost
  context and the tutor doesn't use them).
- `tutorPermissions`: the tutor runs in a terminal nobody watches and jobs run headless, so by
  default both run in Claude Code's auto mode (`--permission-mode auto`: any tool, risky actions
  blocked, no prompts; see `app/agent.js`). `tutorPermissionMode` / `jobPermissionMode` pick
  another mode, `tutorTools` / `jobTools` add an `--allowedTools` list, and `"ask"` leaves the
  tutor to Claude Code's own settings.


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

### terms/<name>.md (optional): a page per glossary term

A glossary term's own wiki page: "Wikipedia in terms the learner understands". It gathers what
the learner knows about the term, from every lesson that touched it, so they can reopen one page
instead of hunting through messages. The UI shows it on the term's page (wiki and side panel)
under "What you know", between the definition and the automatic sections: "Built from" (`parts:`),
related terms, "Linked from" (terms built from it or mentioning it, pages mentioning it, map nodes
listing it), "Pictures from your lessons" (images in messages whose caption names the term) and
"Explained in" (every message).

- `<name>` is the term in lower case with words joined by `-` ("KV cache" → `kv-cache.md`,
  "5′ cap" → `5-cap.md`), or the same for one of its aliases. `bin/learn term show <term>`
  prints the exact path (and the page, if there is one); `bin/learn term pages` lists the terms
  that have one and the most-mentioned terms that don't.
- No title line: the term is the title (a leading `# …` line is dropped). Don't repeat the short
  definition either; it's shown right above. Start with what the learner knows beyond it.
- **An article, not an index.** It must read on its own, like a good encyclopedia entry written
  for this learner: someone who forgot the lessons understands the term from this page alone,
  without clicking anything. Explain it in full sentences (the mechanism, the numbers, the
  picture); never put a link where the explanation should be ("explained [here](msg:…)" alone is
  a failure). Lesson links are small references after the sentence they back up (`([lesson](msg:…))`).
- Write only what the learner has actually covered, in their words where possible, connecting it
  to the other terms they know (`term:` links). Same markdown as messages: images (`media:`),
  `viz` blocks (re-use the lesson's drawing, so the page shows the picture they learned it from),
  formulas, highlights, `term:`/`skill:`/`wiki:` links. Sections are up to you; a few short ones
  beat one long one ("What it does", "How it works", "Where you've met it", "Careful").
- End with a `:::fog` block: a few bullets on what there is still to learn about it (with the
  skill it belongs to), faded, so the page shows the edge of what they know.
- Keep it current: when a lesson adds something about the term, add it to the page.
  `bin/learn term pages` marks pages whose term was mentioned since the page was last updated.
- `bin/learn check` validates the links, and warns about a file that no term or alias owns.

### journal/YYYY-MM-DD.jsonl

One JSON object per line, appended by `bin/learn` and the server, never edited (ids are
`<date>.<n>`). Common fields: `id`, `ts`, `topic`, `role` (`user`/`tutor`/`system`), `kind`:
- `answer`, `ask`, `action`, `start`, `meta` (the learner; `text`, optional `replyTo`, `quote`, `track`)
- `message` (the tutor; `text`, `skills`, `question`, `expect`, `replyTo`, `track`; `queue: true`
  for a review question prepared ahead: open alongside others in its thread until answered,
  skipped or graded, `openQueue` in `web/js/journal.js`)
- `grade` (`target`, `verdict`, `skill`, `note`), `level` (`skill`, `from`, `to`, `reason`),
  `session` (a divider; `handoff`)
- `correction` (`target`, `newText`, `note`, `question`, optional `expect`): the tutor put a
  message of its own right (`bin/learn post --corrects`). Never an edit: the original line stays.
  Readers go through `applyCorrections` (`web/js/journal.js`; `S.readJournal` and the UI do), which
  gives the target message the new `text` (and `question`/`expect`), `corrected: { ts, note, ids }`
  and `versions: [{ text, ts }, …]` (what it said before, oldest first). `readJournalFile` is the
  raw lines.
- `tag`: `{"kind": "tag", "tag": "meta", "ids": ["2026-11-22.33", …]}` marks earlier entries
  (`bin/learn meta`); `"off": true` takes the tag back.
- `tracks`: `{"kind": "tracks", "open": true, "titles": {"a": "…", "b": "…"}}` opens two threads,
  `{"kind": "tracks", "open": false}` goes back to one (`bin/learn track`). While open, lesson
  entries carry `"track": "a"` or `"b"` (none means `a`); each thread has its own pending
  question (`web/js/journal.js`).

**App talk** (`web/js/journal.js`): an entry with `"meta": true` (the learner's "About the app"
message, kind `meta`; a tutor reply posted with `--meta`), a tag entry, or an entry a tag names. It
stays in the conversation (dimmed, folded) but is left out of the learning record: wiki, session
pages, stats, term mentions, `msgs`, `grep`, `resume`, and the pending question.

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
(For more than a paragraph, write the term's own page instead: terms/<name>.md, above.)

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
- Auto-linking (`web/js/terms.js`) matches the term and each alias separately, everywhere in
  the text: bold, lists, tables, callouts and headings too, but not in code, formulas, existing
  links, `{{…}}` highlights, page titles, callout labels or viz drawings (viz captions and step
  text are prose and are linked). Every occurrence gets the hover card; the first one in a
  message is underlined clearly, repeats faintly.
- A form in lower case matches any case. A form with capitals keeps them ("KV cache" matches
  "KV Cache" but not "kv cache"; add an alias "kv cache" for that). Words may be separated by
  spaces or a hyphen ("non-polar" = "non polar"). Plurals are allowed: -s/-es, y→ies, us→i,
  um→a, -rion→-ria, and a plural form also matches its singular. The longest form wins where
  names overlap ("residual connection" beats "residual").
- Bold a new term where you define it: `bin/learn post` and `bin/learn terms-missing [t]` list
  bold phrases that match no term or alias, so you can add the ones that are terms.

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
