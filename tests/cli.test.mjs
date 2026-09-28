import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.resolve(here, "..", "dist", "cli.js");

function runWith(runtime, args) {
  return spawnSync(runtime, [cli, ...args], { encoding: "utf8" });
}

function which(binary) {
  const result = spawnSync("which", [binary], { encoding: "utf8" });

  return result.status === 0 ? result.stdout.trim() : undefined;
}

describe("packaged CLI runtime compatibility", () => {
  it("builds a dist/cli.js that exists and is executable via an interpreter", () => {
    expect(existsSync(cli)).toBe(true);
  });

  it("runs --version under Bun and prints the package version", () => {
    const bun = which("bun");
    expect(bun).toBeDefined();

    const result = runWith(bun, ["--version"]);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("0.1.0");
  });

  it("runs --version under Node when Node is available", () => {
    const node = which("node");

    if (!node) {
      // The packaged CLI must run on Node, but the dev machine can be Bun-only.
      return;
    }

    const result = runWith(node, ["--version"]);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("0.1.0");
  });

  it("runs a real install under Node when Node is available", () => {
    const node = which("node");

    if (!node) {
      return;
    }

    const dir = mkdtempSync(path.join(os.tmpdir(), "factory-cli-runtime-"));

    const result = runWith(node, ["install", "--dry-run", "--cwd", dir]);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/dry run: nothing written/);
    expect(result.stdout).toMatch(/\.opencode\/agents\/foreman\.md/);
    expect(result.stdout).toMatch(/\.opencode\/skills\/improve\/SKILL\.md/);
    expect(result.stdout).toMatch(/\.factory\/context\/navigation\.md/);
  });
});
