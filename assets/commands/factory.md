---
description: Default factory pipeline — context, plan or improve, execute in place, review, verify, commit on request, then refresh shared context. Pauses at every checkpoint.
agent: foreman
---

Run the default factory pipeline for this request:

$ARGUMENTS

Parse the first token of the arguments as an optional stage hint (`plan`, `improve`, `execute <id>`, `review`, `status`); with no recognized hint, run the full pipeline from the start. For an unknown hint, print the stages and ask instead of guessing.

Pipeline — pause at every checkpoint marked USER:

1. **Context** — read the applicable `AGENTS.md`, call `factory_context` (or read `.factory/context/navigation.md`), and read `.factory/plans/README.md` when it exists. State the goal in one or two sentences.
2. **Decide the path** — trivial and well understood: do the work directly and verify. Known outcome with unclear steps: spec it via the `advisor` subagent. Unknown scope or a quality sweep: run the audit flow below.
3. **Plan** (when needed) — delegate to `advisor` (subagent) to write `.factory/plans/NNN-slug.md` using the `improve` skill's plan template and to update the plan index. [USER: confirm the plan before execution]
4. **Execute** — validate the plan's scope, run its drift check, then implement in place: do it yourself for a small plan or delegate to `machinist` with the full plan inlined. Touch only in-scope paths and run every step's verification.
5. **Review** — delegate the diff to `reviewer` and the plan compliance check to `advisor`; produce APPROVE, SEND BACK (with specifics), or BLOCK.
6. **Verify** — run the project's lint, typecheck, and relevant tests; report the exact commands and results. [USER: report before commit]
7. **Commit** — only when the user explicitly asks or `/commit` is invoked. Never push or amend.
8. **Learn** — when the work established a new recurring pattern or invalidated a pattern note, delegate a context update to `curator` (refresh or extract) so every agent keeps seeing the same conventions.

Rules: no worktrees; if the repository is on its default branch, pause before editing; on any plan STOP condition, stop and report with evidence.
