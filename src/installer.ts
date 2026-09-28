import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  applyEdits,
  modify,
  type ParseError,
  parse as parseJsonc,
  printParseErrorCode,
} from "jsonc-parser";

import {
  CONTEXT_DIR_NAME,
  CONTEXT_INDEX_RELATIVE,
  CONTEXT_SUBDIR,
  inspectContext,
  isInside,
} from "./context.js";

export type Scope = "project" | "global";

export interface InstallerOptions {
  scope: Scope;
  /** Base directory for project scope; defaults to the current working directory. */
  cwd?: string;
  /** Config home override for global scope; defaults to XDG_CONFIG_HOME/opencode or ~/.config/opencode. */
  configHome?: string;
  /** Preview only; write nothing. */
  dryRun?: boolean;
  /** Replace files that are not owned by a previous opencode-factory manifest. */
  force?: boolean;
}

export type ActionKind = "write" | "config" | "remove" | "keep" | "skip" | "note";

export interface ChangeAction {
  kind: ActionKind;
  file: string;
  detail?: string;
}

export interface Report {
  target: string;
  actions: ChangeAction[];
  /** Line diff of configuration changes, when a config file is touched. */
  preview: string[];
  blocked: boolean;
}

export interface DoctorResult {
  ok: boolean;
  lines: string[];
}

export interface ManifestFile {
  path: string;
  hash: string;
  kind: "agent" | "command" | "skill" | "context";
}

export interface Manifest {
  manifestVersion: 1;
  package: string;
  installedVersion: string;
  pluginSpec: string;
  configFile?: string;
  files: ManifestFile[];
}

export class InstallerError extends Error {}

const CONFIG_CANDIDATES = ["opencode.json", "opencode.jsonc"];
const AGENT_EXT = ".md";

function here(): string {
  return path.dirname(fileURLToPath(import.meta.url));
}

function packageRoot(): string {
  return path.resolve(here(), "..");
}

interface OwnPackage {
  name: string;
  version: string;
}

async function readOwnPackage(): Promise<OwnPackage> {
  const raw = await fs.readFile(path.join(packageRoot(), "package.json"), "utf8");
  const parsed = JSON.parse(raw) as { name?: string; version?: string };

  if (!parsed.name || !parsed.version) {
    throw new InstallerError("The opencode-factory package.json is missing name or version.");
  }

  return { name: parsed.name, version: parsed.version };
}

async function listMarkdown(directory: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true });

    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(AGENT_EXT))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

async function listFilesRecursive(
  directory: string,
  prefix: string,
): Promise<{ relative: string; source: string }[]> {
  let entries: Dirent[];

  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    throw error;
  }

  const files: { relative: string; source: string }[] = [];

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const absolute = path.join(directory, entry.name);
    const relative = path.posix.join(prefix, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursive(absolute, relative)));
    } else if (entry.isFile()) {
      files.push({ relative, source: absolute });
    }
  }

  return files;
}

interface AssetFile {
  /** Path relative to the asset root (e.g. agents/foreman.md). */
  relative: string;
  /** Absolute source path inside the package. */
  source: string;
  kind: ManifestFile["kind"];
}

async function collectAssets(): Promise<AssetFile[]> {
  const assetsRoot = path.join(packageRoot(), "assets");
  const assets: AssetFile[] = [];

  for (const name of await listMarkdown(path.join(assetsRoot, "agents"))) {
    assets.push({
      relative: path.posix.join("agents", name),
      source: path.join(assetsRoot, "agents", name),
      kind: "agent",
    });
  }

  for (const name of await listMarkdown(path.join(assetsRoot, "commands"))) {
    assets.push({
      relative: path.posix.join("commands", name),
      source: path.join(assetsRoot, "commands", name),
      kind: "command",
    });
  }

  for (const file of await listFilesRecursive(path.join(assetsRoot, "skills"), "skills")) {
    assets.push({
      relative: file.relative,
      source: file.source,
      kind: "skill",
    });
  }

  const contextSeed = path.join(assetsRoot, "context", "navigation.md");

  try {
    const stats = await fs.stat(contextSeed);

    if (stats.isFile()) {
      assets.push({
        relative: "context/navigation.md",
        source: contextSeed,
        kind: "context",
      });
    }
  } catch {
    // Context seed is optional.
  }

  return assets;
}

