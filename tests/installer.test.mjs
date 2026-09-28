import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { parse as parseJsonc } from "jsonc-parser";

import { doctor, install, InstallerError, uninstall, update } from "../dist/installer.js";

let workRoot;

const AGENT_COUNT = 8;
const COMMAND_COUNT = 8;
const SKILL_FILE_COUNT = 7;
const PACK_FILE_COUNT = AGENT_COUNT + COMMAND_COUNT + SKILL_FILE_COUNT + 1; // agents + commands + skills + context seed

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

async function makeProject() {
  return mkdtemp(path.join(workRoot, "project-"));
}

async function exists(absolute) {
  try {
    await access(absolute);

    return true;
  } catch {
    return false;
  }
}

async function readConfig(dir) {
  return JSON.parse(await readFile(path.join(dir, "opencode.json"), "utf8"));
}

async function readManifest(dir) {
  return JSON.parse(await readFile(path.join(dir, ".opencode", ".factory-manifest.json"), "utf8"));
}

function actionKinds(report) {
  return report.actions.map((action) => `${action.kind}:${action.file}`);
}

async function writeAgentFile(dir, relative, content) {
  const absolute = path.join(dir, ".opencode", relative);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, content);
}

beforeAll(async () => {
  workRoot = await mkdtemp(path.join(os.tmpdir(), "factory-installer-"));
});

afterAll(async () => {
  await rm(workRoot, { recursive: true, force: true });
});

