#!/usr/bin/env node
// Test the harness-neutral lifecycle adapters (stop -> governor, post-tool -> backpressure):
// each must reproduce the shared hook's decision and emit the uniform contract shape.
// Run: npm run test:adg-codex-lifecycle

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const STOP = path.join(dir, "adg-codex-stop.mjs");
const POST = path.join(dir, "adg-codex-posttool.mjs");

// A crafted repo whose release_gate_violations view returns one row -> governor blocks.
import fs from "node:fs";
import os from "node:os";
const T = path.join(os.tmpdir(), "adg-codex-lifecycle-test");
fs.rmSync(T, { recursive: true, force: true });
fs.mkdirSync(path.join(T, "data"), { recursive: true });
fs.mkdirSync(path.join(T, "config/agentic"), { recursive: true });
spawnSync("sqlite3", [path.join(T, "data/backlog.sqlite"), "CREATE VIEW release_gate_violations AS SELECT 'S99-T1' AS item_id, 'deploy' AS release_classes;"]);
fs.writeFileSync(path.join(T, "config/agentic/loop-budget.json"), JSON.stringify({ caps: { maxTurns: 60 }, releaseGate: { mode: "block" } }));

function run(adapter, event, cwd) {
  const res = spawnSync(process.execPath, [adapter], { input: JSON.stringify(event), encoding: "utf8", cwd: cwd || process.cwd() });
  let out = {};
  try {
    out = JSON.parse(res.stdout || "{}");
  } catch {
    out = {};
  }
  return { status: res.status, ...out };
}

let passed = 0;
const ok = (l) => {
  passed += 1;
  console.log(`  ok ${l}`);
};

// -- stop adapter: blocks on a violation, allows when clean ------------------
let r = run(STOP, { stop_hook_active: false }, T);
assert.equal(r.decision, "block", "violation -> block");
assert.equal(r.status, 2, "block exits 2");
assert.ok(/S99-T1/.test(r.reason || ""), "reason names the item");
ok("stop adapter blocks turn-end on a release-gate violation (exit 2)");

r = run(STOP, { stopHookActive: true }, T); // camelCase alias + active -> yield
assert.equal(r.decision, "allow");
assert.equal(r.status, 0);
ok("stop adapter yields on stop_hook_active (camelCase normalized)");

r = run(STOP, {}, process.cwd()); // no violations in the real repo (or fail-open)
assert.equal(r.decision, "allow");
ok("stop adapter allows when clean / fails open");

// -- post-tool adapter: surfaces a failed verification command --------------
r = run(POST, { tool_name: "Bash", tool_input: { command: "npm run test" }, tool_response: { exit_code: 1 } }, process.cwd());
assert.equal(r.decision, "observe", "failed check -> observe");
assert.ok(/backpressure/.test(r.context || ""), "context carries the observation");
ok("post-tool adapter surfaces a failed verification command");

r = run(POST, { name: "shell", arguments: { command: "npm run test" }, result: { exit_code: 0 } }, process.cwd());
assert.equal(r.decision, "allow", "passing check -> allow (field aliases normalized)");
ok("post-tool adapter allows a passing check (name/arguments/result aliases)");

fs.rmSync(T, { recursive: true, force: true });
console.log(`\nadg codex lifecycle adapters: ${passed} checks passed`);