/**
 * Where an asset lands, relative to the install base (the project directory
 * for --project, the config home for --global).
 *
 * Project scope keeps agents, commands, and skills inside `.opencode/` (OpenCode's
 * own project config directory) and the context index at the project root under
 * `.factory/`, where the plugin and every pack agent look for it. The context
 * index is project-scoped by nature, so --global skips it.
 */
function assetDestination(asset: AssetFile, scope: Scope): string | undefined {
  if (asset.kind === "context") {
    return scope === "project" ? CONTEXT_INDEX_RELATIVE : undefined;
  }

  const prefix = scope === "project" ? ".opencode" : "";

  return prefix.length > 0 ? path.posix.join(prefix, asset.relative) : asset.relative;
}

function sha256(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

async function hashFileOrUndefined(absolute: string): Promise<string | undefined> {
  try {
    return sha256(await fs.readFile(absolute));
  } catch {
    return undefined;
  }
}

export function resolveTargetRoot(options: InstallerOptions): string {
  if (options.scope === "global") {
    const base =
      options.configHome ??
      (process.env.XDG_CONFIG_HOME
        ? path.join(process.env.XDG_CONFIG_HOME, "opencode")
        : path.join(os.homedir(), ".config", "opencode"));

    return base;
  }

  return path.join(options.cwd ?? process.cwd(), ".opencode");
}

function resolveConfigDir(options: InstallerOptions): string {
  if (options.scope === "global") {
    return resolveTargetRoot(options);
  }

  return options.cwd ?? process.cwd();
}

/** Project directory for --project; config home for --global. */
function resolveBase(options: InstallerOptions): string {
  return options.scope === "global" ? resolveTargetRoot(options) : (options.cwd ?? process.cwd());
}

async function findConfigFile(configDir: string): Promise<string> {
  for (const candidate of CONFIG_CANDIDATES) {
    const absolute = path.join(configDir, candidate);

    try {
      const stats = await fs.stat(absolute);

      if (stats.isFile()) {
        return absolute;
      }
    } catch {
      // Try the next candidate.
    }
  }

  return path.join(configDir, CONFIG_CANDIDATES[0] ?? "opencode.json");
}

interface ConfigPlan {
  file: string;
  action?: ChangeAction;
  before: string;
  after: string;
  pluginsFound: string[];
}

function parseConfig(text: string, file: string): Record<string, unknown> {
  if (text.trim().length === 0) {
    return {};
  }

  const errors: ParseError[] = [];
  const parsed = parseJsonc(text, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  }) as unknown;

  if (errors.length > 0) {
    const first = errors[0];
    const reason = first ? printParseErrorCode(first.error) : "unknown";

    throw new InstallerError(
      `Refusing to edit ${file}: it is not valid JSON/JSONC (${reason} at offset ${first?.offset ?? 0}). Fix the file first.`,
    );
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new InstallerError(`Refusing to edit ${file}: the top-level value is not an object.`);
  }

  return parsed as Record<string, unknown>;
}

function readPluginEntries(config: Record<string, unknown>, file: string): unknown[] {
  const plugins = config.plugins;

  if (plugins === undefined) {
    return [];
  }

  if (!Array.isArray(plugins)) {
    throw new InstallerError(`Refusing to edit ${file}: "plugins" exists but is not an array.`);
  }

  return plugins;
}

function entryToSpec(entry: unknown): string | undefined {
  if (typeof entry === "string") {
    return entry;
  }

  if (entry !== null && typeof entry === "object" && !Array.isArray(entry)) {
    const pkg = (entry as { package?: unknown }).package;

    return typeof pkg === "string" ? pkg : undefined;
  }

  return undefined;
}

function specMatchesPackage(spec: string, packageName: string): boolean {
  return spec === packageName || spec.startsWith(`${packageName}@`);
}

