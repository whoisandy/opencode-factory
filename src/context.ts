import { promises as fs } from "node:fs";
import path from "node:path";

/** Size caps keep every read and the final answer bounded. */
export const MAX_INDEX_BYTES = 64 * 1024;
export const MAX_FILE_BYTES = 48 * 1024;
export const MAX_EXCERPT_CHARS = 360;
export const MAX_OUTPUT_CHARS = 12_000;
export const MAX_RECOMMENDATIONS = 5;
export const MAX_LISTED_SKIPS = 8;

/**
 * Project-root directory that holds factory state. The installer seeds
 * `<project>/.factory/context/navigation.md`; the plugin and every pack agent
 * read from this same location.
 */
export const CONTEXT_DIR_NAME = ".factory";
export const CONTEXT_SUBDIR = "context";
export const CONTEXT_INDEX_NAME = "navigation.md";
export const CONTEXT_INDEX_RELATIVE = `${CONTEXT_DIR_NAME}/${CONTEXT_SUBDIR}/${CONTEXT_INDEX_NAME}`;

const MARKDOWN_LINK = /\[([^\]]+)\]\(([^)\s]+)\)/g;
const HTML_COMMENT = /<!--[\s\S]*?-->/g;
const EXTERNAL_SCHEME = /^[a-z][a-z\d+.-]*:/i;
const TOKEN_SPLIT = /[^\p{L}\p{N}]+/u;

export interface Candidate {
  /** Link text shown in the navigation index. */
  label: string;
  /** Path as written in the index. */
  ref: string;
  /** Path relative to the project root, for display. */
  display: string;
  /** Absolute path, verified to exist. */
  absolute: string;
  /** Bytes on disk. */
  size: number;
  /** First characters of the file, when small enough to sample. */
  excerpt: string;
  /** Query relevance score. */
  score: number;
}

export interface Skipped {
  ref: string;
  reason: string;
}

export interface ContextRead {
  content: string;
  metadata: {
    root: string;
    index: string;
    found: boolean;
    verified?: number;
    skipped?: number;
    error?: string;
  };
}

export interface ContextInspectionEntry {
  ref: string;
  label: string;
  status: "ok" | "missing" | "rejected" | "not-file";
  reason?: string;
  display?: string;
}

export interface ContextInspection {
  indexFound: boolean;
  indexRelative: string;
  entries: ContextInspectionEntry[];
}

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(TOKEN_SPLIT)
    .filter((token) => token.length > 1);
}

export function isInside(parent: string, candidate: string): boolean {
  return candidate === parent || candidate.startsWith(parent + path.sep);
}

async function readCapped(absolute: string, maxBytes: number): Promise<string> {
  const handle = await fs.open(absolute, "r");

  try {
    const buffer = Buffer.alloc(maxBytes);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);

    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await handle.close();
  }
}

function scoreCandidate(candidate: Candidate, tokens: string[]): number {
  if (tokens.length === 0) {
    return 0;
  }

  const haystack = `${candidate.label}\n${candidate.display}\n${candidate.excerpt}`.toLowerCase();
  let score = 0;

  for (const token of tokens) {
    if (candidate.label.toLowerCase().includes(token)) {
      score += 3;
    } else if (candidate.display.toLowerCase().includes(token)) {
      score += 2;
    } else if (haystack.includes(token)) {
      score += 1;
    }
  }

  return score;
}

export function parseLinks(indexContent: string): { label: string; ref: string }[] {
  const links: { label: string; ref: string }[] = [];
  const seen = new Set<string>();
  const scannable = indexContent.replace(HTML_COMMENT, "");

  for (const match of scannable.matchAll(MARKDOWN_LINK)) {
    const label = match[1]?.trim() ?? "";
    const rawRef = (match[2] ?? "").trim();
    const ref = rawRef.split("#")[0]?.split("?")[0]?.trim() ?? "";

    if (ref.length === 0 || seen.has(ref)) {
      continue;
    }

    seen.add(ref);
    links.push({ label: label.length > 0 ? label : ref, ref });
  }

  return links;
}

/**
 * Resolves a navigation reference to a safe, existing path inside the
 * context directory. Returns either the verified path or a rejection reason.
 */
export async function resolveReference(
  contextDirReal: string,
  ref: string,
): Promise<
  { ok: true; absolute: string; real: string; size: number } | { ok: false; reason: string }
