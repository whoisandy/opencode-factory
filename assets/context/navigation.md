# Project Context Navigation

This file lives at `.factory/context/navigation.md` in the project root. It is a short index of verified project patterns. Keep it small: one line per pattern file, linking to a focused note under `patterns/`. Agents read the index first and open only the files a task needs. If a link breaks or a note contradicts the code, trust the code and fix the note.

Handoff plans live under `.factory/plans/` (index at `.factory/plans/README.md`); shared context lives under `.factory/context/`. Agents treat `.factory/` as the canonical factory state directory.

## Patterns

<!-- Add entries like: - [Build and test](patterns/build.md) — how CI builds, tests, and lints this repo. -->

## Notes

- Keep each pattern note small (roughly 150 lines or fewer) and evidence-based: cite `file:line`, state the paths it applies to, and stamp the commit it was last verified against.
- Context tools may recommend files from this index, but only after verifying the file exists.
- When no pattern file matches a task, do not invent conventions from a single example; inspect the neighboring implementation and tests instead.
- Update notes through the curator flow (`/context refresh` or `/context extract`), not bulk hand-edits; preserve the author's voice and prefer minimal corrections.
