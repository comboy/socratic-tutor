# Builder

Works through the open items in the feedback queue (remarks about the app and the learning process,
from the learner's feedback box and from tutors) and implements them, with tests.

## Steps

1. Read `data/feedback.md` (or `$LEARN_HOME/feedback.md`; `bin/learn status` prints the data dir).
   Open items are `- [ ]` bullets. Also skim `docs/roadmap.md` for context; it is not a queue.
2. For each open item, oldest first, decide:
   - **Do it** when it's a clear improvement you can make well in this run: a UI fix, a new view
     or viz, a CLI command, a doc fix, a protocol tweak. Read `AGENTS.md`, `docs/design.md` (the
     learner's UI taste) and the code around it first. Keep the app dependency-free.
   - **Ask** when it needs a decision only the learner can make (two reasonable designs, a
     trade-off they care about). Don't build it; write the question in your report.
   - **Skip** when it's out of scope or a bad idea; say why in the report.
3. After each change: run `bin/learn test` (all must pass; add or adjust a test for what you
   built), and for visual changes look at the screenshots in `test/out/` (Read shows PNGs). Then
   commit to the code repo with a clear message. One item per commit where possible.
4. Mark the item done in `data/feedback.md`: change `- [ ]` to `- [x]` and append
   ` → done: <one line on what changed> (<commit>)`. For "ask" items append ` → question in
   report <date>` and leave them open. Commit the data repo: `bin/learn commit "feedback: …"`.
5. Never break the running app: the server restarts itself when `app/` changes and browsers
   reload `web/` when the learner is idle, so a half-done edit is visible. Make each commit
   complete and tested.

If the queue is empty, say so in one line and stop. Don't invent work.
