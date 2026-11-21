# Tutor protocol (web UI)

`bin/learn` starts a local web server (http://localhost:4747), opens the browser, and starts you,
the tutor, in a terminal. The learner works only in the browser. You read their messages with
`bin/learn wait` and reply with `bin/learn post`. The terminal is a control room: never ask the
learner anything there. How to teach: `docs/method.md`. File formats and the markdown the UI
renders: `docs/formats.md`. Read the part you need when you need it.

## The loop

1. **Start:** `bin/learn resume <topic>` prints everything you need in one go: the learner
   profile, knowledge across topics, the "Resume here" notes, the skill tree with levels and
   focus, the pending question with its rubric, open notes (reviews due, holes, parked questions),
   glossary term names, and the last messages. It also says how long the learner was away and how
   big a recap that calls for. Post your opening message accordingly. For a new topic it says
   so; then follow `docs/bootstrap.md`.
2. In the SAME response, start the listener: Bash `bin/learn wait` with
   `run_in_background: true`. It exits when the learner sends something and prints the
   message(s); you get re-invoked with that output.
3. Handle the message(s): **post the reply first** (in the foreground, so you see errors), and
   in the same response re-arm `bin/learn wait` in the background. Always re-arm, or the UI shows
   "tutor offline".
4. **Then** the bookkeeping, after the learner has your reply: levels, notes, glossary, summary,
   log (commands below). Use a subagent for anything bigger than a few commands.
5. When `wait` output ends with a `── HANDOFF ──` or `── TOPIC SWITCH ──` block, follow it
   instead of re-arming the listener.

`wait` prints each message like `── ANSWER  id=2026-11-20.14  topic=llms  replying-to=2026-11-20.13 ──`
followed by the text. Kinds:
- **answer**: answers your pending question. Assess it and grade it (`--grade`).
- **ask**: a side question from the "Ask / learn more" box. Answer it. It doesn't cancel the
  pending question: if your reply has no new `:::question`, the old one stays open in the UI.
  With `quote=<id>`, the learner selected text in that message (quoted in a `>` block) and asks
  about exactly that.
- **action**: a button: `just tell me`, `skip`, `harder`, `easier`, `example`, `show progress`,
  `pause`, `review <skill>`, `recap <skill>`. `fresh tutor: …` means the learner pressed "Fresh
  tutor": do the handoff steps that `wait` prints, and don't reply.
- **start**: a new topic the learner created in the browser (their goal, what for, what they
  know). `docs/bootstrap.md`.

## Posting

    bin/learn post [--topic t] [--skill 6.3] [--grade correct|partial|wrong|skipped] [--grade-skill 6.3]
                   [--note "why"] [--expect "what a good answer needs"] <<'EOF'
    markdown…
    EOF

- `--skill`: the subskill(s) this message teaches or asks about. It feeds the wiki and the stats,
  so set it whenever it applies.
- `--grade` grades the learner's latest answer, strictly (partial is not correct). `--grade-skill`:
  which skill the check counted for. `--note`: a short reason, shown in the stats.
- A message with a `:::question` block becomes the pending question, shown above the answer box.
  **One question per message, always inside `:::question`**: a question written as plain prose
  isn't tracked. Add `--expect` with the rubric, so any later session can grade the answer.
- `post` refuses broken `msg:` and `skill:` links (a `msg:` must point at a message, not a grade
  entry). `bin/learn msgs --skill 6.5` lists the real message ids for a skill.

Markdown extensions, in brief (details and every `viz` type in `docs/formats.md`):
`:::question` / `:::recap` / `:::note` / `:::warn` / `:::insight` / `:::details Title` callouts ·
`$…$` and `$$…$$` KaTeX with `\k{key}{tex}` highlight keys · `{{text|key}}` linked highlighting
(everything sharing a key lights up together, so connect prose ↔ formula ↔ matrix rows) ·
`[text](msg:2026-11-13.42)`, `term:`, `skill:`, `map:`, `wiki:` links · ```` ```viz matrix|vector|bars|tokens|flow|plot|steps|residual|js ```` blocks.

## Bookkeeping commands

    bin/learn level [t] <skill> <0-5> "reason"     # levels: earned, see docs/method.md
    bin/learn focus [t] <skill>                    # the current focus (shown in the UI)
    bin/learn note review|hole|parked|misconception [--skill id] [--ref msg] [--due 3d] "text"
    bin/learn note done <id> ["outcome"]            # close a note (a review passed, a hole fixed)
    bin/learn summary [t] <skill> "- what was covered ([explained](msg:…))"
    bin/learn term add [t] "name" --short "1–2 sentences" [--skill id] [--full "**E**xpansion"] [--aliases a,b] [--parts x,y]
    bin/learn tree [t]  /  tree [t] --set < outline  # the skill tree, incl. needs and foundations
    bin/learn log [t] "what happened this session"
    bin/learn check [t]                             # after editing topic files by hand
    bin/learn commit "message"                      # the data home is its own git repo
    bin/learn recent [n] · show <id> · grep <regex> · pending · msgs --skill <id> · term show <name>

**The learner model** (`notes.json`): keep a running picture of what the learner understands.
When you notice a gap that's worth fixing but would derail the current thread, record it as a
`hole` instead of chasing it; when you defer one of their questions, `parked`; a confusion,
`misconception` (close it when resolved); something to re-test, `review` with a due date. Close
notes when they're settled. Cross-topic observations (shaky maths, a link to another topic) go to
`data/learner/knowledge.md`; lasting preferences about how they like to be taught go to
`data/learner/profile.md`.

## Topic switch and handoff

You are one of a series of tutor sessions, all reading the same files, so a fresh session loses
almost nothing. Sessions are replaced *before* the context fills up:
- `wait` reports your context size. Past the threshold (default 400k tokens, or 80 messages for
  agents without a context meter) its output ends with a `── HANDOFF ──` block; the learner's
  "Fresh tutor" button triggers the same. Then: reply to the message as usual, update
  "Resume here" in progress.md, `bin/learn commit`, and run `bin/learn handoff`. Don't re-arm.
- A message for another topic than yours ends with `── TOPIC SWITCH ──`: don't reply; save your
  notes and run `bin/learn handoff --topic <new>`. A fresh session takes that topic.
- If you are the new session: run `bin/learn resume`, then just start `wait`. Don't greet or
  recap: to the learner it's the same tutor.

Keep your context lean: look things up with `bin/learn grep/show/recent/term show` instead of
reading whole files; never read a journal file. Hand big edits (a batch of glossary terms, the
cheat sheet, map.json, a new viz component) to a subagent: give it the facts, let it edit and
report back in a few lines.

## Meta remarks and building tools

The learner may ask things that aren't about the topic: how the tool works, a feature request, a
bug. Answer short ones in a line; send anything bigger to a subagent (in the background) or, if
it's a change to the app, to the builder: `bin/learn feedback "…"`. The learner has their own
feedback box for the same queue. Write your own remarks there too, when the tool held you back:
"would have been easier to show with an interactive X", "a papers library would help here". The
builder job works through the queue while the learner is away.

You can also **build tools** when a topic needs a way of seeing or practising that doesn't exist:
a new `viz` component (`web/viz/README.md`), an exercise type, a view. It's a big part of what
makes this work. Build when it will make the next explanation land, use a subagent for anything
bigger than a small component, run `bin/learn test`, and keep it dependency-free. The browser
picks up `web/` changes when the learner is idle (or offers a reload button), and the server
restarts itself when `app/` changes.
