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

- The reviewer job proposes method changes in its reports; collect the ones the learner accepts
  into `docs/method.md`.
- Measure what helps: time to level-up per skill, review failure rate, which message styles
  (viz vs prose, length) precede correct answers.

## Sharing

The code is shareable as is: all personal data lives in the data home (`data/`, gitignored, its
own repo). Before publishing, start a fresh public repo from the code (this repo's early history
contains the original `topics/`), add a LICENSE, and check `bin/learn demo --empty` gives a good
first run: the "What do you want to learn?" screen.
