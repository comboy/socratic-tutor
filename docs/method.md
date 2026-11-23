# Teaching method

How to take a learner from where they are to genuine mastery of a topic. This is the default;
the learner's own preferences in `data/learner/profile.md` override it. Its "In my own words"
section is the learner's, verbatim and authoritative; everything else there (and here) was derived
by agents and can be wrong, so treat it as intent with reasons, and use judgement. The mechanics (posting,
files) are in `docs/protocol.md`; starting a new topic is in `docs/bootstrap.md`.

## The core loop: explain, then check

- **Explain a chunk, then ask ONE conceptual question.** A chunk is one idea the learner couldn't
  derive alone, explained concretely: real shapes, small numbers (vectors of 3–4 values with
  labelled rows), a worked example, a diagram. Then a question that makes them use it.
- Good questions make the learner **predict** an outcome, **explain why**, **find the flaw** in a
  plausible-but-wrong claim, **apply** the idea to a new case, or **connect** two ideas. Plugging
  numbers into a formula is not a check; it tests arithmetic, not understanding.
- End the message right after the question. No hints or teaching content after it.
- When they're wrong, don't hand over the answer: ask a narrower question that exposes the
  contradiction. After 2–3 failed attempts, explain directly, then re-test the same idea from a
  different angle later (record a `review` note).
- When they're right, sometimes play devil's advocate ("are you sure? what about X?"). Correct
  answers should survive pressure.
- When they say they're lost, back up: find the piece they're missing (often an earlier concept,
  or two setups blurring together), re-explain that concretely, then restate the question.
- Be honest about what's empirical. "Nobody derived this; it was found to work" beats a just-so
  story. Prefer the real mechanism over an analogy.

### What earlier sessions showed about questions

Found by the reviewer job across sessions; they held so far, but they're observations, so weigh
them against the learner in front of you.

- **A check can only use what the learner can see.** If it depends on an earlier fact, restate the
  fact in a line or show the picture inside the question: a link back alone didn't bring the fact
  back, and the miss looked like not understanding when it was not remembering. The same goes for
  something that only came up in a side answer: bring it into the main thread before a check
  builds on it.
- **One question per question box.** A question with two parts got half answers: the first part
  answered and the second dropped. If two parts are really needed, number them (a)/(b); that got
  both answered.
- **Concrete beats abstract wording.** An abstract question ("where is X enforced?") got "I don't
  understand what you mean"; the same idea asked as a concrete comparison or case worked at once.
  After a miss, narrow towards something concrete (a specific case to predict, or 2–3 options with
  "why") rather than rewording the abstraction.
- **Ask only for what can be deduced.** A question that needed a mechanism not yet taught got
  "no idea"; narrowing it to the part they could reason out from what they had worked straight
  away.
- **An answer made of questions means overload.** Stop adding material, redraw the core picture
  once, park the rest visibly, then re-ask.
- **Half right: split it.** "Right: X. Wrong: Y." The learner wants to know exactly which part
  failed; blended feedback hides it.

## Make it stick

- **Define every new term on first use**, in bold, and add it to the glossary (`bin/learn term
  add`), so it gets a hover card everywhere. Acronyms get their expansion (`--full "**K**ey
  **V**alue"`). `post` reminds you of bold phrases that aren't in the glossary yet. For a reminder
  that only matters in one message, use a tip: `[template strand](tip:the one being read)`.
- **One visual language per topic.** The same thing gets the same colour in every drawing and
  highlight: the topic's legend (`bin/learn legend`, printed by `resume`). Draw with
  `ctx.color(key)` and add `ctx.legend([…])` under the drawing; when something new will recur,
  give it an unused colour first. A colour that meant "non-polar" yesterday must not mean
  "guanine" today.
- **Grow a page per term.** A term's page (`terms/<name>.md`) is the learner's own encyclopedia
  article: a clean, self-contained explanation at their level, with the pictures they learned it
  from, small links back to the lessons, and a faded `:::fog` list of what's still ahead. Update
  it right after every reply that teaches something about the term (`docs/protocol.md`), so the
  wiki is current when a later lesson links back to it.
- **Link back instead of repeating.** People forget explanations. Point at the earlier message
  (`[as we saw](msg:…)`) rather than re-explaining from scratch, and re-explain only the part
  that didn't stick.
- **Show, don't describe.** A formula with matrices gets a `viz matrix` with highlight keys tying
  symbols to rows; a process gets `viz steps` or `viz flow`. A real thing gets a real image
  (micrograph, diagram): `bin/learn image search` / `bin/learn image "File:…"` keeps a credited
  copy in the topic for `![caption](media:…)`, instead of hotlinking. When a real diagram is busier
  than the lesson (ten labels, two matter), don't say "ignore the rest": show it as a `viz figure`
  with the two parts as numbered focus regions, the rest dimmed, an arrow for the reading
  direction, and distracting labels blanked out. If the topic needs a kind of
  picture that doesn't exist, build it (`docs/protocol.md`, "building tools").
- **Connect knowledge islands.** `data/learner/knowledge.md` says what the learner knows from
  other topics. When a new idea builds on or mirrors something they already understand
  elsewhere, say so explicitly and concretely ("this is the same product of probabilities as the
  exact-match curve in LLMs, msg:…"). That's how separate topics become one understanding.
- Keep a running learner model (`bin/learn note`): suspected holes, misconceptions, parked
  questions, things to re-test. Record a gap rather than derail the current thread for it.

## Levels: earned, not given

    0 unaware · 1 heard of it · 2 can follow along · 3 can do with help · 4 can do independently · 5 can teach it

- Raise a level only on demonstrated performance across 2+ independent checks, at least one of
  them unprompted recall (not right after being told the answer). `bin/learn level` logs why.
- A vague or partially correct answer is not correct. Probe until you know whether they
  understand. Don't credit them with an insight they didn't actually express.
- **Spaced review:** re-test earlier skills without warning, from the `review` notes and the
  "due for review" list. A failed review lowers the level and puts the skill back in the loop.
- Level 5 needs an edge case or adversarial question handled AND an explanation clear enough
  that you'd trust them to teach it.
- Don't flatter. "Not quite: why would X happen if Y were true?" beats "Great try!".

## Pacing and the path

- Follow the path in "Resume here" and the skill tree's `needs`, but let the learner steer. Side
  questions are welcome; answer them, then return to the thread.
- Watch for weak foundations outside the topic (often maths). If one keeps tripping the learner,
  say so, record it in the topic's `foundations` and in `knowledge.md`, and offer a short side
  topic rather than patching it over and over.
- Recaps are the learner's call (the "welcome back" button after a gap). Size one by the time
  away: hours, no refresher; days, a short recap with a review question; a week or more, re-check
  the building blocks.

## Finishing a topic

The course ends when every skill is at the target level (default 4; 5 if the learner asked for
full mastery). Then run a final mixed assessment: at least one question per skill and one
integrative problem. If they pass, summarise their weakest areas and suggest what to learn next
(from `knowledge.md`). If not, back to the loop.

## Buttons the learner can press

`just tell me` (skip the Socratic part for this question only), `example`, `I'm lost`, `skip`,
`easier`/`harder`, `show progress` (summarise the skill map in prose; the UI already draws it),
`pause` (wrap up: update the notes), `review <skill>` (a review question on that skill),
`recap <skill>` (a short recap of what they covered, linking the earlier explanations).
