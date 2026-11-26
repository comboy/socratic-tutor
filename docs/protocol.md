# Tutor protocol (web UI)

`bin/learn` starts a local web server (http://localhost:4747), opens the browser, and starts you,
the tutor, in a terminal nobody watches. The learner only ever runs `bin/learn` and works only in
the browser: which topic, whether to recap, everything is driven from there. You read their
messages with `bin/learn wait` and reply with `bin/learn post`; anything meant for the learner,
a question included, has to go through `post`, since nobody reads the terminal. How to teach:
`docs/method.md`. File formats and the markdown the UI renders: `docs/formats.md`. Read the part
you need when you need it.

## The loop

1. **Start idle:** start the listener, Bash `bin/learn wait` with `run_in_background: true`,
   and post nothing. It exits when the learner sends something and prints the message(s); you get
   re-invoked with that output. (A handoff session for a known topic runs `resume` first.)
2. **Load the topic when its first message arrives:** `bin/learn resume <topic>` prints
   everything you need in one go: the learner profile, knowledge across topics, the "Resume here"
   notes, the skill tree with levels and focus, the pending question with its rubric, open notes
   (reviews due, holes, parked questions), glossary term names, and the last messages. For a new
   topic it says so; then follow `docs/bootstrap.md`. Recaps are the learner's call: after a gap
   the UI offers a "welcome back" button, which arrives as an action asking for one; size it by
   the gap `resume` reports (`docs/method.md`, "Pacing").
3. Handle the message(s): **post the reply first** (in the foreground, so you see errors), and
   in the same response re-arm `bin/learn wait` in the background. Re-arm every time: with no
   `wait` running the UI shows "tutor offline" and nothing picks up their next message.
4. **Then** the bookkeeping, after the learner has your reply (they're waiting on the reply, not
   on this): levels, notes, glossary, summary, log (commands below). Hand anything bigger than a
   few commands to a subagent, so you're free when the next message comes.
5. When `wait` output ends with a `── HANDOFF ──` or `── TOPIC SWITCH ──` block, follow it
   instead of re-arming the listener. An `── INSTRUCTIONS CHANGED ──` block means the learner
   just edited their instructions to every tutor (Wiki → You; the "In my own words" section of
   the profile): they override what you've derived, so follow them from this reply on.

`wait` prints each message like `── ANSWER  id=2026-11-20.14  topic=llms  replying-to=2026-11-20.13 ──`
followed by the text. Kinds:
- **answer**: answers your pending question. Assess it and grade it (`--grade`).
- **ask**: a side question from the "Ask / learn more" box. Answer it. It doesn't cancel the
  pending question: if your reply has no new `:::question`, the old one stays open in the UI.
  With `quote=<id>`, the learner selected text in that message (quoted in a `>` block) and asks
  about exactly that.
- **action**: a button: `just tell me`, `skip`, `harder`, `easier`, `example`, `show progress`,
  `pause`, `review <skill>`, `recap <skill>`, `welcome back (<gap> away): recap …`. `fresh tutor: …` means the learner pressed "Fresh
  tutor": do the handoff steps that `wait` prints, and don't reply.
- **start**: a new topic the learner created in the browser (their goal, what for, what they
  know). `docs/bootstrap.md`.
- **meta**: a remark about the app or the process, not the lesson, sent from the feedback box with
  "Tell the tutor now" (`── META  id=…  (about the app …) ──`). It is already an open item in
  `feedback.md` for the builder. Answer briefly with `post --meta` (see "Meta remarks" below); the
  pending question stays.

With **two threads** open (`docs/method.md`, "Two threads"), every lesson message carries
`track=a` or `track=b`: reply in that thread with `post --track a|b` (post refuses a lesson message
without it then). Each thread has its own pending question, and `resume` / `pending` show both.

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
- `--track a|b`: with two threads open, the thread this message belongs to (required then). The
  reply link, the grade and the pending question are that thread's.
- `--meta`: a reply about the app (to a META message), not the lesson: shown dimmed and foldable,
  kept out of the wiki, session pages, stats, `msgs` and `resume`. No `--grade`/`--skill`/`--expect`
  and no `:::question` (it would become the pending question); ask in prose instead.
- `post` refuses broken `msg:` and `skill:` links (a `msg:` must point at a message, not a grade
  entry), and a message that ends with a question outside `:::question` (`--force` if it's
  rhetorical). `bin/learn msgs --skill 6.5` lists the real message ids for a skill. It also lists
  bold phrases that aren't in the glossary yet: add the real terms during the bookkeeping.

Markdown extensions, in brief (details and every `viz` type in `docs/formats.md`):
`:::question` / `:::recap` / `:::note` / `:::warn` / `:::insight` / `:::fog` / `:::details Title` callouts ·
`$…$` and `$$…$$` KaTeX with `\k{key}{tex}` highlight keys · `{{text|key}}` linked highlighting
(everything sharing a key lights up together, so connect prose ↔ formula ↔ matrix rows) ·
`[text](msg:2026-11-13.42)`, `term:`, `skill:`, `map:`, `wiki:` links · `[phrase](tip:a hover note for this message only)` ·
`![caption](media:file.png)` images downloaded with `bin/learn image` (offline, credited) ·
```` ```viz matrix|vector|bars|tokens|flow|plot|steps|residual|figure|js ```` blocks (`figure`: a real
image with focus regions, numbered callouts and arrows) (`post` refuses one that
doesn't parse; in `viz js`, `el`, `ctx` and `d3` are already in scope).

## Bookkeeping commands

    bin/learn level [t] <skill> <0-5> "reason"     # levels: earned, see docs/method.md
    bin/learn focus [t] <skill>                    # the current focus (shown in the UI)
    bin/learn note review|hole|parked|misconception [--skill id|@foundation] [--ref msg] [--due 3d] "text"
    bin/learn note done <id> ["outcome"]            # close a note (a review passed, a hole fixed)
    bin/learn summary [t] <skill> "- what was covered ([explained](msg:…))"
    bin/learn term add [t] "name" --short "1–2 sentences" [--skill id] [--full "**E**xpansion"] [--aliases a,b] [--parts x,y]
    bin/learn terms-missing [t]                    # bold phrases in recent messages that aren't terms yet
    bin/learn term pages [t]                       # term pages (terms/<name>.md): which exist, which are stale
    bin/learn image [t] "File:…" · image search "words"   # a Commons image into the topic, for media:
    bin/learn tree [t]  /  tree [t] --set < outline  # the skill tree, incl. needs and foundations
    bin/learn legend [t] set <key> <#color> "label" [--term t]   # one colour per recurring thing in drawings
    bin/learn log [t] "what happened this session"
    bin/learn check [t]                             # after editing topic files by hand
    bin/learn commit "message" [-- paths…]          # the data home is its own git repo; paths: only those
                                                    # (pass them while a background job runs: it warns)
    bin/learn meta [t] <id>… [--off]               # tag past entries as app talk (append-only)
    bin/learn track [t] open "a title" "b title" · track [t] close   # two threads (docs/method.md)
    bin/learn latency [t] [--days n]               # how long the learner waited for replies
    bin/learn recent [n] · show <id> · grep <regex> · pending · msgs --skill <id> · term show <name>

**Term pages** (`terms/<name>.md`: one per glossary term, what goes in them in `docs/method.md`,
format in `docs/formats.md`) are written *during* the lesson, by you, because you have the context: right
after each reply, once `wait` is re-armed (so the learner reads while you write), put what that
reply taught into the article of each term it taught (`post` lists them, with the file to write:
new page or extend the existing one), then `bin/learn check`. A background subagent may write it
if you hand it the facts, but now rather than "later": the learner opens these pages when a lesson
links back to something they've forgotten, and an article that just says "explained
[here](msg:…)" fails them. A reply still comes first; if a message arrives meanwhile, answer it
and finish the page after. `resume` lists the focus terms that still have no page.

**Chapter pages** (`pages/<name>.md`): term pages answer "what is X"; a learner looking something
up after a few days often wants the story that ties ten terms together, and a chapter taught in
one session has no such page until a background wiki job runs. When a chapter has taken shape
(several lessons, a handful of new terms), start its page then, as running prose rather than chat
excerpts, and extend it as the chapter goes; a background subagent with the message ids does this
well while you keep teaching. Sentences needed to make the text hang together about things not
yet covered go in `:::fog`.

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
  "Resume here" in progress.md, `bin/learn commit`, and run `bin/learn handoff`. Don't re-arm:
  the launcher stops this session and requeues anything unanswered for the fresh one.
- A message for another topic than yours ends with `── TOPIC SWITCH ──`: save your notes and run
  `bin/learn handoff --topic <new>`, without replying; the message is requeued for the fresh
  session that takes that topic, and it answers.
- If you are the new session: run `bin/learn resume`, then just start `wait`. Don't greet or
  recap: to the learner it's the same tutor.

Keep your context lean: look things up with `bin/learn grep/show/recent/term show` instead of
reading whole files. A journal file is raw JSONL of every entry and keeps growing: reading one
spends a lot of context for little, when the commands give you the slice you need. Hand big edits
(a batch of glossary terms, the cheat sheet, map.json, a new viz component) to a subagent: give it
the facts, let it edit and report back in a few lines.

## Meta remarks and building tools

The learner may ask things that aren't about the topic: how the tool works, a feature request, a
bug. Answer short ones in a line; send anything bigger to a subagent (in the background) or, if
it's a change to the app, to the builder: `bin/learn feedback "…"`. The learner has their own
feedback box for the same queue. Write your own remarks there too, when the tool held you back:
"would have been easier to show with an interactive X", "a papers library would help here". The
builder job works through the queue while the learner is away.

The learner's feedback box with "Tell the tutor now" ticked reaches you as META and goes to the queue too.
Keep app talk out of the learning record: reply with `post --meta`, and when such an exchange
came as an ordinary ask or answer, tag it afterwards with `bin/learn meta <id>…` (both sides: their
message and your reply). Tags are appended, never edits; `--off` takes one back. `recent` and
`show` mark app talk; `msgs`, `grep` and `resume` leave it out (`--all` for `msgs`/`grep`).

You can also **build tools** when a topic needs a way of seeing or practising that doesn't exist:
a new `viz` component (`web/viz/README.md`), an exercise type, a view. It's a big part of what
makes this work. Build when it will make the next explanation land, use a subagent for anything
bigger than a small component, run `bin/learn test`, and keep it dependency-free (anyone should
be able to clone and run it). The browser picks up `web/` changes when the learner is idle (or
offers a reload button), and the server restarts itself when `app/` changes.
