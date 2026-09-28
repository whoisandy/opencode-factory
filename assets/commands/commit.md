---
description: Stage intended paths, run checks, and create one commit with a Conventional Commits message derived from the actual change set. Only runs on explicit invocation; never pushes or amends.
agent: foreman
---

Create a commit for the current work:

$ARGUMENTS

Follow this procedure exactly:

1. **Inspect** — `git status`, `git diff`, `git diff --cached`, and `git log --oneline -20`. Read recent history to learn the repository's conventions and the scope vocabulary it already uses.
2. **Scope** — Stage only the paths that belong to this change; leave unrelated modifications alone. If the tree mixes concerns, split into separate commits when each set stands alone, or stop and ask how to split them.
3. **Check** — Run the project's lint, typecheck, and relevant tests. If a check fails, do not commit; report the failure.
4. **Message** — Default to [Conventional Commits](https://www.conventionalcommits.org/), derived from what the diff actually changes:
   - Header: `<type>(<scope>): <description>` — imperative mood, lower case, no trailing period, 72 characters or fewer.
   - Types: `feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `build`, `ci`, `chore`, `revert`. Choose the type from the dominant intent of the diff, not the largest file.
   - Scope: the affected area — package, module, or directory name (for example `installer`, `commands`, `skills`). Omit the parentheses only when no meaningful scope exists.
   - Breaking changes: add `!` after the type or scope and a `BREAKING CHANGE:` footer explaining the migration.
   - Body (optional): short why-focused bullets when the diff is not self-explanatory. Never restate the file list.
   - When the arguments include an explicit message, use it verbatim. When the repository's history clearly follows a different convention, follow the repository and say so.
   - Never add tool attribution footers, and never claim checks ran when they did not.
5. **Commit** — Create exactly one commit containing the staged paths.
6. **Verify** — Show `git show --stat` and confirm the tree is in the expected state.

Never `git push`, never force-push, never amend an existing commit. If nothing is staged or the change set is empty, say so instead of creating an empty commit.