> {
  if (
    ref.startsWith("/") ||
    ref.startsWith("~") ||
    ref.includes("\0") ||
    EXTERNAL_SCHEME.test(ref)
  ) {
    return {
      ok: false,
      reason: "rejected: absolute, external, or unsafe reference",
    };
  }

  const resolved = path.resolve(contextDirReal, ref);

  if (!isInside(contextDirReal, resolved)) {
    return { ok: false, reason: "rejected: escapes the context directory" };
  }

  let real: string;

  try {
    real = await fs.realpath(resolved);
  } catch {
    return { ok: false, reason: "missing file" };
  }

  if (!isInside(contextDirReal, real)) {
    return {
      ok: false,
      reason: "rejected: symlink escapes the context directory",
    };
  }

  const stats = await fs.stat(real);

  if (!stats.isFile()) {
    return { ok: false, reason: "not a regular file" };
  }

  return { ok: true, absolute: resolved, real, size: stats.size };
}

async function collectCandidates(input: {
  root: string;
  contextDirReal: string;
  links: { label: string; ref: string }[];
  tokens: string[];
}): Promise<{ candidates: Candidate[]; skipped: Skipped[] }> {
  const { root, contextDirReal, links, tokens } = input;
  const candidates: Candidate[] = [];
  const skipped: Skipped[] = [];

  for (const link of links) {
    const resolved = await resolveReference(contextDirReal, link.ref);

    if (!resolved.ok) {
      skipped.push({ ref: link.ref, reason: resolved.reason });
      continue;
    }

    let excerpt = "";

    if (resolved.size <= MAX_FILE_BYTES) {
      try {
        excerpt = await readCapped(resolved.real, MAX_EXCERPT_CHARS * 8);
      } catch {
        excerpt = "";
      }
    }

    const candidate: Candidate = {
      label: link.label,
      ref: link.ref,
      display: path.relative(root, resolved.real),
      absolute: resolved.real,
      size: resolved.size,
      excerpt,
      score: 0,
    };

    candidate.score = scoreCandidate(candidate, tokens);
    candidates.push(candidate);
  }

  candidates.sort((a, b) => b.score - a.score || a.display.localeCompare(b.display));

  return { candidates, skipped };
}

function formatResult(input: {
  root: string;
  indexRelative: string;
  query: string;
  candidates: Candidate[];
  skipped: Skipped[];
  indexTruncated: boolean;
}): string {
  const { root, indexRelative, query, candidates, skipped, indexTruncated } = input;
  const lines: string[] = [];

  lines.push(`Project root: ${root}`);
  lines.push(
    `Context index: ${indexRelative}${indexTruncated ? " (truncated while reading)" : ""}`,
  );
  lines.push(`Query: ${query.trim()}`);
  lines.push("");

  if (candidates.length === 0 && skipped.length === 0) {
    lines.push("No project patterns found. The index exists but links to no files.");
    return lines.join("\n");
  }

  if (candidates.length === 0) {
    lines.push("No verified pattern files matched. Every referenced file is missing or invalid:");
  } else {
    lines.push(
      `Verified pattern files (ranked, ${Math.min(candidates.length, MAX_RECOMMENDATIONS)} of ${candidates.length}):`,
    );
    lines.push("");

    for (const candidate of candidates.slice(0, MAX_RECOMMENDATIONS)) {
      lines.push(`- ${candidate.display} — "${candidate.label}" (${candidate.size} bytes)`);
      if (candidate.excerpt.length > 0) {
        const excerpt = candidate.excerpt.replace(/\s+/g, " ").trim();
        lines.push(
          `  excerpt: ${excerpt.slice(0, MAX_EXCERPT_CHARS)}${excerpt.length > MAX_EXCERPT_CHARS ? "…" : ""}`,
        );
      }
    }

    if (candidates.length > MAX_RECOMMENDATIONS) {
      lines.push(`- …and ${candidates.length - MAX_RECOMMENDATIONS} more verified file(s).`);
    }
  }

  if (skipped.length > 0) {
    lines.push("");
    lines.push(`Unavailable entries (${skipped.length}):`);

    for (const entry of skipped.slice(0, MAX_LISTED_SKIPS)) {
      lines.push(`- ${entry.ref} — ${entry.reason}`);
    }

    if (skipped.length > MAX_LISTED_SKIPS) {
      lines.push(`- …and ${skipped.length - MAX_LISTED_SKIPS} more.`);
    }
  }

  lines.push("");
  lines.push(
    "Read the recommended files directly before editing; if they contradict the code, trust the code.",
  );

  const output = lines.join("\n");

  return output.length > MAX_OUTPUT_CHARS
    ? `${output.slice(0, MAX_OUTPUT_CHARS)}\n…[truncated]`
    : output;
}

