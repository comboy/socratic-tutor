# Starting a new topic

The learner creates a topic in the browser ("New topic": what they want to learn, optionally what
for and what they already know). The server scaffolds `topics/<slug>/` (empty skill tree, the goal
in `topic.json`) and queues a **START** message with their words. If your session was for
another topic, `wait` tells you to hand off; the fresh session for the new topic gets the START
message and does this. The aim: from their first sentence to a mapped topic and a placed learner
in a few minutes, without a long questionnaire.

## 1. First reply, fast (within your first response)

Run `bin/learn resume <topic>` (it shows the goal, the learner profile and their knowledge from
other topics). Then post:
- one or two lines acknowledging the goal in your words (so they can correct a misreading),
- that you'll ask a few questions, one at a time, to see where they stand,
- **diagnostic question 1**, in a `:::question` block, posted with `--expect`. Make it broad and
  open: "walk me through what you think happens when …" reveals their mental model, vocabulary
  and gaps in one answer. (For LLMs, "walk me through how a model produces its first token"
  worked very well.)

Re-arm `wait`. Then, while they think, do step 2.

## 2. Map the topic (right after the first post)

- **Title:** if the auto-derived title is clumsy, fix `title` in topic.json (keep the slug).
- **Skill tree:** 4–10 branches, each with 2–8 concrete leaf skills, as an outline with
  `bin/learn tree <topic> --set` (`docs/formats.md`, "Skill dependencies"). Aim at the learner's
  goal, not a textbook's table of contents; include the modern or advanced parts they asked
  about. Add `needs` between skills, and `foundations` for outside knowledge the topic relies on
  (maths, chemistry, programming…). All levels start at 0.
- Give each leaf an `unknown` list in topic.json: what's in it that hasn't been covered (shown as
  fog on its wiki page). A subagent can do this, and the first sketch of `map.json` (the concept
  map: how the subject works, as boxes and arrows, fog until covered) and the cheat sheet
  skeleton. Run `bin/learn check` afterwards.
- `bin/learn commit "New topic: …"`.

## 3. Diagnostic: 3–5 questions

One at a time, from easy to hard, spanning the branches. Don't teach during the diagnostic beyond
a sentence of feedback; note misconceptions (`bin/learn note misconception …`). Grade each answer
(`--grade`, `--grade-skill`) and set initial levels with `bin/learn level` as evidence comes in
(most will be 0–2). Skip questions about branches their earlier answers already settled. Use
their knowledge from other topics (resume shows it) to skip what they evidently know and to probe
the foundations that looked shaky elsewhere.

## 4. Propose the path

Post a short summary: what they already know (be specific), the gaps, and the proposed order
(branch by branch, with one line of why), plus any weak foundation worth a short side topic.
Ask whether to start there or somewhere else. Set the focus (`bin/learn focus`), write "Resume
here" in progress.md, add what you learned about them to `data/learner/knowledge.md` (and to
`profile.md` if they told you how they like to learn), commit. Then start teaching
(`docs/method.md`).
