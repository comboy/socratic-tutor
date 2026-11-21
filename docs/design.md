# UI design principles

For anyone changing the web UI (the builder job, a tutor building a tool, a contributor). The UI is
a tool someone uses for hours to learn hard things, so it follows a desktop-application model, not
a minimalist "modern web" page.

- **Every region is a visible panel.** Sidebars use group boxes with header bands and list rows
  with separators. Text never floats on the background without a container. No large empty
  margins.
- **Things that act look clickable.** Tabs, segmented controls and buttons have borders and
  states. Prefer buttons over links. The active state is clear but not a glaring white block.
- **Colour carries information,** consistently: the mastery scale is red → amber → green → teal
  (`--lv0..5`), answer is blue, ask is violet, verdicts are green/amber/red, map regions are tinted
  (`--r0..5`), highlight keys cycle `--k0..5`. Don't use colour as decoration, and don't drop to
  black and white.
- **Soft slate dark theme** (not black) with off-white text, a light theme, and "follow system".
  The system sans font, not a serif. Every new piece must work in both themes (use the CSS
  variables in `web/app.css`).
- **Dense but calm.** Single-line labels with ellipsis and a tooltip (no labels wrapping word by
  word in narrow sidebars). Resizable panes. Keyboard shortcuts for the frequent things.
- **Never interrupt reading.** Live updates must not blink the page or move what the learner is
  reading: the UI reloads itself for code changes only when the learner is idle, otherwise it
  offers a "reload" button. New messages show a pill instead of yanking the scroll position.
- **The learner thinks about the topic, not the tool.** Anything about the tool goes into the
  feedback box and gets built while they're away (`bin/learn away`). Don't make them configure
  things; pick good defaults.
- **No dependencies, no build step.** Plain ES modules; d3, marked and KaTeX are vendored in
  `web/vendor/`. Vendor a small library only if it's really needed.

Check visual changes with screenshots: `bin/learn test` writes them to `test/out/` (both themes,
a narrow window), and `bin/learn demo` runs the UI on sample data with a fake tutor.
