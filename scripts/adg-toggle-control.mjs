#!/usr/bin/env node
// Governed toggle for ADG guardrail controls.
//
// Toggling a control is itself a governed, audited action. This is the ONLY
// supported path to change controls.definitions[*].enabled in the single policy
// source (config/agentic/guardrails.json). It:
//   - refuses to touch any always-on control (destructive-deny, audit-append-only,
//     forbidden-bulk-read) -> exit 3;
//   - requires --reason, --risk, and --rollback (the waiver rule) -> exit 2;
//   - bumps controls.version, appends to controls.toggleHistory, and writes an
//     append-only audit `decision` event (reason / risk / rollback);
//   - re-validates the policy afterwards and fails closed if it no longer validates.
//
//   node scripts/adg-toggle-control.mjs --control productionConfirm --set off \
//     --reason "CI deploy context, pushes are pre-approved" \
//     --risk "medium: production pushes will not prompt in this repo" \
//     --rollback "re-run with --set on"
//
// ADG_GUARDRAILS_PATH overrides the policy path (tests); ADG_AUDIT_LOG_PATH (read by
// record-audit.mjs) redirects the audit log (tests). Both default to canonical paths.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

// Mirrors the canonical registry in scripts/guardrail-check.mjs and the hook.
const MANDATORY_ALWAYS_ON = new Set(["destructiveDeny", "auditAppendOnly", "forbiddenBulkRead"]);

function abs(file) {
  return path.isAbsolute(file) ? file : path.join(root, file);
}

function parseArgs(argv) {
  // Every flag in this CLI takes a value, so consume the next token unconditionally
  // (a value may legitimately start with "--", e.g. --rollback "--set on").
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith("--")) continue;
    const name = key.slice(2);
    if (i + 1 < argv.length) { args[name] = argv[i + 1]; i += 1; } else { args[name] = true; }
  }
  return args;
}

function fail(code, message) {
  console.error(JSON.stringify({ ok: false, error: message }, null, 2));
  process.exit(code);
}

const args = parseArgs(process.argv.slice(2));
const policyPath = process.env.ADG_GUARDRAILS_PATH || value(args, "policy", "config/agentic/guardrails.json");
const control = value(args, "control");
const setRaw = value(args, "set");

function value(a, key, fallback = "") {
  const v = a[key];
  return v === undefined || v === true ? fallback : String(v);
}

if (!control) fail(2, "--control <name> is required");
const desired = setRaw.toLowerCase();
if (!["on", "off", "true", "false", "enable", "disable"].includes(desired)) fail(2, "--set must be on|off");
const enable = ["on", "true", "enable"].includes(desired);

const policyFile = abs(policyPath);
if (!fs.existsSync(policyFile)) fail(2, `policy not found: ${policyPath}`);
const policy = JSON.parse(fs.readFileSync(policyFile, "utf8"));
const def = policy.controls?.definitions?.[control];
if (!def) fail(2, `unknown control "${control}"`);

// Always-on controls can never be toggled. This is the toggle-as-jailbreak floor.
if (MANDATORY_ALWAYS_ON.has(control) || def.alwaysOn === true) {
  fail(3, `control "${control}" is always-on and cannot be toggled`);
}

const reason = value(args, "reason");
const risk = value(args, "risk");
const rollback = value(args, "rollback");
if (!reason || !risk || !rollback) {
  fail(2, "toggling a control requires --reason, --risk, and --rollback (the waiver rule)");
}

const from = def.enabled !== false;
if (from === enable) {
  console.log(JSON.stringify({ ok: true, control, unchanged: true, enabled: enable }, null, 2));
  process.exit(0);
}

// Apply the toggle: flip enabled, bump version, append to toggleHistory.
def.enabled = enable;
const occurredAt = new Date().toISOString();
const versionStamp = occurredAt.replace(/[-:.TZ]/gu, "").slice(0, 14);
policy.controls.version = `adp-controls-${versionStamp}`;
policy.controls.toggleHistory = Array.isArray(policy.controls.toggleHistory) ? policy.controls.toggleHistory : [];
const historyEntry = { control, from: from ? "enabled" : "disabled", to: enable ? "enabled" : "disabled", at: occurredAt, reason, risk, rollback };
policy.controls.toggleHistory.push(historyEntry);
fs.writeFileSync(policyFile, `${JSON.stringify(policy, null, 2)}\n`, "utf8");

// Append a governed audit decision event (reason / risk / rollback). Append-only.
const summary = `Toggled control ${control} ${from ? "enabled" : "disabled"} -> ${enable ? "enabled" : "disabled"}`;
const details = `reason: ${reason} | risk: ${risk} | rollback: ${rollback}`;
const auditRes = spawnSync(process.execPath, [
  abs("scripts/record-audit.mjs"),
  "--type", "decision",
  "--summary", summary,
  "--details", details,
  "--tier", "config",
  "--evidence", policyPath,
  "--evidence", `controls.version=${policy.controls.version}`,
], { cwd: root, encoding: "utf8" });
const auditOk = auditRes.status === 0;

// Re-validate. If the toggle somehow broke the policy, fail closed and report it.
const check = spawnSync(process.execPath, [abs("scripts/guardrail-check.mjs")], {
  cwd: root,
  encoding: "utf8",
  env: { ...process.env, ADG_GUARDRAILS_PATH: policyFile },
});
const valid = check.status === 0;

console.log(JSON.stringify({
  ok: valid && auditOk,
  control,
  enabled: enable,
  controlsVersion: policy.controls.version,
  audited: auditOk,
  policyValidAfter: valid,
  history: historyEntry,
}, null, 2));
process.exit(valid && auditOk ? 0 : 1);
