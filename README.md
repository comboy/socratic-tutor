# learn

A Socratic tutor for anything, up to research level, running on your own machine. An AI coding
agent (Claude Code by default) is the tutor, and a small local web UI is where you read, answer,
and look things up again later.

You say what you want to learn. The tutor asks a few questions to see where you stand, maps the
topic (a skill tree, a concept map, a glossary), then explains a chunk at a time and checks your
understanding with one conceptual question after each. Levels rise only on real evidence. Every
message, grade and level change is stored as plain files, so you can stop and resume any time and
re-read anything you've forgotten.

The tutor can also **extend the UI itself**: new visualizations, exercises or views when a topic
needs them. And while you're away, background agents work through your feedback on the app, review
your sessions for gaps, and write wiki pages from what you covered.

```
bin/learn                    # the only command you need: web server + tutor + browser.
                             # Leave it running; running it again just opens the browser.
```

Everything else happens in the browser: pick or create a topic, and the tutor loads it when you
write. After a break, a "welcome back" bar offers a recap (or you just carry on). For developers:
`bin/learn demo [--empty]` (the UI on sample data with a fake tutor), `bin/learn test` (acceptance
tests, needs Chrome), `bin/learn help` (all commands, including the tutor's).

Requirements: Node 22+, [Claude Code](https://claude.com/claude-code) (or another CLI agent, see
"Agents" below), and Chrome or Chromium for the tests. No npm install: d3, marked and KaTeX are
vendored in `web/vendor/`.

## Using it

- **New topic:** the first screen, or "+ New topic…" in the topic selector. Say what you want to
  learn in your own words; optionally what for and what you already know.
- **Answer** box: replies to the open question, shown in full above it. **Ask / learn more** box:
  side questions, which don't close the open question. ⌘↵ sends either.
- Buttons under the boxes: just tell me, example, I'm lost, skip, easier/harder, progress, pause.
- Hover an underlined term for its definition; click it for the full entry and every message
  that explained it. Hover a coloured symbol in a formula, a matrix row or a highlighted phrase,
  and the matching parts light up. Select text in any message and press **Ask about this**.
- **Pin** a message to keep it in the side panel while you answer. `/` or ⌘K searches everything.
- Views (keys `1`–`5`): **Learn**, **Map** (how the subject works, coloured by your level),
  **Tree** (the skills as a tech tree: what builds on what, what you're ready for, and
  foundations from outside the topic), **Wiki** (overview, cheat sheet, pages, glossary, skills,
  "You": what the tutor has noticed about your understanding, sessions), **Stats**.
- **Feedback** (speech-bubble button): remarks about the app or the process. They never reach
  the tutor; they queue up for the builder. **About the app** (next to Ask) is the same, but the
  tutor sees it too and can answer; that talk stays in the conversation, dimmed and folded, and
  out of your wiki, sessions and stats.
- **I'm going away** (coffee-cup button): one click, nothing to choose. A planner agent looks at
  what's waiting and decides which background jobs are worth running, and why: the builder
  (implements your feedback, with tests), the reviewer (reads recent sessions with fresh eyes:
  gaps, links between topics, process ideas), the wiki writer, the janitor (code tidying), or an
  open task. The popover shows the plan as it runs; the reports appear there too.
- The UI picks up code changes by itself when you're idle, or shows an "Updated · reload" button,
  so it never blinks while you read.

The tutor runs unattended in the terminal, so it doesn't stop for permission prompts: it may run
`bin/learn`, git and read-only shell tools and edit files in the repo (`"tutorPermissions": "ask"`
in `data/config.json` turns that off).

### Long sessions

The status button (top right) shows the tutor's context use. When it gets high, the tutor saves
its notes and a fresh session takes over by itself; you see "switching tutor" for a few seconds.
**Fresh tutor** in that popover does it on demand; **Restart now** is for a stuck tutor. Nothing is
lost, because everything lives in files rather than in the conversation.

## Your data

Everything personal lives in `data/` (gitignored in this repo, and **its own git repo**, created
on first run):

```
data/topics/<slug>/     skill tree, glossary, notes, map, pages, journal, …  (one per topic)
data/learner/           profile.md (how you like to learn), knowledge.md (across topics)
data/feedback.md        your remarks about the app, worked through by the builder
data/reports/           what the background jobs did
data/config.json        optional settings (agent, thresholds)
```

Set `LEARN_HOME=/some/dir` to keep it elsewhere. The code in this repo contains no personal data,
so it can be shared as is.

## Agents

The tutor and the background jobs are CLI agents. Claude Code is the default. Another agent
that can run shell commands works too: put its command line in `data/config.json` (see
`docs/formats.md`, "config.json", and `app/agent.js`). All instructions the tutor needs are in
`AGENTS.md` and `docs/`, not in any agent-specific place.

## How it works

```
browser ──POST /api/send──▶ server ──▶ state/inbox/*.json ──▶ `bin/learn wait` (tutor, in background)
browser ◀──SSE── server ◀── data/topics/<slug>/journal/*.jsonl ◀── `bin/learn post` (tutor reply)
```

- `bin/learn` (the launcher) starts the server and supervises the agent in your terminal. It
  replaces the session on handoff or topic switch.
- `app/`: Node server, storage, launcher, agent adapter, background jobs, topic checker. No
  dependencies. `web/`: the UI as plain ES modules; `web/viz/` holds visualization components.
- `docs/`: `protocol.md` (the tutor's loop), `method.md` (how to teach), `bootstrap.md` (new
  topics), `formats.md` (files and markdown extensions), `design.md` (UI principles),
  `roadmap.md`, `jobs/` (background job prompts). `AGENTS.md` is the entry point for agents.

## Tests

`bin/learn test` copies `test/fixture/` (a synthetic topic that uses every feature, an empty one,
and a learner profile) to a temp dir, starts the real launcher with `test/fake-tutor.mjs`
standing in for the agent, and drives the UI in headless Chrome: rendering, hover cards, sending,
grading, handoffs, a new topic with a topic switch, background jobs, every view, both themes.
Screenshots go to `test/out/`. `--real` also renders every message of your real topics from a
read-only copy; `--headed` shows the browser. It never touches `data/` or a running tutor.
