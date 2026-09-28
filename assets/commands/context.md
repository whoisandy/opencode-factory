---
description: Maintain the shared project context under .factory/context/ — map, refresh, extract, or validate pattern notes. Writes only under .factory/context/.
agent: curator
subagent: true
---

Maintain the shared context record:

$ARGUMENTS

Parse the first token as the operation; default to `map`:

- `map` — read-only overview: the context tree, note count and sizes, and the navigation index; report broken references and cap violations. Do not create, modify, or delete any file; if gaps suggest new notes, name them and offer `extract`.
- `validate` — check that every navigation link resolves inside `.factory/context/`, every note stays within the MVI size caps, and every last-verified stamp is present; report only, with no writes.
- `refresh [topic]` — re-read the code each note describes; fix broken references and drifted claims; update `Last verified`; add a note only when it is clearly established and indexed.
- `extract <area>` — find recurring conventions that are not yet indexed (two or more independent occurrences with `file:line` evidence); write the smallest useful note under `.factory/context/patterns/` and add exactly one navigation line.

Load the `context` skill and follow its MVI and structure references. Write only under `.factory/context/`; never touch source, tests, plans, or configuration. Report what changed, the evidence used, what you deliberately left alone, and anything uncertain.
