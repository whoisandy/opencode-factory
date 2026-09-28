# Audit playbook

What to look for, category by category. A finding without evidence is not a finding: "probably has N+1 queries somewhere" is noise; `orders/api.ts:142 issues one query per order item inside a loop` is a finding.

Adapt depth to the repository: a small CLI gets a lighter pass than a large monorepo.

## 1. Correctness and bugs

- Swallowed errors: empty catches, `catch (e) { console.log(e) }` on critical paths, missing error states in UI flows.
- Async hazards: unawaited promises, races on shared state, missing cancellation or cleanup (stale closures, unremoved listeners).
- Null and undefined flows: non-null assertions on nullable values, optional chaining masking a value that must exist, unchecked indexing.
- Boundaries: off-by-one, empty collections, timezone and locale assumptions, counters that can overflow.
- State machines: impossible states representable in types, enums with silently ignored branches.
- Concurrency: check-then-act on shared resources, missing transactions around multi-writes, non-idempotent retries.
- Type escape hatches: clustered `any`, `as`, or ignore-comment casts — each one is a place the compiler was overruled.
- Resource leaks: unclosed handles, connections, subscriptions; missing `finally`.

## 2. Security

Evidence only; frame findings as defensive maintenance. Never copy a secret value — cite the location and the credential type, and always recommend rotation, not just removal.

- Credential hygiene: hardcoded keys, `.env` files in version control, credentials in logs or event stores.
- Inputs crossing into interpreters or privileged APIs: SQL or command construction from request data, HTML sinks fed by user content, dynamic execution, filesystem paths derived from requests.
- Access control: missing server-side identity checks, authorization enforced only client-side, object access by ID without ownership checks, missing CSRF protection on state-changing routes.
- Input contracts: API bodies without schema validation, uploads without type/size/storage limits, broad mass assignment into persistence models.
- Dependency posture: run the ecosystem audit command read-only; report critical and high advisories that affect reachable runtime code.
- Production posture: over-broad CORS with credentials, cookies missing `HttpOnly`/`Secure`/`SameSite`, debug behavior enabled in production.
- Data minimization: PII in logs, stack traces or internal error details returned to clients.

By-design is not a finding: standard platform conventions and tradeoffs recorded in decision docs are settled. Flag them only when the implementation adds risk beyond the convention — and note that a stale decision doc is itself a finding.

## 3. Performance

Algorithmic and architectural wins, not micro-optimizations.

- N+1 patterns: query or fetch per item inside loops; missing batching.
- Complexity: nested scans over the same collection where a keyed lookup belongs.
- Caching gaps: repeated identical expensive work per request or render; no caching on stable data.
- Payload size: over-fetching, unbounded lists without pagination, large JSON shipped to clients.
- Frontend: heavyweight dependencies for trivial use, missing code-splitting on rare routes, client-side fetching for data available at render time, render waterfalls.
- Backend: synchronous work that belongs in a queue, missing indexes implied by query patterns (verify against schema, do not claim), per-request connections where pooling exists.
- Build and CI: missing caching, redundant steps, test suites that could parallelize.

## 4. Test coverage

Not a percentage game — find which untested code is dangerous.

- Map critical paths (money, auth, data mutation, the feature the repository exists for) and check coverage there.
- High-churn modules with no tests are top refactor risks; recommend characterization tests first.
- Existing test quality: assertions that assert nothing, mocks testing mocks, unread snapshots, flaky patterns (real timers, real network, order dependence).
- Missing layers: unit-only suites with no integration coverage at API boundaries, or the inverse.
- If there is no one-command way to know the codebase works, that is finding #1 and a prerequisite for any risky change.

## 5. Tech debt and architecture

