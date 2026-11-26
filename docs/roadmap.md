# Roadmap and ideas

Not a work queue (that's `feedback.md` in the data home, worked through by the builder job). Ideas
worth keeping, roughly in order of how soon they'd pay off.

## Across topics

- **Knowledge probes.** Now and then (the reviewer job, or a "surprise me" button), ask a
  general question that pokes at knowledge from several topics at once, to build a model of the
  patterns available to the learner's brain, not just per-topic levels. Store the results in
  `learner/knowledge.md`.
- **Insight offers.** With that model, the tutor can offer things the learner didn't know they
  wanted to learn: "you know X from biology and Y from LLMs; here's the idea that connects them".
  A small "connections" panel on the home screen.
- **Cross-topic links.** `skill:llms/6.4` and `msg:llms/2026-11-21.5` style links that open
  another topic (the store already resolves `topic/id` message ids), so a biology lesson can link
  the exact LLM explanation it builds on.
- **Foundation topics on demand.** The Tree view shows `foundations` (e.g. calculus) with the
  tutor's estimate; one click starts a short side topic aimed only at what the main topic needs,
  and its levels flow back into the foundation node.

## Tutor's toolbox

- **Papers / sources library** per topic (`library.md`: title, authors, year, link, which skills,
  one-line takeaway), with `[text](ref:key)` citations and a wiki tab. Useful from research-level
  topics on.
- **Exercise types** beyond free text: multiple choice with explanations, "order these steps",
  code exercises checked by running them, drag-to-label diagrams.
- **Viz library growth:** components built for one topic (e.g. a pathway stepper for biology)
  promoted to `web/viz/` with a README entry, so later topics reuse them.

## Process

- The reviewer job makes method changes in `docs/method.md` itself, with the evidence and the
  reason, and lists them in its report so the learner can object.
- Measure what helps: time to level-up per skill, review failure rate, which message styles
  (viz vs prose, length) precede correct answers.

## Reliability of the message path

A review of the whole path (browser → server → inbox → `wait` → the agent → `post` → journal →
browser) on 2026-11-26, after a learner's message was taken from the queue by a `wait` that ended
with exit code 0 and no output. What was fixed is in `docs/how-it-works.md` ("What keeps a message
from getting lost"). What that incident was is not known: the server did not restart at that
moment (same process before and after, per `state/server.log`), `wait`'s code was not being
edited, and a stress run (140 deliveries, under load, with `--host`) lost nothing. One way to get
exactly that symptom was found and closed (a server answer cut off after its headers left a
promise that never settled, and node then exits with 0), but nothing shows it happened then. So
the fixes don't rest on the cause: whatever makes a delivery vanish, the message comes back.

Still open, most worth doing first:

- **The server runs old code for as long as background jobs run.** It restarts on a change in
  `app/` only when no job is running (jobs are its children), and jobs ran for over two hours
  during a lesson that day, with a dozen commits to `app/` waiting. A fix to the server is then
  not live when one thinks it is, and the tutor's CLI (fresh code on every call) talks to a server
  several versions behind. Worth making the job runner independent of the server process, so the
  server can restart at once; until then `server.log` shows the last "restarting" line.
- **A live lesson runs on the working tree.** Every `bin/learn` call of the tutor loads whatever
  is on disk, so an agent editing `bin/learn` or `app/` in several steps can hand the tutor a
  half-state (a syntax error is loud and harmless: the command fails and the tutor retries; a
  file that loads but is half-changed is not). `wait` now loads what it needs before it blocks
  and prints the message before anything else, which covers the worst case. The real cure is to
  run the tutor's commands and the server from the last commit (a `git worktree` of HEAD that the
  launcher updates when a commit passes `node --check`, or when the tests pass), so only finished
  work reaches a lesson. It changes how developers see their change live, so it needs a decision.
- **An agent that crashes takes everything down.** When the agent process exits, the launcher
  exits too and stops the server it started: the browser says "No connection". Restarting the
  agent after a crash (non-zero exit after it ran for a while) would be the same recovery as the
  watchdog's; not done because an exit the learner asked for (quitting the agent in its
  terminal) may also be non-zero, and that needs checking per agent.
- **The watchdog reads "idle" from the transcript.** A single foreground command that runs for
  more than five minutes with no `wait` armed, while a message waits, looks idle and gets the
  tutor replaced. That is the price of not leaving the learner waiting on a dead session; if it
  bites, look at the agent's child processes as a second signal (`config.json`
  `watchdogSeconds` tunes or disables it). The same session can't be woken from outside (Claude
  Code has no way in except a background task ending); a nudge would keep the context that a
  restart loses.
- **`post` is not idempotent.** If the server saves a reply and dies before answering, `post` now
  fails loudly (it used to end silently) and the tutor may post again: the reply shows twice.
  The browser's sends carry a client id for this; `post` could carry one too.
- **A `wait` nobody reads.** A `wait` started outside the tutor (another agent trying things in
  the live checkout, with or without `LEARN_SESSION` in its environment) takes messages and
  prints them to nobody. The re-delivery net catches it two minutes later; refusing to listen
  when the launcher's session isn't one's own parent would be immediate, but an agent harness
  that doesn't pass environment variables through would then never hear anything.

## Sharing

The code is shareable as is: all personal data lives in the data home (`data/`, gitignored, its
own repo or a folder of the learner's learning repo). Published as its own repo with the app's
history from the point the data moved out (the earlier commits held lessons). Before making it
public, or pushing after a big change:

1. `bin/learn share check --history` (add `--terms` to also list textbook terms from your topics):
   personal traces in the tracked files, commit messages and history. Example ids and the demo
   topic's name in the docs are fine.
2. A LICENSE (the owner's choice), and `bin/learn demo --empty` still gives a good first run (the
   "What do you want to learn?" screen). A new user needs only Node 22+ and their own agent CLI
   (Claude Code by default, their subscription); `data/` is created on first run.
3. `bin/learn share export <dir>` remains for publishing a copy without history (one commit).

## Learner data beyond this app

- **`learner/` as shared ground.** It can already live outside the data home (config.json
  `learner`), e.g. at the top of a learning repo that other tools also use. Worth keeping its files
  tool-neutral: plain markdown, no `msg:`/`skill:` links, so any agent can read them as context.
- **Learning content outside the app.** Term articles, wiki pages and cheat sheets are markdown
  with the app's extensions (`viz` blocks, workspace links, `media:` images). If they're wanted
  elsewhere (reading on a phone, another tool), generate a plain export (`bin/learn export
  <topic>`: links resolved, viz as static images or dropped, images copied) rather than keeping a
  second copy by hand.
