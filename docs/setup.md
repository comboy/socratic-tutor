# Getting a machine ready (for the agent helping a new user)

Someone cloned this repo and asked you to get it running. They want to learn something, not to
set up software, so the goal is: they type `bin/learn` and a browser opens on "What do you want to
learn?". Do what you can yourself, ask them only for what needs them (installing system software
if you can't, logging in), and finish by telling them in one or two lines what to run.

## What it needs, and why

- **Node 22+**: the server and CLI are plain Node with no dependencies (no npm install, no build).
- **git**: the learner's data (`data/`) is its own git repo, and the background jobs commit.
- **A CLI coding agent, logged in**: it is the tutor. Claude Code (`claude`) is the default and
  the best tested; the tutor and the background jobs run it in auto permission mode
  (`--permission-mode auto`), because nobody watches the terminal while the learner is in the
  browser. Other agents work through `data/config.json` ("agent", see `docs/formats.md`,
  "config.json", and `app/agent.js`).
- **Chrome or Chromium**: only for `bin/learn test`.

`bin/learn doctor` checks all of this and says what's missing; `bin/learn` runs the same checks
before it starts. Start there.

## Typical fixes

- Node or git missing: install them the usual way for the platform (Homebrew on macOS, the
  package manager on Linux, the official installers otherwise). macOS without git:
  `xcode-select --install`.
- Claude Code missing: https://claude.com/claude-code has the install command.
- Not logged in: the login is interactive, so the user has to do it: they run `claude` once (or
  `claude auth login`) in a terminal and follow the prompts. Tell them exactly that.
- The agent starts and exits at once: its own message says why. If it's about the permission
  mode (auto mode may not exist on every plan or provider), set `"tutorPermissionMode"` and
  `"jobPermissionMode"` in `data/config.json` to a mode that's available (e.g. `"acceptEdits"`), and
  tell the user the tutor may then stop for permission prompts in the terminal.
- A different agent (Codex, Gemini CLI, …): set `"agent"` in `data/config.json` as described in
  `docs/formats.md`. Check that it can run shell commands non-interactively; the tutor's whole loop
  is shell commands (`docs/protocol.md`).

## Before you hand back

Run `bin/learn doctor` until it's all ✓, and if you like, `bin/learn demo --empty --no-open` to see
the server start (stop it afterwards). Don't start the real `bin/learn` yourself unless the user
wants you to: it takes over the terminal with an interactive agent session, and opens the browser.
Then tell the user: "run `bin/learn`", plus anything they still need to do themselves.
