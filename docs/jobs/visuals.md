# Visuals

Prepares drawings and animations for the lessons ahead, so that when the moment comes the tutor
drops a checked one in with a line instead of composing a drawing while the learner waits.

## Context

The learner asked for this (2026-11-26): visuals made days ahead, polished, in one visual
language that is itself allowed to change when a better one is found. `data/learner/profile.md`
says how this learner takes pictures (how much realism, what they dislike); a wrong drawing
costs more than a wrong sentence. `docs/visuals.md` is the whole system: where visuals live,
the file format, the scene API, how one is checked and marked ready. Read it first, then the
topic's `visuals/STYLE.md` and `visuals/_kit.js`.

## Choosing what to make

Few and good beats many. Two or three per run is plenty; one excellent one is a good run. Weigh:

- `bin/learn visuals <topic>`: what exists, and what tutors asked for (`requests.md`). A request is
  a tutor saying "I needed this and didn't have it": those come first.
- `bin/learn resume <topic>`: the path in "Resume here" and the skill tree. The focus and the two
  or three skills after it are where a visual will be used soonest.
- Reviews that keep failing and open misconceptions (the notes in `resume`): an idea missed three
  times in words is the best candidate for a picture. Read the messages where it failed
  (`bin/learn show <id>`) so the picture answers the actual confusion.
- What a picture is for: a process (animate it: steps), a quantity that depends on another (a
  slider), a structure (a real image is usually better: `media/CATALOG.md`, `bin/learn image
  search`; then no visual is needed, or a `viz figure` over the image).
- Existing visuals the learner or a tutor found wanting (feedback.md, corrections in the journal):
  improving one that is in use can beat adding one.

## Making one

One visual, one idea. A subagent per visual works well (each with the idea, the confusion it
answers, the messages that taught it, and `docs/visuals.md`); they must not edit `_kit.js` at the
same time, so collect kit changes and make them yourself.

1. Write `visuals/<name>.js` with `status: draft` and a complete header.
2. `bin/learn visuals <topic> check <name> --mid`, and look at every frame it saves, both themes.
   Fix and repeat until the checker is clean and each frame shows what its caption says.
3. A second look by a fresh agent that didn't write it: give it the frames and the file, ask what
   a learner would wrongly conclude, and have it check the facts and numbers against a source
   (the header's `sources:`). Fix what it finds.
4. `bin/learn visuals <topic> ready <name> --reviewed "…"`. If you can't get it right in this
   run, leave it a draft and say why in the report; a draft isn't shown to tutors.
5. Mark the request in `requests.md` (`- [x] … → <name>`, or `→ no: why`).

If you change the kit or STYLE.md (a better convention: do it, that's wanted), every visual's
check goes stale: `check --all`, look at all of them again, `ready` each, and say in the commit
and the report what changed in the language and why. If the learner would notice the change in
visuals they already know, say so in the report so the tutor can tell them.

Never post to the learner, never touch a live lesson. Commit: `bin/learn commit "visuals: …" --
topics/<topic>/visuals` (and code changes, if you improved `web/viz/scene.js` or the commands, in
the code repo with `bin/learn test` passing; no topic content in the code repo).

Report: what's ready now (name, skill, one line, the embed line), what's still draft and why,
what you'd make next.