export interface ReadContextInput {
  /** Directory that contains `navigation.md` (and usually `patterns/`). */
  contextDir: string;
  query: string;
  /** Label used in messages and metadata; defaults to `<basename(contextDir)>/navigation.md`. */
  indexLabel?: string;
  /** Root used for relative display paths; defaults to the parent of the context directory. */
  displayRoot?: string;
}

export interface InspectContextInput {
  contextDir: string;
  indexLabel?: string;
  displayRoot?: string;
}

function indexLabelOf(input: { contextDir: string; indexLabel?: string }): string {
  return input.indexLabel ?? path.join(path.basename(input.contextDir), CONTEXT_INDEX_NAME);
}

/**
 * Reads the project context index and returns a bounded, verified answer.
 * Never throws: failures come back as honest content plus metadata.
 */
export async function readContext(input: ReadContextInput): Promise<ContextRead> {
  const { contextDir, query } = input;
  const indexLabel = indexLabelOf(input);
  const displayRoot = await fs
    .realpath(input.displayRoot ?? path.dirname(contextDir))
    .catch(() => input.displayRoot ?? path.dirname(contextDir));
  const indexAbsolute = path.join(contextDir, CONTEXT_INDEX_NAME);

  try {
    const indexStats = await fs.stat(indexAbsolute);

    if (!indexStats.isFile()) {
      return {
        content: `No project context index found at ${indexLabel} (not a file). Inspect the neighboring implementation and tests before choosing conventions.`,
        metadata: { root: displayRoot, index: indexLabel, found: false },
      };
    }

    const indexTruncated = indexStats.size > MAX_INDEX_BYTES;
    const directory = await fs.realpath(contextDir).catch(() => contextDir);
    const indexContent = await readCapped(indexAbsolute, MAX_INDEX_BYTES);
    const links = parseLinks(indexContent);
    const tokens = tokenize(query);
    const { candidates, skipped } = await collectCandidates({
      root: displayRoot,
      contextDirReal: directory,
      links,
      tokens,
    });

    const content = formatResult({
      root: displayRoot,
      indexRelative: indexLabel,
      query,
      candidates,
      skipped,
      indexTruncated,
    });

    return {
      content,
      metadata: {
        root: displayRoot,
        index: indexLabel,
        found: true,
        verified: candidates.length,
        skipped: skipped.length,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        content: `No project context index found at ${indexLabel}. No project patterns are available for "${query.trim()}". Inspect the neighboring implementation and tests before choosing conventions.`,
        metadata: { root: displayRoot, index: indexLabel, found: false },
      };
    }

    return {
      content: `factory_context could not read the project context index (${message}). Continue without it and inspect the neighboring implementation and tests.`,
      metadata: {
        root: displayRoot,
        index: indexLabel,
        found: false,
        error: message,
      },
    };
  }
}

/** Structural check used by `ocf doctor`; does not sample file contents. */
export async function inspectContext(input: InspectContextInput): Promise<ContextInspection> {
  const indexLabel = indexLabelOf(input);
  const displayRoot = await fs
    .realpath(input.displayRoot ?? path.dirname(input.contextDir))
    .catch(() => input.displayRoot ?? path.dirname(input.contextDir));
  const indexAbsolute = path.join(input.contextDir, CONTEXT_INDEX_NAME);

  try {
    const stats = await fs.stat(indexAbsolute);

    if (!stats.isFile()) {
      return { indexFound: false, indexRelative: indexLabel, entries: [] };
    }
  } catch {
    return { indexFound: false, indexRelative: indexLabel, entries: [] };
  }

  const directory = await fs.realpath(input.contextDir).catch(() => input.contextDir);
  const content = await readCapped(indexAbsolute, MAX_INDEX_BYTES);
  const links = parseLinks(content);
  const entries: ContextInspectionEntry[] = [];

  for (const link of links) {
    const resolved = await resolveReference(directory, link.ref);

    if (resolved.ok) {
      entries.push({
        ref: link.ref,
        label: link.label,
        status: "ok",
        display: path.relative(displayRoot, resolved.real),
      });
    } else {
      entries.push({
        ref: link.ref,
        label: link.label,
        status:
          resolved.reason === "not a regular file"
            ? "not-file"
            : resolved.reason === "missing file"
              ? "missing"
              : "rejected",
        reason: resolved.reason,
      });
    }
  }

  return { indexFound: true, indexRelative: indexLabel, entries };
}
