#!/usr/bin/env node
// Negative tests for ADG toggleable controls. Proves the governed-toggle contract:
//   1. Toggling a control is logged (append-only audit decision event) and a disabled
//      control is then honored by the deterministic hook (the gate stops asking).
//   2. Re-enabling the control makes the hook block/ask again.
//   3. Always-on controls (destructive deny, audit append-only, forbidden-bulk read)
//      cannot be disabled: the governed toggle refuses them, a hand-edit that relaxes
//      them fails guardrail-check, and the hook ignores the config and still blocks.
//
// Hermetic: operates on a temp copy of the policy (ADG_GUARDRAILS_PATH) and a temp
// audit log (ADG_AUDIT_LOG_PATH); never mutates the real policy or audit log.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const HOOK = path.join(root, "plugins/adg-governance/hooks/adg-guardrail-hook.mjs");
const TOGGLE = path.join(root, "scripts/adg-toggle-control.mjs");
const CHECK = path.join(root, "scripts/guardrail-check.mjs");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "adg-toggles-"));
const policy = path.join(tmp, "guardrails.json");
const auditLog = path.join(tmp, "audit-log.jsonl");
fs.copyFileSync(path.join(root, "config/agentic/guardrails.json"), policy);
fs.writeFileSync(auditLog, "");

function hook(event, env = {}) {
  const res = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(event), encoding: "utf8", env: { ...process.env, ...env } });
  let decision = null;
  try { decision = res.stdout ? JSON.parse(res.stdout).hookSpecificOutput?.permissionDecision ?? null : null; } catch { decision = null; }
  return { code: res.status, decision };
}

function toggle(args, env = {}) {
  const res = spawnSync(process.execPath, [TOGGLE, ...args], { encoding: "utf8", env: { ...process.env, ADG_GUARDRAILS_PATH: policy, ADG_AUDIT_LOG_PATH: auditLog, ...env } });
  return { code: res.status, stdout: res.stdout, stderr: res.stderr };
}

function auditCount() {
  return fs.readFileSync(auditLog, "utf8").trim().split("\n").filter(Boolean).length;
}

const gitPush = { tool_name: "Bash", tool_input: { command: "git push origin main" } };
const rmrf = { tool_name: "Bash", tool_input: { command: "rm -rf /" } };

let passed = 0;
function check(label, cond) {
  assert.ok(cond, label);
  passed += 1;
}

// -- 1. baseline: productionConfirm enabled -> git push asks ------------------
check("baseline: git push asks while productionConfirm enabled", hook(gitPush, { ADG_GUARDRAILS_PATH: policy }).decision === "ask");

// -- 2. governed toggle off is audited (logged) ------------------------------
const before = auditCount();
const off = toggle(["--control", "productionConfirm", "--set", "off", "--reason", "CI deploy context", "--risk", "prod pushes wont prompt", "--rollback", "--set on"]);
check("governed toggle off exits 0", off.code === 0);
check("toggle off writes exactly one append-only audit event (logged)", auditCount() === before + 1);
const lastEvent = JSON.parse(fs.readFileSync(auditLog, "utf8").trim().split("\n").filter(Boolean).at(-1));
check("audit event is a decision with reason/risk/rollback", lastEvent.eventType === "decision" && /reason:/.test(lastEvent.details) && /risk:/.test(lastEvent.details) && /rollback:/.test(lastEvent.details));

// -- 3. disabled control is honored: git push now allowed --------------------
check("disabled productionConfirm: git push is now allowed (exit 0, no ask)", (() => { const r = hook(gitPush, { ADG_GUARDRAILS_PATH: policy }); return r.code === 0 && r.decision === null; })());

// -- 4. re-enable -> git push asks again -------------------------------------
const on = toggle(["--control", "productionConfirm", "--set", "on", "--reason", "restore default", "--risk", "none", "--rollback", "--set off"]);
check("governed toggle on exits 0", on.code === 0);
check("re-enabled productionConfirm: git push asks again", hook(gitPush, { ADG_GUARDRAILS_PATH: policy }).decision === "ask");
check("re-enable is also audited", auditCount() === before + 2);

// -- 5. always-on controls cannot be disabled --------------------------------
const alwaysOff = toggle(["--control", "destructiveDeny", "--set", "off", "--reason", "x", "--risk", "y", "--rollback", "z"]);
check("governed toggle refuses an always-on control (exit 3)", alwaysOff.code === 3);

// hand-edit that relaxes an always-on control must fail guardrail-check
const tampered = path.join(tmp, "tampered.json");
const j = JSON.parse(fs.readFileSync(policy, "utf8"));
j.controls.definitions.destructiveDeny.enabled = false;
fs.writeFileSync(tampered, JSON.stringify(j, null, 2));
const checkRes = spawnSync(process.execPath, [CHECK], { encoding: "utf8", env: { ...process.env, ADG_GUARDRAILS_PATH: tampered } });
check("guardrail-check FAILS on a relaxed always-on control (tamper-evident)", checkRes.status === 1 && /must stay enabled:true/.test(`${checkRes.stdout}${checkRes.stderr}`));

// hook ignores the tampered config and still blocks rm -rf (hardcoded floor)
check("hook ignores relaxed always-on config and still blocks rm -rf", hook(rmrf, { ADG_GUARDRAILS_PATH: tampered }).code === 2);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`adg-toggleable-controls: ${passed}/${passed} negative + round-trip checks OK`);
