# How it works

The README is the short version for people. This is everything else: what each part of the UI
does, where data lives, which agents run and with what permissions, the architecture and the tests.
Agents changing the app start at `AGENTS.md`; this file is background for them and for curious
humans.

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
- **The input box**: Answer (closes the open question; the tutor grades it) or Ask (a side
  question), one box with a switch. Esc hides it in the corner while you read; `a` / `q` bring it
  back. **Two threads** (experiment): the tutor runs a second, related thread, and sending in one
  takes you to the other, where the reply is usually ready, so you don't wait while it writes.
- **Feedback** (speech-bubble button): remarks about the app or the process. They queue up for
  the builder; tick **Tell the tutor now** and the tutor also sees it and can answer. That talk
  stays in the conversation, dimmed and folded, and out of your wiki, sessions and stats.
- **I'm going away** (coffee-cup button): one click, nothing to choose. A planner agent looks at
  what's waiting and decides which background jobs are worth running, and why: the builder
  (implements your feedback, with tests), the reviewer (reads recent sessions with fresh eyes:
  gaps, links between topics, process ideas), the wiki writer, the janitor (code tidying), or an
  open task. The popover shows the plan as it runs; the reports appear there too.
- The UI picks up code changes by itself when you're idle, or shows an "Updated · reload" button,
  so it never blinks while you read.
- **Tell it how you learn:** `data/learner/profile.md`, section "In my own words", is yours (the
  agents never edit it, and it overrides what they derive). The rest of that file, and Wiki → You,
  is what the tutors have noticed; the knowledge pill there is what you know in a topic, as one
  file you can hand to any other tool.

**What the agents may do.** The tutor runs in a terminal nobody watches (you're in the browser)
and the background jobs run headless, so a permission prompt would stall them. By default both run
in Claude Code's auto mode (`--permission-mode auto`): any tool, with risky actions blocked by
Claude Code rather than asked about. That's what lets the tutor build a visualization mid-lesson,
and the builder job change the app and **commit to your clone** while you're away. Everything runs
on your own Claude Code subscription or API usage. To keep the agents on a shorter leash, set
`tutorPermissionMode` / `jobPermissionMode` (or `"tutorPermissions": "ask"`) in
`data/config.json` (see `docs/formats.md`, "config.json"). On the first run Claude Code may ask you
to trust the folder in the terminal.

The web server listens on 127.0.0.1 only and answers only pages it served itself (requests from
other sites are refused), since what you type there reaches agents that run commands.

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

The code in this repo contains no personal data, so it can be shared as is, and your data is
versioned on its own: push `data/` to a private repo of yours to back it up or to use it on another
machine.

**Keeping it in a repo of your own.** `data/` *is* a repo of your own: clone it there on another
machine (`git clone <your private repo> data`). If you want one repo for everything you learn,
other tools' folders or your own notes can sit next to `topics/` in it, and `learner/` (what you
know and how you learn) is plain markdown any tool or agent can read.

Keep `data/` a real folder inside the checkout rather than a symlink to somewhere else. The agent
is started in the checkout, and its permissions follow real paths: through a symlink, every read
and write of your data asks first. (`LEARN_HOME=/path` and `"learner": "../somewhere"` in
`config.json` still work, for setups that need them; `bin/learn status` shows where everything is.)

## Updating

`git pull` in this checkout. The builder job commits its own app changes here too, so a pull may
merge; your data is in `data/` and never touched by it. The command is `bin/learn` for historical
reasons (the repo is socratic-tutor, the UI says "learn").

## Setup and troubleshooting

`bin/learn doctor` checks what's needed (Node 22+, git, the agent CLI and its login, Chrome for
the tests); `bin/learn` runs the same checks before it starts. `docs/setup.md` is the guide an
agent follows to get a machine ready.

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
  replaces the session on handoff or topic switch, restarts the server if it dies, and at every
  start puts messages a previous tutor picked up but never answered back in the queue. It opens a
  browser tab only when none is connected.

What keeps a message from getting lost, and where to look when one seems to:

- The browser keeps the text in the box (read-only, "Sending…") until the server has saved it;
  sends retry through a server restart, and a client id stops a retry from posting twice. A
  failure is shown next to the box, with the text still there.
- One event stream per browser, however many tabs are open (a Web Lock picks the tab that holds
  it; the others get its events over a BroadcastChannel). A browser allows six connections to a
  host, and one stream per tab used to use them all up, so sends just hung.
- "Delivering…" shows only while the message is in `state/inbox/` (the status carries the queue),
  and "thinking" ends when the tutor listens again, so neither can stick.
- `state/server.log` has a timestamped line for every message received, picked up and posted, and
  every restart. A restart first checks that the new code loads, and keeps the old server if not.
- Journal appends, notes, terms and levels are written under a lock (`state/locks/`): the
  server, the tutor's parallel CLI calls and the jobs all write the same files.
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
