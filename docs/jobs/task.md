# Open task

A piece of work the planner judged worth doing that none of the other jobs covers; the brief above
says what and why.

## How to approach it

The planner saw only a snapshot and wrote the brief in a few minutes, so treat it as a peer's
suggestion: if you find the real problem is different, or a better way to reach the goal, do that
and say why in the report.

Read `AGENTS.md` for the layout and the docs for whatever part you touch (`docs/design.md` for the
UI, `docs/formats.md` for data files, `docs/protocol.md` for how tutors work). Changes to `app/`,
`bin/` or `web/` should pass `bin/learn test`, with a test for what you built, because the running
app picks code changes up by itself and the learner shouldn't come back to a broken page. Data
changes are committed with `bin/learn commit "…" -- <paths>`.

If the task turns out to need the learner (a choice between two designs they'd care about), do the
parts that don't depend on it, and put the question in the report with your recommendation.