describe("install", () => {
  it("installs the pack, registers the plugin, and writes a manifest", async () => {
    const dir = await makeProject();
    const report = await install({ scope: "project", cwd: dir });
    const kinds = actionKinds(report);

    expect(kinds.filter((entry) => entry.startsWith("write:"))).toHaveLength(PACK_FILE_COUNT);
    expect(kinds).toContain("config:opencode.json");

    expect(await exists(path.join(dir, ".opencode", "agents", "foreman.md"))).toBe(true);
    expect(await exists(path.join(dir, ".opencode", "commands", "ultrawork.md"))).toBe(true);
    expect(await exists(path.join(dir, ".opencode", "skills", "improve", "SKILL.md"))).toBe(true);
    expect(await exists(path.join(dir, ".factory", "context", "navigation.md"))).toBe(true);

    const config = await readConfig(dir);
    expect(config.plugins).toEqual(["opencode-factory@0.1.0"]);

    const manifest = await readManifest(dir);
    expect(manifest.files).toHaveLength(PACK_FILE_COUNT);
    expect(manifest.files.some((file) => file.kind === "skill")).toBe(true);
    expect(manifest.installedVersion).toBe("0.1.0");
  });

  it("is idempotent on a second install", async () => {
    const dir = await makeProject();
    await install({ scope: "project", cwd: dir });

    const configBefore = await readFile(path.join(dir, "opencode.json"), "utf8");
    const report = await install({ scope: "project", cwd: dir });
    const configAfter = await readFile(path.join(dir, "opencode.json"), "utf8");

    expect(
      report.actions.every((action) => action.kind !== "write" && action.kind !== "config"),
    ).toBe(true);
    expect(configAfter).toBe(configBefore);
  });

  it("writes nothing on --dry-run", async () => {
    const dir = await makeProject();
    const report = await install({ scope: "project", cwd: dir, dryRun: true });

    expect(report.actions.some((action) => action.kind === "write")).toBe(true);
    expect(await exists(path.join(dir, ".opencode", "agents", "foreman.md"))).toBe(false);
    expect(await exists(path.join(dir, ".opencode", "skills", "improve", "SKILL.md"))).toBe(false);
    expect(await exists(path.join(dir, ".factory", "context", "navigation.md"))).toBe(false);
    expect(await exists(path.join(dir, "opencode.json"))).toBe(false);
  });

  it("preserves comments, unrelated settings, and other plugins in JSONC", async () => {
    const dir = await makeProject();
    const original = `{
  // team settings
  "$schema": "https://opencode.ai/config.json",
  "mcp": { "servers": {} },
  "plugins": ["other-plugin@1.0.0"]
}
`;
    await writeFile(path.join(dir, "opencode.jsonc"), original);

    const report = await install({ scope: "project", cwd: dir });
    expect(actionKinds(report)).toContain("config:opencode.jsonc");

    const config = parseJsonc(await readFile(path.join(dir, "opencode.jsonc"), "utf8"));
    expect(config.plugins).toEqual(["other-plugin@1.0.0", "opencode-factory@0.1.0"]);
    expect(config.mcp).toEqual({ servers: {} });

    const text = await readFile(path.join(dir, "opencode.jsonc"), "utf8");
    expect(text).toMatch(/\/\/ team settings/);
  });

  it("refuses to edit a malformed config", async () => {
    const dir = await makeProject();
    await writeFile(path.join(dir, "opencode.json"), "{ this is not json ");

    let caught;
    try {
      await install({ scope: "project", cwd: dir });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(InstallerError);
  });

  it("keeps existing unowned files unless --force is passed", async () => {
    const dir = await makeProject();
    await writeAgentFile(dir, "agents/foreman.md", "user's own foreman");

    const kept = await install({ scope: "project", cwd: dir });
    expect(actionKinds(kept)).toContain("keep:.opencode/agents/foreman.md");
    expect(await readFile(path.join(dir, ".opencode", "agents", "foreman.md"), "utf8")).toBe(
      "user's own foreman",
    );

    const forced = await install({ scope: "project", cwd: dir, force: true });
    expect(actionKinds(forced)).toContain("write:.opencode/agents/foreman.md");
    expect(await readFile(path.join(dir, ".opencode", "agents", "foreman.md"), "utf8")).not.toBe(
      "user's own foreman",
    );

    const backups = await readdir(path.join(dir, ".opencode", ".factory-backups"), {
      recursive: true,
    });
    expect(backups.some((entry) => entry.endsWith("foreman.md"))).toBe(true);
  });

  it("supports global scope with a config home override", async () => {
    const home = await mkdtemp(path.join(workRoot, "globalhome-"));
    await install({ scope: "global", configHome: home });

    expect(await exists(path.join(home, "agents", "foreman.md"))).toBe(true);
    expect(await exists(path.join(home, "commands", "ultrawork.md"))).toBe(true);
    expect(await exists(path.join(home, "skills", "improve", "SKILL.md"))).toBe(true);
    expect(await exists(path.join(home, ".factory-manifest.json"))).toBe(true);
    expect(await exists(path.join(home, ".factory", "context", "navigation.md"))).toBe(false);

    const config = JSON.parse(await readFile(path.join(home, "opencode.json"), "utf8"));
    expect(config.plugins).toEqual(["opencode-factory@0.1.0"]);
  });
});

describe("update", () => {
  it("preserves user-edited pack files", async () => {
    const dir = await makeProject();
    await install({ scope: "project", cwd: dir });

    const agentPath = path.join(dir, ".opencode", "agents", "foreman.md");
    const edited = "my heavily edited foreman prompt\n";
    await writeFile(agentPath, edited);

    const report = await update({ scope: "project", cwd: dir });
    expect(actionKinds(report)).toContain("keep:.opencode/agents/foreman.md");
    expect(await readFile(agentPath, "utf8")).toBe(edited);
  });

  it("removes no-longer-shipped files and prunes empty directories", async () => {
    const dir = await makeProject();
    await install({ scope: "project", cwd: dir });

    const legacy = path.join(dir, ".opencode", "skills", "legacy", "old.md");
    await mkdir(path.dirname(legacy), { recursive: true });
    await writeFile(legacy, "legacy skill\n");

    const manifestPath = path.join(dir, ".opencode", ".factory-manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.files.push({
      path: ".opencode/skills/legacy/old.md",
      hash: sha256("legacy skill\n"),
      kind: "skill",
    });
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    const report = await update({ scope: "project", cwd: dir });
    expect(actionKinds(report)).toContain("remove:.opencode/skills/legacy/old.md");
    expect(await exists(path.join(dir, ".opencode", "skills", "legacy"))).toBe(false);
  });

  it("replaces pack-owned untouched files", async () => {
    const dir = await makeProject();
    await install({ scope: "project", cwd: dir });

    const agentPath = path.join(dir, ".opencode", "agents", "foreman.md");
    const oldContent = "old shipped version\n";
    await writeFile(agentPath, oldContent);

    const manifestPath = path.join(dir, ".opencode", ".factory-manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const entry = manifest.files.find((file) => file.path === ".opencode/agents/foreman.md");
    entry.hash = sha256(oldContent);
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    const report = await update({ scope: "project", cwd: dir });
    expect(actionKinds(report)).toContain("write:.opencode/agents/foreman.md");
    expect(await readFile(agentPath, "utf8")).not.toBe(oldContent);
    expect(await readFile(agentPath, "utf8")).toMatch(/Foreman/);
  });
});

describe("uninstall", () => {
  it("removes untouched pack files, the plugin entry, and the manifest while keeping user edits", async () => {
    const dir = await makeProject();
    await install({ scope: "project", cwd: dir });

    await writeFile(
      path.join(dir, "opencode.json"),
      `{\n  "plugins": ["opencode-factory@0.1.0"],\n  "theme": "dark"\n}\n`,
    );

    const editedPath = path.join(dir, ".opencode", "agents", "sage.md");
    await writeFile(editedPath, "user edited sage\n");

    const report = await uninstall({ scope: "project", cwd: dir });
    const kinds = actionKinds(report);

    expect(kinds).toContain("remove:.opencode/agents/foreman.md");
    expect(kinds).toContain("keep:.opencode/agents/sage.md");

    expect(await exists(path.join(dir, ".opencode", "agents", "foreman.md"))).toBe(false);
    expect(await exists(editedPath)).toBe(true);
    expect(await exists(path.join(dir, ".opencode", "skills"))).toBe(false);
    expect(await exists(path.join(dir, ".opencode", "commands"))).toBe(false);
    expect(await exists(path.join(dir, ".opencode", ".factory-manifest.json"))).toBe(false);

    const config = await readConfig(dir);
    expect(config.plugins).toBeUndefined();
    expect(config.theme).toBe("dark");
  });

  it("is a no-op on a clean project", async () => {
    const dir = await makeProject();
    const report = await uninstall({ scope: "project", cwd: dir });

    expect(report.actions.every((action) => action.kind === "note" || action.kind === "skip")).toBe(
      true,
    );
  });
});

describe("doctor", () => {
  it("passes after a fresh install", async () => {
    const dir = await makeProject();
    await install({ scope: "project", cwd: dir });

    const result = await doctor({ scope: "project", cwd: dir });
    expect(result.ok).toBe(true);
    expect(result.lines.join("\n")).toMatch(/result:\s+PASS/);
    expect(result.lines.join("\n")).toMatch(/skills:\s+ok — 7\/7 present/);
  });

  it("fails when a pack file is missing", async () => {
    const dir = await makeProject();
    await install({ scope: "project", cwd: dir });
    await rm(path.join(dir, ".opencode", "agents", "reviewer.md"));

    const result = await doctor({ scope: "project", cwd: dir });
    expect(result.ok).toBe(false);
    expect(result.lines.join("\n")).toMatch(/.opencode\/agents\/reviewer\.md/);
  });

  it("fails when a skill file is missing", async () => {
    const dir = await makeProject();
    await install({ scope: "project", cwd: dir });
    await rm(path.join(dir, ".opencode", "skills", "improve", "references", "plan-template.md"));

    const result = await doctor({ scope: "project", cwd: dir });
    expect(result.ok).toBe(false);
    expect(result.lines.join("\n")).toMatch(/skills\/improve\/references\/plan-template\.md/);
  });

  it("reports plans when the plan directory exists", async () => {
    const dir = await makeProject();
    await install({ scope: "project", cwd: dir });
    await mkdir(path.join(dir, ".factory", "plans"), { recursive: true });
    await writeFile(path.join(dir, ".factory", "plans", "README.md"), "# Plans\n");

    const result = await doctor({ scope: "project", cwd: dir });
    expect(result.lines.join("\n")).toMatch(/plans:\s+present — 1 markdown file/);
  });

  it("fails when the plugin entry is missing", async () => {
    const dir = await makeProject();
    await install({ scope: "project", cwd: dir });
    await writeFile(
      path.join(dir, "opencode.json"),
      `{\n  "$schema": "https://opencode.ai/config.json"\n}\n`,
    );

    const result = await doctor({ scope: "project", cwd: dir });
    expect(result.ok).toBe(false);
    expect(result.lines.join("\n")).toMatch(/plugin entry missing/);
  });

  it("fails when the context index is missing", async () => {
    const dir = await makeProject();
    await install({ scope: "project", cwd: dir });
    await rm(path.join(dir, ".factory", "context", "navigation.md"));

    const result = await doctor({ scope: "project", cwd: dir });
    expect(result.ok).toBe(false);
    expect(result.lines.join("\n")).toMatch(
      /context:\s+missing \.factory\/context\/navigation\.md/,
    );
  });

  it("skips the context check for global scope", async () => {
    const home = await mkdtemp(path.join(workRoot, "globalhome-"));
    await install({ scope: "global", configHome: home });

    const result = await doctor({ scope: "global", configHome: home });
    expect(result.ok).toBe(true);
    expect(result.lines.join("\n")).toMatch(/project-scoped/);
  });
});