function planConfigMerge(input: {
  text: string;
  file: string;
  packageName: string;
  pluginSpec: string;
}): ConfigPlan {
  const { text, file, packageName, pluginSpec } = input;
  const config = parseConfig(text, file);
  const entries = readPluginEntries(config, file);
  const specs = entries.map(entryToSpec).filter((spec): spec is string => spec !== undefined);

  if (specs.some((spec) => specMatchesPackage(spec, packageName) && spec !== pluginSpec)) {
    const next = entries.map((entry) => {
      const spec = entryToSpec(entry);
      return spec !== undefined && specMatchesPackage(spec, packageName) ? pluginSpec : entry;
    });
    const edits = modify(text, ["plugins"], next, {
      formattingOptions: { insertSpaces: true, tabSize: 2 },
    });
    const after = applyEdits(text, edits);

    return {
      file,
      before: text,
      after,
      pluginsFound: specs,
      action: {
        kind: "config",
        file,
        detail: `set plugin entry to ${pluginSpec}`,
      },
    };
  }

  if (specs.some((spec) => spec === pluginSpec)) {
    return { file, before: text, after: text, pluginsFound: specs };
  }

  const next = [...entries, pluginSpec];
  const edits = modify(text, ["plugins"], next, {
    formattingOptions: { insertSpaces: true, tabSize: 2 },
  });
  const after = applyEdits(text, edits);

  return {
    file,
    before: text,
    after,
    pluginsFound: specs,
    action: { kind: "config", file, detail: `add plugin entry ${pluginSpec}` },
  };
}

function planConfigRemoval(input: { text: string; file: string; packageName: string }): ConfigPlan {
  const { text, file, packageName } = input;
  const config = parseConfig(text, file);
  const entries = readPluginEntries(config, file);
  const specs = entries.map(entryToSpec).filter((spec): spec is string => spec !== undefined);

  if (!specs.some((spec) => specMatchesPackage(spec, packageName))) {
    return { file, before: text, after: text, pluginsFound: specs };
  }

  const next = entries.filter((entry) => {
    const spec = entryToSpec(entry);

    return spec === undefined || !specMatchesPackage(spec, packageName);
  });
  const edits =
    next.length === 0
      ? modify(text, ["plugins"], undefined, {})
      : modify(text, ["plugins"], next, {
          formattingOptions: { insertSpaces: true, tabSize: 2 },
        });
  const after = applyEdits(text, edits);

  return {
    file,
    before: text,
    after,
    pluginsFound: specs,
    action: { kind: "config", file, detail: "remove opencode-factory plugin entry" },
  };
}

/** Minimal line diff for previews; returns "-" and "+" lines only. */
export function previewDiff(before: string, after: string): string[] {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const lines: string[] = [];
  let start = 0;

  while (
    start < beforeLines.length &&
    start < afterLines.length &&
    beforeLines[start] === afterLines[start]
  ) {
    start += 1;
  }

  let endBefore = beforeLines.length;
  let endAfter = afterLines.length;

  while (
    endBefore > start &&
    endAfter > start &&
    beforeLines[endBefore - 1] === afterLines[endAfter - 1]
  ) {
    endBefore -= 1;
    endAfter -= 1;
  }

  for (const line of beforeLines.slice(start, endBefore)) {
    lines.push(`- ${line}`);
  }

  for (const line of afterLines.slice(start, endAfter)) {
    lines.push(`+ ${line}`);
  }

  return lines;
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function writeFileEnsuringDir(absolute: string, content: string | Buffer): Promise<void> {
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, content);
}

/**
 * Removes directories that became empty after a file removal, walking upward
 * from `startDir` but never past `stopDir` (the pack target root). Missing or
 * non-empty directories stop the walk.
 */
async function pruneEmptyDirs(startDir: string, stopDir: string): Promise<void> {
  let current = path.resolve(startDir);
  const stop = path.resolve(stopDir);

  while (current !== stop && isInside(stop, current)) {
    try {
      await fs.rmdir(current);
    } catch {
      return;
    }

    current = path.dirname(current);
  }
}

async function readManifest(manifestPath: string): Promise<Manifest | undefined> {
  let raw: string;

  try {
    raw = await fs.readFile(manifestPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }

    throw error;
  }

  const parsed = JSON.parse(raw) as Partial<Manifest>;

  if (
    parsed.manifestVersion !== 1 ||
    !Array.isArray(parsed.files) ||
    typeof parsed.package !== "string"
  ) {
    throw new InstallerError(
      `${manifestPath} is not a valid opencode-factory manifest. Move it aside and reinstall.`,
    );
  }

  return parsed as Manifest;
}

interface PlannedFile {
  asset: AssetFile;
  target: string;
  kind: ActionKind;
  detail?: string;
  content?: Buffer;
}

interface InstallPlan {
  base: string;
  targetRoot: string;
  configDir: string;
  manifestPath: string;
  files: PlannedFile[];
  config: ConfigPlan | undefined;
  removals: { relative: string; target: string; hash: string }[];
  manifest: Manifest;
}

