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
- **The learner thinks about the topic, not the tool.** Anything about the tool goes into the
  feedback box and gets built while they're away (`bin/learn away`). Don't make them configure
  things; pick good defaults. Talk about the app in the conversation ("About the app" next to
  Ask, the tutor's `--meta` replies, tagged entries) is shown dimmed and folded to one line, and
  kept out of the learning record (wiki, sessions, stats).
- **No dependencies, no build step,** so anyone can clone it and run it. Plain ES modules; d3,
  marked and KaTeX are vendored in `web/vendor/`. A small vendored library is fine when it's
  really needed; each one is more to keep up to date.

Check visual changes with screenshots: `bin/learn test` writes them to `test/out/` (both themes,
a narrow window), and `bin/learn demo` runs the UI on sample data with a fake tutor.
