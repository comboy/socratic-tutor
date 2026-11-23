# Learning workspace: guide for agents

A Socratic tutor for anything, run locally. An AI agent (Claude Code by default; any CLI agent
that can run shell commands, see `app/agent.js`) is the tutor, and a small local web UI is where
the learner reads, answers and looks things up again. This file is for every agent working here.
Whatever role you're in, read the docs for it below, not everything.

## Roles

- **Tutor** (started by `bin/learn` with a prompt pointing here): `docs/protocol.md` (the loop:
  `bin/learn resume / wait / post`), `docs/method.md` (how to teach), `docs/bootstrap.md` (new
  topics), `docs/formats.md` (file formats and the markdown the UI renders, read on demand).
- **Background job** (`bin/learn away` or the UI's "I'm going away" button, run headless): your
  prompt is `docs/jobs/<name>.md` (builder, reviewer, wiki, janitor, task). A planner run
  (`docs/jobs/plan.md`) goes first and decides which jobs run and why; its brief is in your prompt.
- **Developer** (changing the app): this file, `docs/design.md` (UI principles), `web/viz/README.md`
  (visualization components), and the code. Run `bin/learn test` after any change to `app/`,
  `bin/` or `web/`; it uses fixture data, a fake tutor and headless Chrome, and never touches real
  data or a running session. `bin/learn demo` runs the UI on sample data to look at.
- To resume tutoring in a plain terminal (no web UI): "continue <topic>" works too; run
  `bin/learn resume <topic>` first and teach in the terminal following `docs/method.md`.

## Layout

Code and personal data are kept apart so the code can be shared:

- `bin/learn`: the CLI (start, serve, demo, test, away, and the tutor's commands; `bin/learn help`).
- `app/`: Node server, storage (`store.js`), launcher and handoff (`launcher.js`, `session.js`),
  agent adapter (`agent.js`), background jobs (`jobs.js`), topic checker (`check.js`), image
  downloads (`media.js`). No dependencies.
- `web/`: the UI, plain ES modules with no build step; d3, marked and KaTeX vendored in
  `web/vendor/`. `web/viz/`: visualization components.
- `docs/`: protocol, method, bootstrap, formats, design, roadmap, job prompts.
- `test/`: acceptance tests, fixture topics, a fake tutor.
- `data/` (gitignored here; **its own git repo**): the learner's data: `topics/<slug>/`,
  `learner/` (profile, knowledge across topics), `feedback.md` (queue for the builder), `reports/`
  (job reports), `config.json`, `state/` (runtime). `LEARN_HOME=/elsewhere` moves it.

## Working here

The system is built so the learner spends their attention on learning, not on running the system:
agents make the decisions and manage the process themselves. Decide, act, and say what you decided and why (in the
report, the commit, the note), so it can be undone if it was wrong. Ask the learner only what only
they can know (their goals, their taste), and bring your recommendation with the question.

When you write for the next agent (a doc, a job prompt, a note, a hand-over), write for a peer: it
has the same abilities as you and more context about its own situation than you have now. Give it
the intent, what you saw (cite ids) and why it matters, and your suggestion; leave the decision to
it. A rule without its reason can't be adapted when the situation is different, and rules pile up;
a reason travels.

What the setup depends on, and why:

- **The code repo is meant to be shared**: other people run it with their own agent and learn their
  own topics. So no personal learning data in it (topic content, names, learner notes), not in
  code, docs, tests or commit messages; fixtures in `test/fixture/` are synthetic. Everything
  personal lives in `data/`.
- Commit code changes to this repo and data with `bin/learn commit "…" -- <paths>` (the data
  repo; the paths keep another agent's half-written files out of your commit). Small commits are
  easy to read and to revert.
- Everything durable goes in files in these repos, not in an agent's private memory, so any agent
  (or a fresh session) can pick it up. Learner preferences: `data/learner/profile.md` (its "In my
  own words" section is the learner's own voice, the only part that isn't derived). Process
  ideas: `docs/roadmap.md` or `data/feedback.md`.
- The journal is the append-only record that the UI, stats and wiki are built from, so it's
  changed only through `bin/learn` commands. `data/state/` is a live tutor's queue and session
  files, and a tutor session you didn't start is someone's lesson: leave both alone.
- No dependencies and no build step, so anyone can clone and run it; the UI follows
  `docs/design.md` (the learner's taste, with the reasons).