async function planInstallLike(options: InstallerOptions): Promise<InstallPlan> {
  const pkg = await readOwnPackage();
  const base = resolveBase(options);
  const targetRoot = resolveTargetRoot(options);
  const configDir = resolveConfigDir(options);
  const manifestPath = path.join(targetRoot, ".factory-manifest.json");
  const previous = await readManifest(manifestPath);
  const pluginSpec = `${pkg.name}@${pkg.version}`;
  const assets = await collectAssets();
  const files: PlannedFile[] = [];
  const manifestFiles: ManifestFile[] = [];
  const destinations = new Set<string>();

  for (const asset of assets) {
    const destination = assetDestination(asset, options.scope);

    if (destination === undefined) {
      continue;
    }

    destinations.add(destination);

    const target = path.join(base, destination);
    const content = await fs.readFile(asset.source);
    const sourceHash = sha256(content);
    const currentHash = await hashFileOrUndefined(target);
    const owned = previous?.files.find((entry) => entry.path === destination);
    const isContextSeed = asset.kind === "context";

    if (currentHash === undefined) {
      files.push({ asset, target, kind: "write", content });
      manifestFiles.push({
        path: destination,
        hash: sourceHash,
        kind: asset.kind,
      });
      continue;
    }

    if (currentHash === sourceHash) {
      files.push({ asset, target, kind: "skip", detail: "already up to date" });
      manifestFiles.push({
        path: destination,
        hash: sourceHash,
        kind: asset.kind,
      });
      continue;
    }

    if (owned && owned.hash === currentHash) {
      // Pack-owned and untouched since the last install: safe to update.
      files.push({
        asset,
        target,
        kind: "write",
        detail: "update pack-owned file",
        content,
      });
      manifestFiles.push({
        path: destination,
        hash: sourceHash,
        kind: asset.kind,
      });
      continue;
    }

    if (isContextSeed) {
      files.push({
        asset,
        target,
        kind: "skip",
        detail: "existing context index left untouched",
      });
      continue;
    }

    if (options.force) {
      files.push({
        asset,
        target,
        kind: "write",
        detail: "replace with --force",
        content,
      });
      manifestFiles.push({
        path: destination,
        hash: sourceHash,
        kind: asset.kind,
      });
      continue;
    }

    files.push({
      asset,
      target,
      kind: "keep",
      detail: owned
        ? "user-edited since install; kept"
        : "existing file not owned by opencode-factory; kept",
    });

    if (owned) {
      manifestFiles.push({
        path: destination,
        hash: owned.hash,
        kind: owned.kind,
      });
    }
  }

  // Files the previous install owned that are no longer shipped.
  const removals: { relative: string; target: string; hash: string }[] = [];

  for (const entry of previous?.files ?? []) {
    if (!destinations.has(entry.path)) {
      removals.push({
        relative: entry.path,
        target: path.join(base, entry.path),
        hash: entry.hash,
      });
    }
  }

  const configFile = await findConfigFile(configDir);
  const configText = await fs.readFile(configFile, "utf8").catch(() => "");
  const config = planConfigMerge({
    text: configText,
    file: configFile,
    packageName: pkg.name,
    pluginSpec,
  });

  if (config.action) {
    config.action.file = path.relative(configDir, configFile) || path.basename(configFile);
  }

  const manifest: Manifest = {
    manifestVersion: 1,
    package: pkg.name,
    installedVersion: pkg.version,
    pluginSpec,
    configFile: path.relative(configDir, configFile) || path.basename(configFile),
    files: manifestFiles,
  };

  return {
    base,
    targetRoot,
    configDir,
    manifestPath,
    files,
    config,
    removals,
    manifest,
  };
}

