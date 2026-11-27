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

## Running on a server

By default the server listens on 127.0.0.1, so only that machine can open it. On a server you
reach from your laptop there are three ways in; the first is the one to use unless there's a
reason not to:

1. **SSH tunnel** (nothing to configure): run `bin/learn` on the server as usual, and on the laptop
   `ssh -L 4747:localhost:4747 <server>`, then open http://localhost:4747. The tunnel arrives on the
   server's loopback, so it works like a local browser, and SSH encrypts it.
2. **A VPN address** (Tailscale, WireGuard): `bin/learn --host 100.x.y.z` (the server's VPN IP), or
   `"host": "100.x.y.z"` in `data/config.json` to keep it. Only machines on the VPN can reach it.
3. **All addresses** (`--host 0.0.0.0`): only on a network you trust, since it's plain HTTP.

With 2 and 3 other machines need the access token: the server creates one in
`data/.access-token` (gitignored, mode 600), and `bin/learn status` (and the startup log)
prints the link to open, `http://<address>:4747/?token=…`. Opening it once sets a cookie in that
browser: every tab is in from then on, for 400 days after the last visit (per address: to a browser
the IP and a host name for the same machine are two sites, each needing the link once). Without
the token the server answers 401, and a browser gets a page that waits: it shows a short code, and
typing `bin/learn allow` in a terminal on the server lets in the browser that asked last (it
prints the code; `bin/learn allow <code>` picks one, `--list` shows who is waiting), so no link has
to be copied between devices. That approval is the person's: the command wants a terminal, the
server takes it only from the command line, and an agent asked to do it should tell the person
instead (a browser an agent let in on its own would be a way in for anyone who can talk to the
agent). Why the token at all: what's typed in the browser reaches agents
that run shell commands, so anyone who could reach an open port could get commands run. To change
the token, delete the file; the next request makes a new one (and old links stop working). The
launcher doesn't open a browser then (it prints the link). A reverse proxy on the same machine looks
local to the server (its requests come from 127.0.0.1), so it must do its own authentication.

## Before you hand back

Run `bin/learn doctor` until it's all ✓, and if you like, `bin/learn demo --empty --no-open` to see
the server start (stop it afterwards). Don't start the real `bin/learn` yourself unless the user
wants you to: it takes over the terminal with an interactive agent session, and opens the browser.
Then tell the user: "run `bin/learn`", plus anything they still need to do themselves.
