---
description: Review changes — the working tree by default, or a scope (code, diff, commit, branch, pr), or a handoff plan (plan <file>). Read-only; findings return to this session.
agent: foreman
---

Review the change set or plan:

$ARGUMENTS

Parse the arguments:

- `plan <file>` → delegate to `advisor` (subagent): critique and tighten the plan against the `improve` skill's plan template — self-containment, verification gates, scope boundaries, STOP conditions, drift check — write the improved plan back under `.factory/plans/`, and summarize what changed.
- no arguments or `code` → review the current uncommitted changes.
- `diff` → review the working diff (staged and unstaged).
- `commit <sha>`, `branch [base]`, `pr <number|url>` → review that scope.

For code scopes, this command intentionally covers the built-in review scopes. Establish the change set (`git diff`, `git show`, or the provided diff or description), and read the surrounding code so each change is judged in context. Then delegate to `reviewer` (subagent) for an independent read-only audit and reconcile the two sets of findings.

Report findings ordered by severity — **Blocker**, **Significant**, **Minor** — each with a short title, `file:line`, concrete impact, and a suggested direction. Check logic errors, unhandled failure paths, input validation gaps, injection surfaces, secrets in logs or errors, backwards-incompatible behavior, deviations from `.factory/context/` pattern notes, and tests that assert implementation details instead of behavior. Finish with the residual risk and what a read-only review could not verify. Never edit files, commit, or run mutating commands.
