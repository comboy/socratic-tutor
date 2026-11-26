# Starting a new topic

The learner creates a topic in the browser ("New topic": what they want to learn, optionally what
for and what they already know). The server scaffolds `topics/<slug>/` (empty skill tree, the goal
in `topic.json`) and queues a **START** message with their words. If your session was for
another topic, `wait` tells you to hand off; the fresh session for the new topic gets the START
message and does this. The aim: from their first sentence to a mapped topic and a placed learner
in a few minutes, without a long questionnaire.

## 1. First reply, fast (within your first response)

Run `bin/learn resume <topic>` (it shows the goal, the learner profile and their knowledge from
other topics). Before posting, sketch the whole diagnostic: 4–6 short questions spread over
the branches you expect and over **kinds of understanding**, since each kind shows something
different:
- **mechanism**: "walk me through what you think happens when …": their mental model,
  vocabulary and gaps in one answer;
- **prediction**: "what happens if … changes?": whether that model actually runs, or is a
  list of words;
- **scale**: rough sizes, numbers, speeds: a common blind spot, and quick to answer;
- **transfer**: a link to a topic they know (resume shows their knowledge): what you can build on;
- **recall** of names, sparingly: knowing the name isn't understanding.
Pitch each so they can answer part of it from what they said they know: for a topic they start
near zero, an end-to-end question gets "I don't know" and tells you little, while a question about
one piece they've half met shows where they stand. Put the list under "Resume here" in
progress.md, so a handoff mid-diagnostic keeps it.

Then open two threads and post (two threads: `docs/method.md`; the learner asked for this,
2026-11-26: the diagnostic was the one part of a topic where they still waited after every answer):
- `bin/learn track open "Where you stand: <area 1>" "Where you stand: <area 2>"`;
- in a: one or two lines acknowledging the goal in your words (so they can correct a misreading),
  that you'll ask a few questions in both threads to see where they stand, and **question 1** in a
  `:::question` block with `--expect`;
- in b: **question 2**, short and self-contained, with `--expect`. Different area, different kind.

Re-arm `wait`. Then, while they think, do step 2: the questions come before the mapping because
they're at the browser waiting, and the map can be built in the time they spend answering.

## 2. Map the topic (right after the first post)

- **Title:** if the auto-derived title is clumsy, fix `title` in topic.json (the slug stays: it's
  the folder name the files and commands use).
- **Skill tree:** 4–10 branches, each with 2–8 concrete leaf skills (a size that has worked), as
  an outline with `bin/learn tree <topic> --set` (`docs/formats.md`, "Skill dependencies"). Aim at
  the learner's goal, not a textbook's table of contents; include the modern or advanced parts
  they asked about. Add `needs` between skills, and `foundations` for outside knowledge the topic
  relies on (maths, chemistry, programming…). All levels start at 0.
- Give each leaf an `unknown` list in topic.json: what's in it that hasn't been covered (shown as
  fog on its wiki page). A subagent can do this, and the first sketch of `map.json` (the concept
  map: how the subject works, as boxes and arrows, fog until covered) and the cheat sheet
  skeleton. Run `bin/learn check` afterwards.
- `bin/learn commit "New topic: …"`.

## 3. Diagnostic: 3–5 questions

Alternating between the two threads, from easy to hard, spanning the branches. When an answer
arrives in one thread, reply there with the grade, a sentence of feedback and the next question
from your list, adjusted to everything answered so far. The list is what keeps that reply quick
enough to be ready before they come back from the other thread. Keep teaching to a sentence:
the point is to see where they stand, an explanation now colours the answers that follow, and
the misconceptions you note (`bin/learn note misconception …`) are what the teaching will be for.
Grade each answer (`--grade`, `--grade-skill`) and set initial levels with `bin/learn level` as
evidence comes in (most will be 0–2). Skip questions about branches their earlier answers
already settled. Use their knowledge from other topics (resume shows it) to skip what they
evidently know and to probe the foundations that looked shaky elsewhere.

## 4. Propose the path

When the diagnostic is done, say so in the thread you stop feeding (an empty thread reads as a
bug), then post in a a short summary: what they already know (be specific), the gaps, and the proposed order
(branch by branch, with one line of why), plus any weak foundation worth a short side topic.
Ask whether to start there or somewhere else. Set the focus (`bin/learn focus`), write "Resume
here" in progress.md, add what you learned about them to `data/learner/knowledge.md` (and to
`profile.md` if they told you how they like to learn), commit. Then start teaching
(`docs/method.md`), and give b its next job: a practice line or a sibling skill (the topic has
nothing to review yet), retitled with `bin/learn track open` (the same command updates the titles).
