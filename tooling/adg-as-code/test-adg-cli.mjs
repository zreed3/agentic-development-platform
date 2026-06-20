#!/usr/bin/env node
// Tests for the @adg/cli dispatcher and `adg init` host detection. Exercises the CLI surface
// without performing a real install (init is run with --dry-run against a temp host).
// Run: node tooling/adg-as-code/test-adg-cli.mjs

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { detectClient } from "../../scripts/adg-init.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CLI = path.join(root, "packages/cli/adg.mjs");

let passed = 0;
const ok = (l) => {
  passed += 1;
  console.log(`  ok ${l}`);
};

function cli(args) {
  const res = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8" });
  return { status: res.status, out: res.stdout || "", err: res.stderr || "" };
}

// -- help / unknown ----------------------------------------------------------
let r = cli([]);
assert.ok(/Usage: adg/.test(r.out), "no args prints usage");
assert.equal(r.status, 0);
ok("adg with no args prints usage");

r = cli(["help"]);
assert.ok(/classify/.test(r.out) && /models/.test(r.out) && /doctor/.test(r.out));
ok("adg help lists the command map");

r = cli(["frobnicate"]);
assert.equal(r.status, 2);
assert.ok(/unknown command/.test(r.err));
ok("adg rejects an unknown command (exit 2)");

// -- dispatch reaches a real script ------------------------------------------
r = cli(["tiers"]);
assert.ok(/economy|frontier-reasoning/.test(r.out), "tiers dispatched to the model script");
ok("adg tiers dispatches to the model orchestrator");

r = cli(["models", "--lane", "L3", "--risk", "secrets", "--format", "json"]);
assert.ok(/frontier-reasoning/.test(r.out), "models dispatched + selected a tier");
ok("adg models --lane L3 --risk secrets selects frontier");

// -- host detection (pure) ---------------------------------------------------
const T = path.join(os.tmpdir(), "adg-cli-detect");
fs.rmSync(T, { recursive: true, force: true });
fs.mkdirSync(T, { recursive: true });
assert.equal(detectClient(T), "claude", "empty repo defaults to claude");
fs.writeFileSync(path.join(T, "AGENTS.md"), "# agents");
assert.equal(detectClient(T), "codex", "AGENTS.md -> codex");
fs.mkdirSync(path.join(T, ".claude"));
assert.equal(detectClient(T), "both", ".claude + AGENTS.md -> both");
fs.rmSync(T, { recursive: true, force: true });
ok("detectClient resolves claude / codex / both from disk");

console.log(`\nadg cli: ${passed} checks passed`);
