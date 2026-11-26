# UI design principles

For anyone changing the web UI (the builder job, a tutor building a tool, a contributor). The UI is
a tool someone uses for hours to learn hard things, so it follows a desktop-application model, not
a minimalist "modern web" page.

- **Every region is a visible panel,** so the eye always knows where it is. Sidebars use group
  boxes with header bands and list rows with separators; text sits in a container rather than
  floating on the background, and large empty margins are space taken from the content.
- **Things that act look clickable.** Tabs, segmented controls and buttons have borders and
  states. Prefer buttons over links. The active state is clear but not a glaring white block.
- **Colour carries information,** consistently: the mastery scale is red → amber → green → teal
  (`--lv0..5`), answer is blue, ask is violet, verdicts are green/amber/red, map regions are tinted
  (`--r0..5`), highlight keys cycle `--k0..5`. Decorative colour would dilute that meaning, and
  black and white would throw it away.
- **Soft slate dark theme** (not black, which is harsh over hours of reading) with off-white
  text, a light theme, and "follow system". The system sans font, not a serif. Every new piece
  must work in both themes, since the learner may use either (use the CSS variables in
  `web/app.css`).
- **Dense but calm.** Single-line labels with ellipsis and a tooltip (no labels wrapping word by
  word in narrow sidebars). Resizable panes. Keyboard shortcuts for the frequent things.
- **Never interrupt reading.** Live updates must not blink the page or move what the learner is
  reading: the UI reloads itself for code changes only when the learner is idle, otherwise it
  offers a "reload" button. New messages show a pill instead of yanking the scroll position.
  Only a new tutor reply (shown from its start) or the learner's own message may scroll the
  conversation; anything else (grades, level changes, tags, redraws, images loading, above or
  below) leaves the text at the top edge where it is (`learn.js`, "keeping the reader's place").
  Bookkeeping updates the thread in place instead of redrawing it.
- **Reading gets the screen.** On a laptop the input competed with the conversation for height
  (two boxes side by side plus a row of buttons took a third of it). So there is one input box
  with an Answer / Ask switch (its colour says which; each mode keeps its own draft), the quick
  buttons sit in its footer (icons only when narrow), and Esc or the chevron hides it to two
  buttons in the corner; `a` / `q` or those buttons bring it back.
- **The learner thinks about the topic, not the tool.** Anything about the tool is on one page,
  System (the toolbar's speech bubble, `web/js/system.js`), in four tabs. "Change the app" saves a
  remark for the builder, who works through it while they're away, or with "Tell the tutor now"
  also sends it to the tutor, who answers in the conversation (the UI goes there). "How to teach
  me" is the learner's instructions to every tutor. "Settings" holds the few choices that are
  taste (term suggestions, theme). "Status" shows what the machinery does: the tutor session and
  its light, tokens, reply times, delivery, jobs, the server (`app/sysstats.js`). A full page, not
  a popover: the learner asked for room to write (2026-11-26). The button opens the tab used last,
  so the feedback box, which is how they report problems, stays one click away.
  One place for app remarks: an "About the app" button next to Ask was confusing next to a
  separate feedback box.
  Don't make them configure things; pick good defaults, and add a setting only where people
  really differ. App talk in the conversation (those remarks, the tutor's `--meta` replies,
  tagged entries) is shown dimmed and folded to one line, and kept out of the learning record
  (wiki, sessions, stats).
- **Show only what is measured.** The Status tab is what trust in the delivery rests on ("25
  messages sent, all picked up, none had to be delivered again"), so every number on it comes from
  a file that records it (the journal, the agent's transcript, `state/server.log`,
  `state/jobs.json`), and what nothing records says "not measured" instead of an estimate.
- **The tutor's pill is a light.** Green while nothing suggests a restart, yellow when a fresh
  tutor would be sensible at the next break, red when it should be restarted now; the rule and
  the reasons for its numbers are in `app/sysstats.js` (`tutorHealth`). It informs and never acts:
  the handoff at the threshold and the watchdog work by themselves. Colour is never the only
  carrier: the pill says it in words, and the tooltip, the popover and the Status tab give the
  reason ("Context 310k of 400k").
- **Help with writing must not get in the way of writing.** Glossary suggestions in the text box
  (`web/js/complete.js`) open only for the beginning of a term (three letters, not a common or
  finished word), never take Enter, take the arrow keys only when there is a choice, and Esc
  closes the list before it hides the input. "Find term" (Ctrl+Space) is for the case the
  learner described: the word is gone, what it does is remembered.
- **No dependencies, no build step,** so anyone can clone it and run it. Plain ES modules; d3,
  marked and KaTeX are vendored in `web/vendor/`. A small vendored library is fine when it's
  really needed; each one is more to keep up to date.

- **Experiments say so.** Two threads (`docs/method.md`) is marked "experiment" in the UI: the
  learner should know it may be changed or dropped, and that their impression is the evidence.

Check visual changes with screenshots: `bin/learn test` writes them to `test/out/` (both themes,
a narrow window), and `bin/learn demo` runs the UI on sample data with a fake tutor.
