#!/usr/bin/env node
// The packaged CLI is runtime-agnostic: it runs on Node.js 20+ and on Bun
// (bunx executes it directly). Development tooling (build, tests, lint,
// format) is Bun-first; see package.json scripts.
import process from "node:process";

import {
  doctor,
  InstallerError,
  type InstallerOptions,
  install,
  type Report,
  type Scope,
  uninstall,
  update,
} from "./installer.js";

interface ParsedArgs {
  command: string;
  scope: Scope;
  cwd?: string;
  configHome?: string;
  dryRun: boolean;
  force: boolean;
}

const HELP = `ocf — opencode-factory agent pack installer

Usage:
  ocf install [--project | --global] [--cwd <dir>] [--dry-run] [--force]
  ocf update  [--project | --global] [--cwd <dir>] [--dry-run] [--force]
  ocf uninstall [--project | --global] [--cwd <dir>] [--dry-run]
  ocf doctor  [--project | --global] [--cwd <dir>]

Commands:
  install    Copy the agent/command pack and register the plugin (default: project scope)
  update     Idempotent re-install; updates pack-owned files and preserves user edits
  uninstall  Remove manifest-owned files and the plugin entry; never touches unrelated config
  doctor     Report whether the pack, plugin entry, and context index are in place

Flags:
  --project        Install into ./.opencode next to this project (default)
  --global         Install into the global config home (XDG_CONFIG_HOME/opencode or ~/.config/opencode)
  --cwd <dir>      Project directory for --project (default: current working directory)
  --config-home <dir>  Override the global config home (useful for testing)
  --dry-run        Print what would change and write nothing
  --force          Replace existing non-owned files (a backup is written first)
  -h, --help       Show this help
  -v, --version    Show the package version
`;

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    command: "help",
    scope: "project",
    dryRun: false,
    force: false,
  };
  const positionals: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? "";

    switch (arg) {
      case "--global":
      case "-g":
        parsed.scope = "global";
        break;
      case "--project":
        parsed.scope = "project";
        break;
      case "--dry-run":
        parsed.dryRun = true;
        break;
      case "--force":
        parsed.force = true;
        break;
      case "--cwd": {
        index += 1;
        parsed.cwd = argv[index];
        break;
      }
      case "--config-home": {
        index += 1;
        parsed.configHome = argv[index];
        break;
      }
      case "-h":
      case "--help":
        parsed.command = "help";
        return parsed;
      case "-v":
      case "--version":
        parsed.command = "version";
        return parsed;
      default:
        if (arg.startsWith("-")) {
          throw new InstallerError(`Unknown flag: ${arg}`);
        }
        positionals.push(arg);
    }
  }

  const command = positionals[0];

  if (command !== undefined) {
    if (!["install", "update", "uninstall", "doctor"].includes(command)) {
      throw new InstallerError(`Unknown command: ${command}`);
    }

    parsed.command = command;
  }

  return parsed;
}

const SYMBOLS: Record<string, string> = {
  write: "+",
  config: "~",
  remove: "-",
  keep: "=",
  skip: "·",
  note: "·",
};

function printReport(report: Report, applied: boolean): void {
  console.log(`target: ${report.target}`);

  if (report.actions.length === 0) {
    console.log("no changes needed");
  }

  for (const action of report.actions) {
    const symbol = SYMBOLS[action.kind] ?? "?";
    const detail = action.detail ? ` (${action.detail})` : "";

    console.log(`  ${symbol} ${action.kind.padEnd(6)} ${action.file}${detail}`);
  }

  if (report.preview.length > 0) {
    console.log("config diff:");
    for (const line of report.preview) {
      console.log(line);
    }
  }

  console.log(applied ? "applied" : "dry run: nothing written");
}

async function run(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));

  if (args.command === "help") {
    console.log(HELP);

    return 0;
  }

  if (args.command === "version") {
    const { readFile } = await import("node:fs/promises");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const here = path.dirname(fileURLToPath(import.meta.url));
    const raw = await readFile(path.resolve(here, "..", "package.json"), "utf8");
    const pkg = JSON.parse(raw) as { version?: string };
    console.log(pkg.version ?? "unknown");

    return 0;
  }

  const options: InstallerOptions = {
    scope: args.scope,
    cwd: args.cwd,
    configHome: args.configHome,
    dryRun: args.dryRun,
    force: args.force,
  };

  if (args.command === "doctor") {
    const result = await doctor(options);

    for (const line of result.lines) {
      console.log(line);
    }

    return result.ok ? 0 : 1;
  }

  const preview = args.dryRun
    ? undefined
    : await runOnce(args.command, { ...options, dryRun: true });
  const applied = await runOnce(args.command, options);

  if (preview) {
    printReport(preview, false);
    console.log("");
  }

  printReport(applied, !args.dryRun);

  return 0;
}

async function runOnce(command: string, options: InstallerOptions): Promise<Report> {
  switch (command) {
    case "install":
      return install(options);
    case "update":
      return update(options);
    case "uninstall":
      return uninstall(options);
    default:
      throw new InstallerError(`Unknown command: ${command}`);
  }
}

run()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    if (error instanceof InstallerError) {
      console.error(`error: ${error.message}`);
      process.exitCode = 2;

      return;
    }

    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    process.exitCode = 1;
  });
