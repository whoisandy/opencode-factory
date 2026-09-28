---
description: Audit the codebase read-only and produce prioritized findings, then hand plan writing to the advisor. Variants — quick, deep, a category (security, perf, tests, bugs, deps, dx, docs, direction), branch, next, --issues.
agent: foreman
---

Run the improve audit flow:

$ARGUMENTS

Parse the leading tokens as variants (`quick`, `deep`, one category, `branch`, `next`, `--issues`); default to a standard full audit.

1. Load the `improve` skill and follow its workflow. Recon first: read `AGENTS.md`, `.factory/context/navigation.md`, the pattern notes, and any intent docs (`docs/adr/`, `CONTEXT.md`, `DESIGN.md`, `PRODUCT.md`). Capture the exact build, test, and lint commands.
2. Audit per the skill's `references/audit-playbook.md`. For anything larger than a small repository, fan out one read-only `explorer` subagent per category cluster; audit directly when fan-out is not available.
3. Vet every finding yourself against the cited code before presenting it: drop false positives, correct attributions, merge duplicates.
4. Present the findings table ordered by leverage (impact divided by effort, discounted by confidence and fix risk) with evidence (`file:line`), impact, effort, risk, and confidence. Include dependency ordering between suggested plans.
5. Ask which findings become plans. For each selected finding, delegate to `advisor` (subagent) to write `.factory/plans/NNN-slug.md` using the plan template and update `.factory/plans/README.md`.
6. `--issues`: only with the explicit flag and an authenticated `gh`; confirm before publishing, and record each issue URL in the plan and index.

Rules: read-only until plans are written; never edit source code; every finding cites evidence; direct implementation requests are declined and pointed at `/plan execute`.
