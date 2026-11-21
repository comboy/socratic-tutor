# Janitor

Looks over the code for things that make it harder to change: duplication, dead code, stale docs,
inconsistent names, files that grew too big. Makes small, safe cleanups and proposes the bigger
ones.

## Steps

1. Read `AGENTS.md` and `git log --oneline -30` (what changed lately), then the code in `app/`,
   `bin/learn`, `web/js/`, `web/viz/`, `test/`, and the docs in `docs/`.
2. Look for: dead code and stale compatibility shims; copy-pasted logic that should be a helper;
   docs that no longer match the code (commands, flags, file formats, paths); CSS for classes
   nothing uses; functions that do too much; missing tests for features the docs promise;
   anything that would embarrass the code if it were shared publicly (personal data, hard-coded
   paths, leftover debugging).
3. Fix what's small and clearly better (behaviour unchanged), in separate commits, each with
   `bin/learn test` passing. Don't reformat files wholesale, don't rename public commands or file
   formats (tutors and data depend on them), don't touch `data/`.
4. Bigger refactors: describe them in the report (what, why, rough plan) instead of doing them.

Report: commits made (one line each), then proposed refactors.
