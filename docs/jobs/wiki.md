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
   and the most-mentioned terms without one; `bin/learn resume <topic>` lists the focus terms
   without one. Priorities: terms the learner asked about or said they forgot (feedback.md, recent
   app talk and asks), then every focus term without a page, then stale pages, then the
   most-mentioned terms. Write up to 12 pages per run. For each: `bin/learn term show <term>`
   (path, current page), the messages that mention it (`bin/learn grep "<term>" --topic <topic>`,
   then `show <id>`), the learner's answers about it. Each page is a self-contained article
   (docs/formats.md, "An article, not an index"): the learner understands the term from it alone,
   explained in full at their level, with the lesson's own pictures and small links back to the
   lessons as references, never in place of the explanation; end with a `:::fog` list of what's
   not covered yet. Any drawing uses the topic's legend colours
   (`bin/learn legend`: `ctx.color(key)`, `ctx.legend([…])`).
5. `bin/learn check <topic>` (fix every problem), then `bin/learn commit "wiki: …" -- <the files you changed>` (e.g.
   `topics/<t>/terms topics/<t>/pages`; a tutor may be writing other files right now).

Report: which pages you wrote, one line each.
