import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { inspectContext, MAX_OUTPUT_CHARS, readContext } from "../dist/context.js";

let root;

async function makeContext(files) {
  await mkdir(path.join(root, ".factory", "context", "patterns"), { recursive: true });

  for (const [relative, content] of Object.entries(files)) {
    const absolute = path.join(root, ".factory", "context", relative);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, content);
  }
}

async function makeIndex(content) {
  await writeFile(path.join(root, ".factory", "context", "navigation.md"), content);
}

function read(query) {
  return readContext({
    contextDir: path.join(root, ".factory", "context"),
    query,
    indexLabel: ".factory/context/navigation.md",
    displayRoot: root,
  });
}

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "factory-context-"));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("readContext", () => {
  it("returns an honest empty state when the index is missing", async () => {
    const scratch = await mkdtemp(path.join(os.tmpdir(), "factory-context-missing-"));
    const result = await readContext({
      contextDir: path.join(scratch, ".factory", "context"),
      query: "anything",
      indexLabel: ".factory/context/navigation.md",
      displayRoot: scratch,
    });

    expect(result.metadata.found).toBe(false);
    expect(result.content).toMatch(/No project context index found/);
    await rm(scratch, { recursive: true, force: true });
  });

  it("recommends verified files and ranks by query relevance", async () => {
    await makeContext({
      "patterns/alpha.md": "# Alpha\n\nAll about widgets.\n",
      "patterns/beta.md": "# Beta\n\nAll about sprockets.\n",
    });
    await makeIndex("- [Alpha note](patterns/alpha.md)\n- [Beta note](patterns/beta.md)\n");

    const result = await read("sprockets");
    expect(result.metadata.found).toBe(true);
    expect(result.metadata.verified).toBe(2);

    const betaIndex = result.content.indexOf("beta.md");
    const alphaIndex = result.content.indexOf("alpha.md");
    expect(betaIndex).toBeGreaterThanOrEqual(0);
    expect(alphaIndex).toBeGreaterThanOrEqual(0);
    expect(betaIndex).toBeLessThan(alphaIndex);
  });

  it("reports missing files without recommending them", async () => {
    await makeContext({ "patterns/alpha.md": "# Alpha\n" });
    await makeIndex("- [Alpha](patterns/alpha.md)\n- [Gone](patterns/gone.md)\n");

    const result = await read("alpha");
    expect(result.metadata.verified).toBe(1);
    expect(result.metadata.skipped).toBe(1);
    expect(result.content).toMatch(/gone\.md — missing file/);
  });

  it("rejects traversal, absolute paths, and external URLs", async () => {
    await makeIndex(
      [
        "- [Traversal](../../../../etc/passwd)",
        "- [Absolute](/etc/hosts)",
        "- [External](https://example.com/x.md)",
        "- [Scheme](file:///etc/hosts)",
      ].join("\n"),
    );

    const result = await read("x");
    expect(result.metadata.verified).toBe(0);
    expect(result.metadata.skipped).toBe(4);
    expect(result.content).toMatch(/escapes the context directory/);
    expect(result.content).toMatch(/absolute, external, or unsafe reference/);
  });

  it("rejects symlinks that escape the context directory", async () => {
    const outside = await mkdtemp(path.join(os.tmpdir(), "factory-context-outside-"));
    const secret = path.join(outside, "secret.md");
    await writeFile(secret, "top secret\n");

    await makeContext({});
    await symlink(secret, path.join(root, ".factory", "context", "patterns", "escape.md"));
    await makeIndex("- [Escape](patterns/escape.md)");

    const result = await read("escape");
    expect(result.metadata.verified).toBe(0);
    expect(result.content).toMatch(/symlink escapes the context directory/);

    await rm(outside, { recursive: true, force: true });
  });

  it("allows symlinks that stay inside the context directory", async () => {
    await makeContext({ "patterns/alpha.md": "# Alpha\nwidget content\n" });
    const alias = path.join(root, ".factory", "context", "patterns", "alias.md");
    await rm(alias, { force: true });
    await symlink(path.join(root, ".factory", "context", "patterns", "alpha.md"), alias);
    await makeIndex("- [Alias](patterns/alias.md)");

    const result = await read("widget");
    expect(result.metadata.verified).toBe(1);
    expect(result.content).toMatch(/alpha\.md/);
  });

  it("ignores links inside HTML comments", async () => {
    await makeContext({ "patterns/alpha.md": "# Alpha\n" });
    await makeIndex(
      "- [Alpha](patterns/alpha.md)\n<!-- example: - [Build](patterns/build.md) -->\n",
    );

    const result = await read("alpha");
    expect(result.metadata.verified).toBe(1);
    expect(result.metadata.skipped).toBe(0);
    expect(result.content).not.toMatch(/build\.md/);
  });

  it("bounds the output for large indexes and large files", async () => {
    await makeContext({ "patterns/big.md": "x".repeat(100_000) });
    const links = ["[Big](patterns/big.md)"];

    for (let index = 0; index < 200; index += 1) {
      links.push(`[Link ${index}](patterns/missing-${index}.md)`);
    }

    await makeIndex(links.join("\n"));

    const result = await read("big");
    expect(result.content.length).toBeLessThanOrEqual(MAX_OUTPUT_CHARS + 32);
    expect(result.content).toMatch(/truncated|more verified|more\./);
  });
});

describe("inspectContext", () => {
  it("classifies every reference for the doctor command", async () => {
    await makeContext({ "patterns/alpha.md": "# Alpha\n" });
    await makeIndex(
      [
        "- [Alpha](patterns/alpha.md)",
        "- [Gone](patterns/gone.md)",
        "- [Absolute](/etc/hosts)",
        "- [Dir](patterns)",
      ].join("\n"),
    );

    const inspection = await inspectContext({
      contextDir: path.join(root, ".factory", "context"),
      indexLabel: ".factory/context/navigation.md",
      displayRoot: root,
    });
    expect(inspection.indexFound).toBe(true);

    const statuses = Object.fromEntries(
      inspection.entries.map((entry) => [entry.ref, entry.status]),
    );
    expect(statuses["patterns/alpha.md"]).toBe("ok");
    expect(statuses["patterns/gone.md"]).toBe("missing");
    expect(statuses["/etc/hosts"]).toBe("rejected");
    expect(statuses.patterns).toBe("not-file");
  });
});