- Duplication: the same logic reimplemented in three or more places, with drift.
- Layering violations: UI importing data-layer internals, circular dependencies, junk-drawer utility modules with high fan-in.
- Dead code: unused modules, fully rolled-out flags still branching, commented-out blocks, manifest dependencies no longer imported.
- God objects: files far larger than the repository median that everything touches; functions with deep nesting or double-digit parameters.
- Inconsistent patterns: three ways of doing fetching, error handling, or styling; pick the most recently converged winner and plan consolidation.
- Abstraction mismatches: single-implementation abstractions, and missing abstractions where every change touches N files in lockstep.

## 6. Dependencies and migrations

- Major-version lag on core framework or runtime where staying behind has real cost (EOL, security cutoffs, ecosystem incompatibility).
- Deprecated APIs with announced removal timelines.
- Abandoned dependencies on critical paths.
- Duplicate dependencies solving the same problem.
- Lockfile and manifest drift, inconsistent pinning across packages.
- Estimate blast radius (files touched) per candidate — it drives effort and whether to recommend the migration at all.

## 7. DX and tooling

- Missing or broken typecheck, lint, formatter, hooks, editorconfig.
- Slow feedback loops: dev-server or test startup in minutes, no watch mode, CI without caching.
- Onboarding friction: wrong or incomplete README steps, undocumented environment variables, no `.env.example`.
- Missing `AGENTS.md` — for repositories where agents execute the plans, this is high-leverage; recommend one and outline it as a plan.
- Logging and error messages: unstructured logs on services, no request IDs, debugging that requires code changes.

## 8. Docs

Lowest default priority; flag only where absence has concrete cost.

- Public API surface without reference docs.
- Architectural decisions nobody can reconstruct for actively contested areas.
- Stale docs that are actively wrong (worse than missing).

## 9. Direction — where to take the project next

Forward-looking: not what is broken, but what this codebase wants to become. Grounding rule: every suggestion cites evidence from the repository itself. Generic ideas that fit any project are noise.

Sources of grounded signal:

- Unfinished intent: TODO/FIXME clusters around one theme, flags never rolled out, stubbed modules, half-migrated features visible in history.
- Stated-but-undelivered: README or roadmap promises without code, no-op flags and config options, PRDs naming a direction the code has not caught up to. Never propose something a decision doc already rejected.
- Surface asymmetries: export without import, create without bulk-create, CRUD minus one, capabilities internal code hand-rolled around.
- The adjacent possible: capabilities the existing architecture makes disproportionately cheap.
- Friction worth productizing: things users evidently do by hand around the project.

Direction findings use the standard format; **Impact** is product or user value, **Confidence** reflects grounding strength, and effort estimates are coarse. Selected direction findings become design or spike plans, not build-everything plans.

---

## Finding format

Every finding, in this shape:

### [CATEGORY-NN] Short imperative title

- **Evidence**: `path/file.ts:123` — one sentence on what is there. (Use 2–5 strongest locations; note "and ~N similar sites" when widespread.)
- **Impact**: what goes wrong or what is being paid, concretely.
- **Effort**: S (hours) / M (a day-ish) / L (multi-day) for the fix including tests.
- **Risk**: what the fix could break; LOW/MED/HIGH plus one line.
- **Confidence**: HIGH (read the code, certain) / MED (strong signal, needs verification) / LOW (smell, needs investigation). LOW-confidence findings become investigate plans, not fix plans.
- **Fix sketch**: 1–3 sentences — enough to judge effort honestly.

## Prioritization rubric

Order by leverage = impact divided by effort, discounted by confidence and fix risk. Tiebreakers:

1. Anything that unblocks other findings (verification baseline, characterization tests) floats up.
2. HIGH-confidence security findings float above equivalent-leverage non-security findings.
3. Prefer findings whose fix has a clean verification story.
4. "Not worth doing" is a valid verdict; record it with one line so it is not re-audited.

## Vetting classes

Before a finding reaches the table, reopen the cited code. Expect three failure classes: by-design behavior reported as a bug (including tradeoffs settled in decision docs), mis-attributed evidence (right finding, wrong location), and duplicates across category passes. Downgrade, correct, or reject accordingly, and record rejections in the index.
