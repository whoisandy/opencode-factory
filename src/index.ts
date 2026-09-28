import path from "node:path";

import { Plugin } from "@opencode/plugin";

import {
  CONTEXT_DIR_NAME,
  CONTEXT_INDEX_RELATIVE,
  CONTEXT_SUBDIR,
  inspectContext,
  readContext,
} from "./context.js";

const NUDGE_DEBOUNCE_MS = 10 * 60 * 1000;
const NUDGE_STORAGE_PREFIX = "context-nudge/";
const BUILTIN_AWARE_POINTER =
  "This project uses opencode-factory. Shared context lives at `.factory/context/navigation.md` " +
  "(pattern notes under `.factory/context/patterns/`); handoff plans live under `.factory/plans/`. " +
  "Read the context index before planning, and write plans to `.factory/plans/`.";

/**
 * opencode-factory v0: one read-only tool plus two opt-in conveniences.
 *
 * `factory_context` reads `<project>/.factory/context/navigation.md`, verifies
 * each referenced file still exists inside the context directory (rejecting
 * absolute paths, traversal, external URLs, and symlink escapes), and returns
 * a bounded, relevance-ranked summary.
 *
 * Options:
 * - `contextNudge` ("off" | "warn", default "off"): on session idle, warn at
 *   most once per session per 10 minutes when the context index has broken
 *   references. Read-only; nothing is written.
 * - `builtinAwareness` (boolean, default true): append a short `.factory/`
 *   pointer to the built-in `plan` and `build` agents at load time, only when
 *   the project has a context index. Runtime-only; reverts on unload.
 *
 * The plugin never writes to the repository or configuration and never runs
 * background loops. Removing it leaves the Markdown agent pack fully functional.
 */
export default Plugin.define({
  id: "opencode-factory",
  async setup(ctx) {
    const root = ctx.location.project?.canonical ?? ctx.location.directory;
    const contextDir = path.join(root, CONTEXT_DIR_NAME, CONTEXT_SUBDIR);
    const options = ctx.options as { contextNudge?: unknown; builtinAwareness?: unknown };
    const nudgeEnabled = options.contextNudge === "warn";
    const awarenessEnabled = options.builtinAwareness !== false;

    await ctx.tool.transform((editor) => {
      editor.add({
        name: "factory_context",
        description:
          "Read the project context index and return task-relevant pattern files. " +
          "Read-only, project-scoped, and bounded: referenced files are verified to exist before being recommended.",
        input: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "The task or topic to find project patterns for.",
              minLength: 1,
              maxLength: 2000,
            },
          },
          required: ["query"],
          additionalProperties: false,
        },
        options: { codemode: false },
        async execute(rawInput) {
          const query =
            typeof rawInput === "object" && rawInput !== null
              ? String((rawInput as { query?: unknown }).query ?? "")
              : "";
          const result = await readContext({
            contextDir,
            query,
            indexLabel: CONTEXT_INDEX_RELATIVE,
            displayRoot: root,
          });

          return { content: result.content, metadata: result.metadata };
        },
      });
    });

    if (awarenessEnabled) {
      const inspection = await inspectContext({
        contextDir,
        indexLabel: CONTEXT_INDEX_RELATIVE,
        displayRoot: root,
      }).catch(() => undefined);

      if (inspection?.indexFound) {
        await ctx.agent.transform((editor) => {
          for (const id of ["plan", "build"]) {
            const agent = editor.get(id);
            const system = typeof agent?.system === "string" ? agent.system : "";

            if (!agent || system.includes(".factory/context/navigation.md")) {
              continue;
            }

            editor.update(id, (draft) => {
              draft.system = `${system.trimEnd()}\n\n${BUILTIN_AWARE_POINTER}`.trim();
            });
          }
        });
      }
    }

    if (!nudgeEnabled) {
      return;
    }

    const state = { running: true };

    void (async () => {
      try {
        for await (const rawEvent of ctx.event.subscribe()) {
          if (!state.running) {
            break;
          }

          const event = rawEvent as { type?: string; data?: { sessionID?: string } };

          if (event.type !== "session.idle" || !event.data?.sessionID) {
            continue;
          }

          const sessionID = event.data.sessionID;
          const storageKey = `${NUDGE_STORAGE_PREFIX}${sessionID}`;
          const last = await ctx.storage.get(storageKey).catch(() => undefined);
          const lastAt = typeof last === "number" ? last : 0;

          if (Date.now() - lastAt < NUDGE_DEBOUNCE_MS) {
            continue;
          }

          const inspection = await inspectContext({
            contextDir,
            indexLabel: CONTEXT_INDEX_RELATIVE,
            displayRoot: root,
          }).catch(() => undefined);

          if (!inspection?.indexFound) {
            continue;
          }

          const broken = inspection.entries.filter((entry) => entry.status !== "ok");

          if (broken.length === 0) {
            continue;
          }

          await ctx.storage.set(storageKey, Date.now()).catch(() => undefined);

          const sample = broken
            .slice(0, 3)
            .map((entry) => `${entry.ref} (${entry.status})`)
            .join(", ");

          await ctx.session
            .synthetic({
              sessionID,
              text:
                `factory_context notice: ${broken.length} context reference(s) are unavailable (${sample}). ` +
                "The shared pattern record may be stale; run /context refresh to fix the index.",
            })
            .catch(() => undefined);
        }
      } catch {
        // The event stream is best-effort; never let it break the plugin.
      }
    })();

    return () => {
      state.running = false;
    };
  },
});
