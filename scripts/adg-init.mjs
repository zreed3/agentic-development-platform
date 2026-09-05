#!/usr/bin/env node
// Fresh projects start with Git/Markdown. Governed adoption remains explicit;
// existing installations retain their profile and recorded client.
//   node scripts/adg-init.mjs [--target DIR] [--profile native|governed]
//     [--client base|claude|codex|both] [--dry-run]
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

function exists(file) {
  try { fs.lstatSync(file); return true; } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

function nativeInit(target, client, dryRun) {
  const files = [["AGENTS.md", "# Project instructions\n\n" +
    "- Read the relevant code and repository documentation before editing.\n" +
    "- Preserve existing work and keep changes scoped to the requested task.\n" +
    "- Use the agent runtime's permissions and run focused application checks.\n" +
    "- Keep durable decisions and handoff notes in Markdown and reviewed Git history.\n" +
    "- Report what changed, the checks run, and remaining limitations.\n"]];
  if (["claude", "both"].includes(client)) files.push(["CLAUDE.md", "# Project instructions\n\n@AGENTS.md\n"]);
  // Validate all destinations before creating anything, including broken links.
  for (const [name] of files) {
    const file = path.join(target, name);
    if (exists(file) && (!fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink())) {
      throw new Error(`Refusing non-file or symlink destination: ${name}`);
    }
  }
  for (const [name, content] of files) {
    const file = path.join(target, name);
    if (exists(file)) process.stdout.write(`preserved: ${name}\n`);
    else {
      if (!dryRun) fs.writeFileSync(file, content, { flag: "wx" });
      process.stdout.write(`${dryRun ? "would create" : "created"}: ${name}\n`);
    }
  }
  process.stdout.write("\nNative profile: maintain project instructions in Git and use focused application CI.\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.flags.has("help")) {
    console.log("Usage: adg init [--target DIR] [--profile native|governed] [--client base|claude|codex|both] [--dry-run]\nFresh projects default to native. Existing installations retain governance.");
    return;
  }
  for (const key of ["target", "profile", "client"]) {
    if (args.flags.has(key)) throw new Error(`--${key} requires a value`);
  }
  const target = path.resolve(args.values.target || process.cwd());
  if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) throw new Error("Target must be an existing directory");
  const stateFile = path.join(target, "config/agentic/adg-install-state.json");
  const installed = exists(stateFile);
  const state = installed ? JSON.parse(fs.readFileSync(stateFile, "utf8")) : null;
  if (installed && (!state || !Array.isArray(state.files))) throw new Error("Malformed ADG install state");
  const profile = args.values.profile || (installed ? "governed" : "native");
  if (!["native", "governed"].includes(profile)) throw new Error("--profile must be native or governed");
  const client = args.values.client || state?.client || detectClient(target);
  if (!["base", "claude", "codex", "both"].includes(client)) throw new Error("--client must be base, claude, codex, or both");
  const dryRun = args.flags.has("dry-run");

  if (profile === "native") {
    // Legacy/partial installations also require a context-preserving retirement.
    const governed = installed || ["config/agentic/guardrails.json", "scripts/adg-guardrail-hook.mjs"].some(file => exists(path.join(target, file)));
    if (governed) throw new Error("Existing ADG governance cannot become native through init; use adg:retire to preserve context first, or --profile governed.");
    process.stdout.write(`ADG init\n  target: ${target}\n  profile: native\n  client: ${client}\n  dry-run: ${dryRun}\n\n`);
    nativeInit(target, client, dryRun);
    return;
  }

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
  if (dryRun) return;

  // 2. Smoke-check classification on pending changes (or a sample intent).
  process.stdout.write("\n→ classifying your current changes (classification smoke check)…\n");
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
      "  • npm run adg:classify -- --intent \"<what you're about to do>\"   (record your lane call; advisory second opinion)\n" +
      "  • the deterministic guard now gates destructive/sensitive tool calls\n" +
      "  • npm run adg:doctor   (verify the install hasn't drifted)\n",
  );
  process.exit(0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) {
    console.error(`ADG init: ${error.message}`);
    process.exitCode = 1;
  }
}
