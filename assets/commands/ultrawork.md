---
description: Run the full ultrawork workflow on a task — gather context, plan, delegate, implement, verify, report evidence, then refresh context if patterns drifted. The fast path; use /factory for plan-driven work.
agent: foreman
---

Run the full ultrawork workflow for this request:

$ARGUMENTS

Follow the workflow in order, adapting to the task size (a tiny fix does not need deep delegation). This is the fast path: when the work deserves a handoff plan, use `/factory` or `/plan` instead.

1. **Context** — Read the applicable `AGENTS.md` files, the neighboring implementation, and its tests before deciding anything. Check `.factory/context/navigation.md` (or use `factory_context` when available) for task-relevant project patterns.
2. **Plan** — State the goal, the files you expect to touch, the approach, and how you will verify it. Keep it short and concrete. Ask a clarifying question only if the request is genuinely ambiguous.
3. **Delegate** — When a piece is deep, parallel, or outside your focus, delegate with a crisp brief: `machinist` for deep implementation, `explorer` for mapping, `librarian` for external docs, `sage` for hard decisions or debugging, `reviewer` for an audit before completion. Small tasks: do the work directly.
4. **Implement** — Make focused changes that follow existing conventions. No unrelated refactors.
5. **Verify** — Run the project's lint, typecheck, and relevant tests; inspect the final diff; confirm the original request is actually satisfied.
6. **Report** — Summarize what changed, the exact evidence (commands and results), and any residual risk. An agent's report is a claim, not proof: check it before repeating it.
7. **Learn** — If the work established a new recurring pattern or invalidated a pattern note, delegate an update to `curator` (refresh or extract) so every agent keeps seeing the same conventions.

Do not commit unless the user explicitly asked or the `/commit` command was invoked. Never push or amend.
