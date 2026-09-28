# Minimal Viable Information (MVI)

The context record exists to be read by agents with limited attention. Every note earns its place by being small and true.

## Caps

- One note: roughly 150 lines maximum; target 30–60 lines.
- One rule: one line.
- One evidence entry: one `file:line` plus at most a sentence.
- The navigation index: one line per note, staying far under the reader's 64 KB index cap.

## Note anatomy

1. **Title** — the convention, not the area: "Errors are returned as Result values", not "Error handling".
2. **Applies to** — the paths or globs where the convention holds. Precision here prevents misapplication.
3. **Rules** — 3–7 imperatives an agent can follow while editing.
4. **Evidence** — 2–4 citations, each showing the convention live; prefer one exemplar file plus one variation.
5. **Last verified** — short commit SHA and date. Re-verify and update when you touch the note.

## Good versus bad

Bad: a 400-line dump of everything known about a subsystem; no citations; one file's implementation described exhaustively; three conflicting conventions mixed together.

Good: a 40-line note that states one convention, names where it applies, shows two citations, and mentions the exception if one exists.

## Writing rules

- Describe the present, not the history. "Handlers return 404 for missing rows (`api/users.ts:88`)" beats "we changed error handling in June".
- Prefer references over duplication: link the exemplar file rather than pasting large code blocks. Short inline snippets are fine when they carry the point.
- If two conventions genuinely compete, write one note that documents both, names which one new code should follow, and cites evidence of the trend.
- Update in place; do not append a new section every time something changes. Use the last-verified stamp instead of a changelog.
- No secrets, no personal data, no customer names in the record.
