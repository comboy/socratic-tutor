# Wiki writer

Turns what was taught into readable wiki pages, so the learner can re-read a whole skill (pages/)
or everything they know about one term (terms/) instead of hunting through the conversation.
Writes for the learner, from the messages that taught them.

## Steps

1. Pick up to 2 skills per topic worth a page: covered (level ≥ 2), several explanation messages
   (`bin/learn msgs --skill <id>`), and no page yet (`bin/learn resume <topic>` lists pages; a
   page covers a skill when it links `skill:<id>`). Prefer the focus area and recently taught
   skills. Skip a topic when nothing qualifies.
2. Read those messages (`bin/learn show <id>`), the skill's `summary` in topic.json, and the
   glossary terms involved (`bin/learn term show`).
3. Write `data/topics/<topic>/pages/<name>.md` (format: `docs/formats.md`, "pages"): a page the
   learner can read top to bottom in a few minutes:
   - What it is and why it matters, then the mechanism step by step with the concrete small
     numbers and shapes the tutor used (re-use their `viz` blocks and highlight keys: they're
     the learner's favourite part).
   - Link each section to the message that explained it (`[explained](msg:…)`), and to related
     skills (`skill:`), terms and pages. Keep the tutor's wording where it worked.
   - Misconceptions that came up (from notes.json / topic.json) as a short "Careful" callout.
   - What isn't covered yet, in one line (the skill's `unknown`).
   - End with a "Related skills" line of `skill:` links.
   Follow the learner's taste (data/learner/profile.md): concrete numbers over analogies, define
   terms, honest about what's empirical. Don't invent content beyond what was taught, except to
   connect it; mark anything new as such.
4. **Term pages** (`terms/<name>.md`, format in `docs/formats.md`): `bin/learn term pages <topic>`
   lists the pages that exist (and which are stale: the term was mentioned since the last update)
   and the most-mentioned terms without one. Bring up to 2 stale pages up to date, then write up to
   4 new ones for the most-mentioned terms, prioritising terms of the current focus area. For
   each: `bin/learn term show <term>` (path, current page), the messages that mention it
   (`bin/learn grep "<term>" --topic <topic>`, then `show <id>`), the learner's answers about it.
   Write what the learner knows, linked to the messages, with the lesson's own pictures; end with
   a `:::fog` list of what's not covered yet.
5. `bin/learn check <topic>` (fix every problem), then `bin/learn commit "wiki: …"`.

Report: which pages you wrote, one line each.
