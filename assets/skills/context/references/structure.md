# Context structure

## Layout

```
<project>/
└── .factory/
    ├── context/
    │   ├── navigation.md          # the only entry point; short index of links
    │   └── patterns/              # pattern notes, one topic per file
    │       ├── error-handling.md
    │       └── testing.md
    └── plans/                     # handoff plans (see the improve skill)
        ├── README.md
        └── 001-example.md
```

Subdirectories under `patterns/` (`guides/`, `examples/`, `lookup/`) are allowed when a topic area grows; link them from navigation directly.

## navigation.md format

- One markdown link per line: `- [Build and test](patterns/build.md) — how CI builds, tests, and lints.`
- Links are relative to `.factory/context/`. Absolute paths, external URLs, `~` paths, and traversal are rejected by the reader and reported as unavailable rather than followed.
- HTML comments (`<!-- ... -->`) are ignored by the tool, so commented-out examples are safe.
- Keep the index curated: if a note no longer reflects the code, fix or remove its line in the same session.
- Do not link plans from the context index; plans have their own index at `.factory/plans/README.md`.

## Rules

- `AGENTS.md` remains the always-on rules file; the context record is for conventions with evidence and scope, not for rules that must load on every request.
- The installer seeds `navigation.md` once and never overwrites an existing index; notes are owned by the project and the curator.
- The reader resolves links relative to `.factory/context/`, verifies each file exists, ranks matches by relevance to the query, and surfaces missing or rejected references honestly instead of guessing.
- Keep the record inside the project's version control so pattern changes are reviewable diffs.
- `.factory/` is a dot-directory: some search and glob tools skip it. Read and write context files through explicit paths, and list the directory explicitly when validating references.