async function executeInstallPlan(plan: InstallPlan, dryRun: boolean): Promise<Report> {
  const actions: ChangeAction[] = [];
  const preview: string[] = [];
  const backupDir = path.join(plan.targetRoot, ".factory-backups", stamp());

  for (const file of plan.files) {
    const display = path.relative(plan.base, file.target);

    if (file.kind === "write") {
      if (!dryRun) {
        const existing = await hashFileOrUndefined(file.target);

        if (existing !== undefined) {
          const backupTarget = path.join(backupDir, display);
          await fs.mkdir(path.dirname(backupTarget), { recursive: true });
          await fs.copyFile(file.target, backupTarget);
        }

        if (file.content !== undefined) {
          await writeFileEnsuringDir(file.target, file.content);
        }
      }

      actions.push({ kind: "write", file: display, detail: file.detail });
    } else {
      actions.push({ kind: file.kind, file: display, detail: file.detail });
    }
  }

  for (const removal of plan.removals) {
    const currentHash = await hashFileOrUndefined(removal.target);

    if (currentHash === undefined) {
      continue;
    }

    if (currentHash !== removal.hash) {
      actions.push({
        kind: "keep",
        file: removal.relative,
        detail: "no longer shipped but modified; kept",
      });
      continue;
    }

    if (!dryRun) {
      await fs.rm(removal.target, { force: true });
      await pruneEmptyDirs(path.dirname(removal.target), plan.targetRoot);
    }

    actions.push({
      kind: "remove",
      file: removal.relative,
      detail: "no longer shipped",
    });
  }

  if (plan.config?.action) {
    if (!dryRun) {
      await writeFileEnsuringDir(plan.config.file, plan.config.after);
    }

    actions.push(plan.config.action);
    preview.push(...previewDiff(plan.config.before, plan.config.after).map((line) => `  ${line}`));
  }

  if (!dryRun) {
    await writeFileEnsuringDir(plan.manifestPath, `${JSON.stringify(plan.manifest, null, 2)}\n`);
  }

  return { target: plan.base, actions, preview, blocked: false };
}

export async function install(options: InstallerOptions): Promise<Report> {
  const plan = await planInstallLike(options);

  return executeInstallPlan(plan, options.dryRun === true);
}

export const update = install;

export async function uninstall(options: InstallerOptions): Promise<Report> {
  const pkg = await readOwnPackage();
  const base = resolveBase(options);
  const targetRoot = resolveTargetRoot(options);
  const configDir = resolveConfigDir(options);
  const manifestPath = path.join(targetRoot, ".factory-manifest.json");
  const manifest = await readManifest(manifestPath);
  const actions: ChangeAction[] = [];
  const preview: string[] = [];
  const dryRun = options.dryRun === true;

  if (manifest) {
    for (const entry of manifest.files) {
      const target = path.join(base, entry.path);
      const currentHash = await hashFileOrUndefined(target);

      if (currentHash === undefined) {
        continue;
      }

      if (currentHash === entry.hash) {
        if (!dryRun) {
          await fs.rm(target, { force: true });
          await pruneEmptyDirs(path.dirname(target), targetRoot);
        }

        actions.push({ kind: "remove", file: entry.path });
      } else {
        actions.push({
          kind: "keep",
          file: entry.path,
          detail: "modified since install; kept",
        });
      }
    }
  }

  const configFile = manifest?.configFile
    ? path.join(configDir, manifest.configFile)
    : await findConfigFile(configDir);
  const configText = await fs.readFile(configFile, "utf8").catch(() => "");
  const configPlan = planConfigRemoval({
    text: configText,
    file: configFile,
    packageName: pkg.name,
  });

  if (configPlan.action) {
    configPlan.action.file = path.relative(configDir, configFile) || path.basename(configFile);

    if (!dryRun) {
      await writeFileEnsuringDir(configFile, configPlan.after);
    }

    actions.push(configPlan.action);
    preview.push(...previewDiff(configPlan.before, configPlan.after).map((line) => `  ${line}`));
  }

  if (manifest && !dryRun) {
    await fs.rm(manifestPath, { force: true });
  }

  if (manifest) {
    actions.push({
      kind: "note",
      file: path.relative(targetRoot, manifestPath) || ".factory-manifest.json",
      detail: "manifest removed",
    });
  }

  return { target: base, actions, preview, blocked: false };
}

