#!/usr/bin/env node
// Tests for the dispatcher and native/governed init against isolated temporary hosts.
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
const T = fs.mkdtempSync(path.join(os.tmpdir(), "adg-cli-detect-"));
assert.equal(detectClient(T), "claude", "empty repo defaults to claude");
fs.writeFileSync(path.join(T, "AGENTS.md"), "# agents");
assert.equal(detectClient(T), "codex", "AGENTS.md -> codex");
fs.mkdirSync(path.join(T, ".claude"));
assert.equal(detectClient(T), "both", ".claude + AGENTS.md -> both");
fs.rmSync(T, { recursive: true, force: true });
ok("detectClient resolves claude / codex / both from disk");

const host = fs.mkdtempSync(path.join(os.tmpdir(), "adg-cli-init-"));
try {
  r = cli(["init", "--target", host, "--client", "both", "--dry-run"]);
  assert.equal(r.status, 0, r.err);
  assert.deepEqual(fs.readdirSync(host), [], "dry run creates nothing");
  assert.doesNotMatch(r.out, /classifying/);
  ok("native dry run has no filesystem or classification side effects");

  r = cli(["init", "--target", host, "--client", "both"]);
  assert.equal(r.status, 0, r.err);
  assert.deepEqual(fs.readdirSync(host).sort(), ["AGENTS.md", "CLAUDE.md"]);
  assert.match(fs.readFileSync(path.join(host, "CLAUDE.md"), "utf8"), /@AGENTS\.md/);
  assert.doesNotMatch(r.out, /classifying|installing deterministic/);
  ok("fresh native init creates only Markdown instructions and Claude adapter");

  fs.writeFileSync(path.join(host, "AGENTS.md"), "# Host rules\nKeep tenant isolation.\n");
  fs.writeFileSync(path.join(host, "CLAUDE.md"), "# Claude notes\nKeep existing instructions.\n");
  r = cli(["init", "--target", host, "--client", "both"]);
  assert.equal(r.status, 0, r.err);
  assert.equal(fs.readFileSync(path.join(host, "AGENTS.md"), "utf8"), "# Host rules\nKeep tenant isolation.\n");
  assert.equal(fs.readFileSync(path.join(host, "CLAUDE.md"), "utf8"), "# Claude notes\nKeep existing instructions.\n");
  ok("native reinit preserves customized instruction files exactly");

  fs.unlinkSync(path.join(host, "AGENTS.md"));
  fs.unlinkSync(path.join(host, "CLAUDE.md"));
  fs.symlinkSync(path.join(host, "missing"), path.join(host, "CLAUDE.md"));
  r = cli(["init", "--target", host, "--client", "both"]);
  assert.equal(r.status, 1);
  assert.match(r.err, /symlink/);
  assert.equal(fs.existsSync(path.join(host, "AGENTS.md")), false, "preflight before any writes");
  fs.unlinkSync(path.join(host, "CLAUDE.md"));
  ok("native rejects broken symlink destinations before writing any instructions");

  for (const args of [["--profile", "unknown"], ["--client", "unknown"], ["--profile"]]) {
    r = cli(["init", "--target", host, ...args]);
    assert.equal(r.status, 1);
    assert.deepEqual(fs.readdirSync(host), []);
  }
  ok("invalid native arguments fail without side effects");

  r = cli(["init", "--target", host, "--profile", "governed", "--client", "base", "--dry-run"]);
  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /installing deterministic guard/);
  assert.deepEqual(fs.readdirSync(host), []);
  ok("explicit governed dry run retains installer and does not classify or write");

  r = cli(["init", "--target", host, "--profile", "governed", "--client", "base"]);
  assert.equal(r.status, 0, r.err);
  const stateFile = path.join(host, "config/agentic/adg-install-state.json");
  assert.equal(JSON.parse(fs.readFileSync(stateFile, "utf8")).client, "base");
  r = cli(["init", "--target", host, "--dry-run"]);
  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /installing deterministic guard/);
  assert.match(r.out, /client:  base/);
  const originalState = fs.readFileSync(stateFile, "utf8");
  r = cli(["init", "--target", host, "--profile", "native"]);
  assert.equal(r.status, 1);
  assert.match(r.err, /adg:retire/);
  assert.equal(fs.readFileSync(stateFile, "utf8"), originalState);
  ok("existing governed init retains recorded client and refuses native downgrade");

  const retired = fs.mkdtempSync(path.join(os.tmpdir(), "adg-cli-retired-"));
  try {
    fs.mkdirSync(path.join(retired, "data"));
    fs.writeFileSync(path.join(retired, "data/backlog.sqlite"), "preserved original database");
    fs.writeFileSync(path.join(retired, "AGENTS.md"), "# Retired ADG\nSee preserved history.\n");
    r = cli(["init", "--target", retired, "--client", "codex"]);
    assert.equal(r.status, 0, r.err);
    assert.equal(fs.readFileSync(path.join(retired, "data/backlog.sqlite"), "utf8"), "preserved original database");
    assert.equal(fs.readFileSync(path.join(retired, "AGENTS.md"), "utf8"), "# Retired ADG\nSee preserved history.\n");
    ok("native init permits preserved retired history without deleting it");
  } finally { fs.rmSync(retired, { recursive: true, force: true }); }
} finally {
  fs.rmSync(host, { recursive: true, force: true });
}

console.log(`\nadg cli: ${passed} checks passed`);
