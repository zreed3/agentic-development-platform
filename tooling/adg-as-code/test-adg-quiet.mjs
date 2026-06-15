#!/usr/bin/env node
// Proves --quiet changes ONLY output, never exit codes. For each gate validator, the
// verbose and quiet exit codes must be byte-identical across clean / denied / invalid
// inputs, and quiet output must be a single line.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
function run(script, args, env = {}) {
  const res = spawnSync(process.execPath, [path.join(root, script), ...args], { encoding: "utf8", env: { ...process.env, ...env } });
  return { code: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}
let passed = 0;
const check = (label, cond) => { assert.ok(cond, label); passed += 1; };
const lineCount = (s) => s.trim() === "" ? 0 : s.trim().split("\n").length;

// guardrail-check: clean (0), denied tool (2), invalid policy (1) -- codes must match.
for (const args of [[], ["--tool", "destructive.command"]]) {
  const v = run("scripts/guardrail-check.mjs", args);
  const q = run("scripts/guardrail-check.mjs", [...args, "--quiet"]);
  check(`guardrail-check ${args.join(" ") || "(policy)"}: quiet exit == verbose exit`, v.code === q.code);
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "adg-quiet-"));
const bad = path.join(tmp, "bad.json");
const policy = JSON.parse(fs.readFileSync(path.join(root, "config/agentic/guardrails.json"), "utf8"));
policy.controls.definitions.destructiveDeny.enabled = false;
fs.writeFileSync(bad, JSON.stringify(policy));
const vBad = run("scripts/guardrail-check.mjs", [], { ADG_GUARDRAILS_PATH: bad });
const qBad = run("scripts/guardrail-check.mjs", ["--quiet"], { ADG_GUARDRAILS_PATH: bad });
check("guardrail-check invalid policy: both exit 1", vBad.code === 1 && qBad.code === 1);
check("guardrail-check --quiet emits exactly one stderr line on failure", lineCount(qBad.stderr) === 1);

// validate-audit + doctor: clean run exit codes must match and quiet is one line.
const vAudit = run("scripts/validate-audit.mjs", []);
const qAudit = run("scripts/validate-audit.mjs", ["--quiet"]);
check("validate-audit: quiet exit == verbose exit", vAudit.code === qAudit.code);
check("validate-audit --quiet emits exactly one stdout line", lineCount(qAudit.stdout) === 1);

const vDoc = run("scripts/adg-doctor.mjs", []);
const qDoc = run("scripts/adg-doctor.mjs", ["--quiet"]);
check("adg-doctor: quiet exit == verbose exit", vDoc.code === qDoc.code);
check("adg-doctor --quiet emits exactly one stdout line", lineCount(qDoc.stdout) === 1);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`adg-quiet: ${passed}/${passed} output-only (exit-code-stable) checks OK`);
