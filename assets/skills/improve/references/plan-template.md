# Handoff plan template

Every plan is written for an executor with zero context: it has not seen the advisor session, the audit, or any other conversation. Assume it can follow explicit instructions but cannot fill gaps or judge ambiguity. Three properties make a plan executable:

1. **Self-contained context** — everything needed is in the file: paths, current-state excerpts, conventions, verified commands.
2. **Verification gates** — every step ends with a command and its expected result.
3. **Hard boundaries** — explicit out-of-scope lists and STOP conditions instead of improvisation.

File naming: `.factory/plans/NNN-short-slug.md`, numbered in recommended execution order.

## Plan file format

```markdown
# Plan NNN: <imperative title — what will be true after this plan>

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If a
> STOP condition occurs, stop and report — do not improvise. When done, update
> your status row in `.factory/plans/README.md` unless a reviewer maintains it.
>
> **Drift check (run first)**: `git diff --stat <planned-at SHA>..HEAD -- <in-scope paths>`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code; on a mismatch, treat it as a
> STOP condition.

## Status

- **Priority**: P1 | P2 | P3
- **Effort**: S | M | L
- **Risk**: LOW | MED | HIGH
- **Depends on**: `.factory/plans/NNN-*.md` (or "none")
- **Category**: bug | security | perf | tests | tech-debt | migration | dx | docs | direction
- **Planned at**: commit `<short SHA>`, <YYYY-MM-DD>

## Why this matters

2–5 sentences: the problem, its concrete cost, and what improves when this lands. Intent is what lets a correct judgment call happen when a detail is off.

## Current state

Everything the executor needs, inlined — never "see the audit":

- Relevant files, each with one line on its role:
  - `src/orders/api.ts` — order-list endpoint; contains the N+1 (lines 130–160)
- Short excerpts of the code as it exists today, with `file:line` markers.
- The repo conventions that apply, with one exemplar file to match.
- Vocabulary or constraints the plan must honor, quoted from intent docs when present.

## Commands you will need

| Purpose   | Command           | Expected on success |
| --------- | ----------------- | ------------------- |
| Typecheck | `<exact command>` | exit 0, no errors   |
| Tests     | `<exact command>` | all pass            |
| Lint      | `<exact command>` | exit 0              |

Commands must be verified during recon, not guessed.

## Scope

**In scope** (the only files to modify):

- `...`

**Out of scope** (do not touch, even if related):

- `...` — reason.

## Git workflow

- Work in place on the current branch unless the user directed otherwise; do not create branches, push, or open PRs unless explicitly instructed.
- Commit per logical unit only when the caller asked for commits; match the repository's message style.
- Never amend, rebase, or force-push.

## Steps

### Step 1: <imperative title>

What to do, precisely. Name exact files and symbols; show the target shape when it is load-bearing.

**Verify**: `<command>` → <expected output>

### Step 2: ...

Steps should be small enough to verify independently and ordered so the codebase is never broken between steps.

## Test plan

- New tests: which file, which cases (happy path, the regression this fixes, named edge cases).
- Structural pattern to follow: name the existing test file to model after.
- Verification: `<test command>` → all pass, including the new tests.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `<typecheck>` exits 0
- [ ] `<tests>` exits 0; new tests exist and pass
- [ ] `<grep command for the old pattern>` returns no matches
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `.factory/plans/README.md` status row updated

## STOP conditions

Stop and report (do not improvise) if:

- The code at the cited locations does not match the excerpts (drift).
- A verification fails twice after a reasonable fix attempt.
- The fix requires touching an out-of-scope file.
- A named key assumption turns out to be false.

## Maintenance notes

For the human who owns this code after the change lands:

- What future changes interact with this work.
- What a reviewer should scrutinize.
- Follow-ups explicitly deferred, and why.
```

## Index file: `.factory/plans/README.md`

Keep numbering monotonic: read the existing index and enumerate the plan directory explicitly (`.factory/` is hidden; glob-style tools may skip it) before creating a plan file. Never create a second plan for a finding that already has one.

```markdown
# Implementation Plans

Generated <date>. Execute in the order below unless dependencies say otherwise. Executors: read the full plan before starting, honor its STOP conditions, and update your row when done.

## Execution order & status

| Plan | Title | Priority | Effort | Depends on | Status |
| ---- | ----- | -------- | ------ | ---------- | ------ |
| 001  | ...   | P1       | S      | —          | TODO   |

Status values: TODO | IN PROGRESS | DONE | BLOCKED (with one-line reason) | REJECTED (with one-line rationale)

## Dependency notes

## Findings considered and rejected

- <finding>: not worth doing because <one line>. (So it is not re-audited.)
```

## Quality bar

- A model that has never seen this repository can execute the plan with the plan file alone.
- Every verification is a command with an expected result, not a judgment.
- Every step names exact files and symbols, not "the relevant module".
- STOP conditions are specific to this plan's risks, not boilerplate.
- "Planned at" SHA is filled in and matches the drift-check paths.
- No secret values anywhere in the file.
