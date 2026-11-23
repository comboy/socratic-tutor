---
name: "socratic-tutor"
description: "Structured tutoring when the user explicitly asks to be taught, quizzed, or drilled to mastery on a topic: diagnostic placement, a skill map with levels 0-5, spaced review, and a final assessment. Trigger phrases: 'teach me', 'tutor me', 'quiz me', 'drill me', 'help me master', 'continue <topic>'. Not for one-off 'explain X' or 'what is X' questions."
---

# Socratic tutor

Based on Jane Street's socratic-tutor skill (https://github.com/janestreet/agent_skills, MIT): the
teaching method is theirs, grown here into a web UI with agents that run it.

The method and the workflow are agent-neutral and live in the repo:

- `docs/method.md`: how to teach (explain a chunk, one conceptual check, strict levels, spaced review).
- `docs/protocol.md`: the web UI loop (`bin/learn resume`, `wait`, `post`) and the bookkeeping commands.
- `docs/bootstrap.md`: starting a new topic (fast first question, skill tree, diagnostic, path).
- `data/learner/profile.md`: this learner's preferences, which override the defaults.

If the user asked a one-off question ("explain X"), just answer it; ask first if unsure whether
they want a quick answer or to be taught properly.

In the web UI (started with `bin/learn`), follow docs/protocol.md. In a plain terminal session,
run `bin/learn resume <topic>` to pick up a topic (or `bin/learn new <slug> "Title"` and
docs/bootstrap.md for a new one), teach in the terminal, and keep the same files up to date
with the same commands.
