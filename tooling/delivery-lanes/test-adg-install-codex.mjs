#!/usr/bin/env node
// Tests for the Codex client install and the merge-aware policy update.
// Proves: --client codex/both ship the single policy source + companions + the shared
// hook; the Codex adapter resolves the host hook after install (and blocks rm -rf); a
// routine adg:update preserves a host's governed toggle and never carries a relaxed
// always-on forward; --force-policy re-baselines.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const INSTALL = path.join(sourceRoot, "scripts/adg-install.mjs");

function run(args, opts = {}) {
  return spawnSync(process.execPath, [INSTALL, ...args], { encoding: "utf8", ...opts });
}
function readPolicy(root) {
  return JSON.parse(fs.readFileSync(path.join(root, "config/agentic/guardrails.json"), "utf8"));
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "adg-codex-install-"));
spawnSync("git", ["-C", tmp, "init", "-q"]);
fs.writeFileSync(path.join(tmp, "package.json"), JSON.stringify({ name: "host", version: "0.0.0", scripts: {} }, null, 2));
fs.writeFileSync(path.join(tmp, "AGENTS.md"), "# Host\n## Project\nTest host.\n");
spawnSync("git", ["-C", tmp, "add", "-A"]);
spawnSync("git", ["-C", tmp, "commit", "-qm", "init"]);

let passed = 0;
const check = (label, cond) => { assert.ok(cond, label); passed += 1; };

// 1. install --client both ships policy + companions + both adapters
const res = run(["install", "--target", tmp, "--client", "both", "--format", "json"]);
check("install --client both exits 0", res.status === 0);
for (const f of [
  "config/agentic/guardrails.json",
  "scripts/adg-guardrail-hook.mjs",
  "scripts/adg-codex-pretool.mjs",
  "scripts/guardrail-check.mjs",
  "scripts/adg-toggle-control.mjs",
  "scripts/audit-chain.mjs",
  "scripts/record-audit.mjs",
  "scripts/validate-audit.mjs",
]) {
  check(`installed ${f}`, fs.existsSync(path.join(tmp, f)));
}

// 2. the Codex adapter resolves the HOST hook and blocks a destructive command
const codex = spawnSync(process.execPath, [path.join(tmp, "scripts/adg-codex-pretool.mjs")], {
  input: JSON.stringify({ tool_name: "Bash", tool_input: { command: "rm -rf /" } }),
  encoding: "utf8",
  cwd: tmp,
});
check("Codex adapter resolves the host hook and blocks rm -rf (exit 2)", codex.status === 2);

// 3. host governed-disable, then update preserves it and pins always-on
fs.mkdirSync(path.join(tmp, "data/audit"), { recursive: true });
const toggle = spawnSync(process.execPath, [path.join(tmp, "scripts/adg-toggle-control.mjs"), "--control", "billingConfirm", "--set", "off", "--reason", "host CI", "--risk", "none", "--rollback", "--set on"], { cwd: tmp, encoding: "utf8" });
check("host governed toggle succeeds", toggle.status === 0 && readPolicy(tmp).controls.definitions.billingConfirm.enabled === false);

// tamper an always-on control directly, to prove update restores it
const tampered = readPolicy(tmp);
tampered.controls.definitions.destructiveDeny.enabled = false;
fs.writeFileSync(path.join(tmp, "config/agentic/guardrails.json"), JSON.stringify(tampered, null, 2));

run(["update", "--target", tmp, "--client", "both", "--format", "json"]);
const afterUpdate = readPolicy(tmp);
check("update preserves the host's governed toggle (billingConfirm stays disabled)", afterUpdate.controls.definitions.billingConfirm.enabled === false);
check("update restores a relaxed always-on control (destructiveDeny back to enabled)", afterUpdate.controls.definitions.destructiveDeny.enabled === true);
check("update preserves toggleHistory", Array.isArray(afterUpdate.controls.toggleHistory) && afterUpdate.controls.toggleHistory.length >= 1);

// 4. --force-policy re-baselines to source (host toggle reset to enabled default)
run(["update", "--target", tmp, "--client", "both", "--force-policy", "--format", "json"]);
check("--force-policy re-baselines billingConfirm to the source default (enabled)", readPolicy(tmp).controls.definitions.billingConfirm.enabled === true);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`adg:install --client codex/both: ${passed}/${passed} checks passed`);
