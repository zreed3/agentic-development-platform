#!/usr/bin/env node
// `adg init` — zero-onboarding install for a host repo.
//
// The growth lesson from tools that spread fast (e.g. magicpath): meet the user inside a host
// they already run, prove value in one action, no docs-first onboarding. So init: detects the
// host, installs the deterministic guard, then runs ONE real classification on the user's own
// changes so the first thing they see is value, not config.
//
//   node scripts/adg-init.mjs [--target DIR] [--client claude|codex|both] [--dry-run]
//
// Exported helpers are pure for testing; the CLI flow shells the existing, tested scripts.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function parseArgs(argv) {
  const out = { values: {}, flags: new Set() };
  for (let i = 0; i < argv.length; i += 1) {
    const t = argv[i];
    if (!t.startsWith("--")) continue;
    const key = t.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      out.values[key] = next;
      i += 1;
    } else {
      out.flags.add(key);
    }
  }
  return out;
}

// Detect which deterministic client layer a host wants, from what already exists on disk.
export function detectClient(targetRoot) {
  const has = (p) => {
    try {
      return fs.existsSync(path.join(targetRoot, p));
    } catch {
      return false;
    }
  };
  const claude = has(".claude") || has("CLAUDE.md");
  const codex = has(".codex") || has("AGENTS.md");
  if (claude && codex) return "both";
  if (codex) return "codex";
  if (claude) return "claude";
  return "claude"; // safe default: the most common host
}

function sh(file, args, cwd) {
  return spawnSync(process.execPath, [path.join(repoRoot, file), ...args], {
    cwd: cwd || process.cwd(),
    encoding: "utf8",
  });
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const target = path.resolve(args.values.target || process.cwd());
  const client = args.values.client || detectClient(target);
  const dryRun = args.flags.has("dry-run");

  process.stdout.write(`ADG init\n  target:  ${target}\n  client:  ${client} (detected: ${detectClient(target)})\n  dry-run: ${dryRun}\n\n`);

  // 1. Install the deterministic guard (delegates to the tested installer).
  const installArgs = ["install", "--target", target, "--client", client];
  if (dryRun) installArgs.push("--dry-run");
  process.stdout.write("→ installing deterministic guard…\n");
  const inst = sh("scripts/adg-install.mjs", installArgs);
  process.stdout.write(`${(inst.stdout || "").trim()}\n`);
  if (inst.status !== 0) {
    process.stderr.write(`${(inst.stderr || "install failed").trim()}\n`);
    process.exit(inst.status || 1);
  }

  // 2. Prove value: classify the user's actual pending changes (or a sample intent).
  process.stdout.write("\n→ classifying your current changes (the value proof)…\n");
  const hasChanges = (() => {
    try {
      const g = spawnSync("git", ["-C", target, "status", "--porcelain"], { encoding: "utf8" });
      return Boolean((g.stdout || "").trim());
    } catch {
      return false;
    }
  })();
  const classifyArgs = hasChanges
    ? ["classify", "--changed", "--format", "markdown"]
    : ["classify", "--intent", "set up ADG governance in this repo", "--format", "markdown"];
  const cls = sh("scripts/adg-work-classify.mjs", classifyArgs, target);
  process.stdout.write(`${(cls.stdout || cls.stderr || "").trim()}\n`);

  // 3. Next steps.
  process.stdout.write(
    "\n✓ ADG installed. Next:\n" +
      "  • npm run adg:classify -- --intent \"<what you're about to do>\"   (pick a lane)\n" +
      "  • the deterministic guard now gates destructive/sensitive tool calls\n" +
      "  • npm run adg:doctor   (verify the install hasn't drifted)\n",
  );
  process.exit(0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