export async function doctor(options: InstallerOptions): Promise<DoctorResult> {
  const pkg = await readOwnPackage();
  const base = resolveBase(options);
  const targetRoot = resolveTargetRoot(options);
  const configDir = resolveConfigDir(options);
  const lines: string[] = [];
  let ok = true;

  lines.push(`ocf doctor`);
  lines.push(`  package:  ${pkg.name}@${pkg.version}`);
  lines.push(`  scope:    ${options.scope}`);
  lines.push(`  target:   ${base}`);

  const configFile = await findConfigFile(configDir);
  const configExists = await fs
    .stat(configFile)
    .then((stats) => stats.isFile())
    .catch(() => false);
  let pluginEntry: string | undefined;

  if (!configExists) {
    ok = false;
    lines.push(`  config:   missing (${configFile}) — run: ocf install`);
  } else {
    try {
      const config = parseConfig(await fs.readFile(configFile, "utf8"), configFile);
      const specs = readPluginEntries(config, configFile)
        .map(entryToSpec)
        .filter((spec): spec is string => spec !== undefined);
      pluginEntry = specs.find((spec) => specMatchesPackage(spec, pkg.name));

      if (pluginEntry) {
        lines.push(`  config:   ok — plugin entry "${pluginEntry}" in ${configFile}`);
      } else {
        ok = false;
        lines.push(`  config:   plugin entry missing in ${configFile} — run: ocf install`);
      }
    } catch (error) {
      ok = false;
      lines.push(
        `  config:   unreadable — ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const localPlugin = path.join(targetRoot, "plugins", "opencode-factory");
  const localPluginPresent = await fs
    .stat(localPlugin)
    .then((stats) => stats.isDirectory())
    .catch(() => false);

  if (localPluginPresent) {
    lines.push(
      `  plugin:   local development plugin present at ${path.relative(targetRoot, localPlugin)} (used instead of the npm package during development)`,
    );
  } else if (pluginEntry === undefined) {
    lines.push(`  plugin:   not verified — no configuration entry and no local plugin directory`);
  }

  const assets = await collectAssets();
  const missing: string[] = [];

  for (const asset of assets) {
    const destination = assetDestination(asset, options.scope);

    if (destination === undefined) {
      continue;
    }

    const target = path.join(base, destination);
    const exists = await fs
      .stat(target)
      .then((stats) => stats.isFile())
      .catch(() => false);

    if (!exists) {
      missing.push(destination);
    }
  }

  const agentCount = assets.filter((asset) => asset.kind === "agent").length;
  const commandCount = assets.filter((asset) => asset.kind === "command").length;
  const skillCount = assets.filter((asset) => asset.kind === "skill").length;

  if (missing.length === 0) {
    lines.push(`  agents:   ok — ${agentCount}/${agentCount} present`);
    lines.push(`  commands: ok — ${commandCount}/${commandCount} present`);
    lines.push(`  skills:   ok — ${skillCount}/${skillCount} present`);
  } else {
    ok = false;
    lines.push(`  assets:   missing ${missing.length} file(s): ${missing.join(", ")}`);

    for (const item of missing) {
      if (item.includes("agents/")) {
        lines.push(`  agents:   missing ${item}`);
      } else if (item.includes("commands/")) {
        lines.push(`  commands: missing ${item}`);
      } else if (item.includes("skills/")) {
        lines.push(`  skills:   missing ${item}`);
      }
    }
  }

  if (options.scope === "global") {
    lines.push(`  context:  project-scoped (.factory/) — not checked for --global`);
  } else {
    const context = await inspectContext({
      contextDir: path.join(base, CONTEXT_DIR_NAME, CONTEXT_SUBDIR),
      indexLabel: CONTEXT_INDEX_RELATIVE,
      displayRoot: base,
    });

    if (!context.indexFound) {
      ok = false;
      lines.push(`  context:  missing ${context.indexRelative} — run: ocf install`);
    } else {
      const broken = context.entries.filter((entry) => entry.status !== "ok");
      const verified = context.entries.length - broken.length;

      if (broken.length === 0) {
        lines.push(`  context:  ok — index readable, ${verified} reference(s) verified`);
      } else {
        lines.push(
          `  context:  index readable, ${verified} verified, ${broken.length} unavailable reference(s)`,
        );

        for (const entry of broken) {
          lines.push(`             - ${entry.ref} (${entry.reason ?? entry.status})`);
        }
      }
    }

    const plansDir = path.join(base, CONTEXT_DIR_NAME, "plans");
    const planEntries = await fs.readdir(plansDir).catch(() => undefined);

    if (planEntries) {
      const planCount = planEntries.filter((name) => name.endsWith(".md")).length;
      lines.push(`  plans:    present — ${planCount} markdown file(s) under .factory/plans/`);
    }
  }

  lines.push(ok ? `  result:   PASS` : `  result:   FAIL`);

  return { ok, lines };
}
