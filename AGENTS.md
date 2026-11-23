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

## Rules

- **Never put personal learning data in the code repo** (no topic content, names or learner notes
  in code, docs, tests or commit messages). Fixtures in `test/fixture/` are synthetic.
- Commit code changes to this repo; commit data with `bin/learn commit "…"` (the data repo). Small
  commits.
- Everything durable goes in files in these repos, not in an agent's private memory, so any agent
  (or a fresh session) can pick up. Learner preferences: `data/learner/profile.md`. Process ideas:
  `docs/roadmap.md` or `data/feedback.md`.
- Never edit a journal file by hand, never touch `data/state/` while a session may be running,
  and never stop a tutor session you didn't start.
- Keep the app dependency-free, and keep the UI in line with `docs/design.md`.
