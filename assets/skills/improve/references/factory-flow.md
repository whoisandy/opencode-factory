# The factory flow

`/factory` is the default pipeline: context → decision → plan (or improve) → execute → review → verify → commit on request → learn. It is deliberately explicit at every checkpoint and never runs unattended.

## Pipeline

1. **Context** — read the applicable `AGENTS.md`, call `factory_context` (or read `.factory/context/navigation.md`), and read `.factory/plans/README.md` when it exists. Never plan from memory.
2. **Decide the path** — small and well understood: do the work directly and verify. Known outcome with unclear steps: `/plan <description>`. Unknown scope or a quality sweep: `/improve`.
3. **Plan** — `advisor` writes `.factory/plans/NNN-slug.md` in the `references/plan-template.md` format, after reading the existing index explicitly (`.factory/` is hidden and some tools skip dot-directories). Plans are the contract.
4. **Execute** — `/plan execute <id>`: validate the plan and run its drift check first, then `machinist` implements in place inside the plan's scope, running each step's verification.
5. **Review** — `reviewer` checks the diff for correctness and missing tests; `advisor` re-runs the done criteria, checks scope compliance, and renders APPROVE / SEND BACK / BLOCK.
6. **Verify** — run the plan's gates yourself and report what ran and what it returned. An agent's report is a claim, not proof.
7. **Commit** — only when the user asks or `/commit` is invoked. Never push or amend.
8. **Learn** — when implementation revealed drift in a pattern note, or established a new recurring pattern, delegate the update to `curator` via `/context refresh` or `/context extract`.

## Checkpoints (pause for the user)

- Before `/improve` turns findings into plans (pick which findings).
- Before editing when the repository is on its default branch.
- Before any commit.
- On any STOP condition from a plan.

## Tweak points

| Need                         | Command                                      |
| ---------------------------- | -------------------------------------------- |
| Full default pipeline        | `/factory <task>`                            |
| Fast path, no plan files     | `/ultrawork <task>`                          |
| Audit → findings → plans     | `/improve [variant]`                         |
| Spec one thing               | `/plan <description>`                        |
| Critique or tighten a plan   | `/review plan <file>`                        |
| Execute a plan               | `/plan execute <id\|file>`                   |
| Refresh the plan backlog     | `/plan reconcile`                            |
| Review a diff, commit, or PR | `/review [scope]`                            |
| Consult on a hard decision   | `/sage <question>`                           |
| Maintain shared context      | `/context [map\|refresh\|extract\|validate]` |
| Commit explicitly            | `/commit`                                    |

## Roles

- `foreman` — coordinates, owns the request, delegates, integrates, verifies.
- `machinist` — implements deeply; never commits.
- `advisor` — audits and writes plans; reviews executor work; writes only under `.factory/plans/`.
- `curator` — maintains `.factory/context/`; writes only there.
- `explorer`, `librarian`, `reviewer`, `sage` — read-only research, external docs, audit, and consultation.

## Rules

- No worktrees, no background loops, no auto-commit, no silent merges.
- Every pattern note and every plan cites evidence; if the code and the note disagree, the code wins.
- The plugin is read-only; the agent pack and context files work with or without it.
