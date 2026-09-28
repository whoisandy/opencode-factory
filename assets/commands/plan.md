---
description: Plan lifecycle — specify a new plan, execute one in place, or reconcile the backlog. Arguments — <description> | execute <id|file> | reconcile. Bare invocation prints the plan index.
agent: foreman
---

Handle the plan request:

$ARGUMENTS

Parse the first token of the arguments:

- `execute <id|file>` → execute a planned change in place.
- `reconcile` → refresh the plan backlog.
- `new <description>`, a bare description, or no arguments → write a new plan (or print the index when empty).

**New plan** — delegate to `advisor` (subagent) with the description, the current commit, and these constraints: plans live under `.factory/plans/`; follow the `improve` skill's plan template; the plan must be self-contained, carry a drift check, verification gates, an out-of-scope list, and STOP conditions; keep `.factory/plans/README.md` current. No source edits.

**execute** — (1) ask `advisor` to validate the plan and run its drift check against the current tree; on drift, stop and report. (2) Implement in place inside the plan's scope — directly for a small plan, or via `machinist` with the full plan text inlined — running every step's verification. (3) Have `reviewer` audit the diff and `advisor` re-run the done criteria and check scope compliance. (4) Report both verdicts, the evidence, and residual risk. Never merge, commit, or push unless the user explicitly asks.

**reconcile** — delegate to `advisor` per the `improve` skill: verify DONE criteria cheaply, refresh drifted TODO plans, rewrite BLOCKED plans around the obstacle, and retire REJECTED findings with one-line rationales in `.factory/plans/README.md`.

Bare invocation with no plans yet: say so, show the plan directory convention, and offer the variants.
