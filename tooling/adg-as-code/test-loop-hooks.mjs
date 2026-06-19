#!/usr/bin/env node
// Unit tests for the ADG loop-context hook pack (Phase 2): backpressure detection and the
// three context builders (steering header, pin, rehydrate).
// Run: node tooling/adg-as-code/test-loop-hooks.mjs

import assert from "node:assert/strict";
import { backpressureDecision, isVerificationCommand } from "../../packages/core/backpressure.mjs";
import { buildSteeringHeader, buildPinContext, buildRehydrateContext } from "../../packages/core/loop-context.mjs";

let passed = 0;
function check(label, fn) {
  fn();
  passed += 1;
  process.stdout.write(`  ok  ${label}\n`);
}

// -- backpressure ------------------------------------------------------------
check("recognizes verification commands", () => {
  assert.ok(isVerificationCommand("npm run test"));
  assert.ok(isVerificationCommand("pytest -q"));
  assert.ok(isVerificationCommand("cargo test"));
  assert.ok(!isVerificationCommand("npm run dev"));
  assert.ok(!isVerificationCommand("ls -la"));
});
check("failing test (exit!=0) surfaces an observation", () => {
  const d = backpressureDecision({ toolName: "Bash", command: "npm run test", exitCode: 1 });
  assert.equal(d.surface, true);
  assert.ok(/required observation/.test(d.reason));
});
check("passing test (exit 0) does not surface", () => {
  const d = backpressureDecision({ toolName: "Bash", command: "npm run test", exitCode: 0, output: "1 failed name ok" });
  assert.equal(d.surface, false); // exit 0 trusted over the word 'failed' in output
});
check("non-verification command never surfaces", () => {
  const d = backpressureDecision({ toolName: "Bash", command: "git status", exitCode: 1 });
  assert.equal(d.surface, false);
});
check("non-Bash tool never surfaces", () => {
  const d = backpressureDecision({ toolName: "Edit", command: "npm run test", exitCode: 1 });
  assert.equal(d.surface, false);
});
check("unknown exit falls back to output markers", () => {
  const d = backpressureDecision({ toolName: "Bash", command: "pytest", output: "Traceback (most recent call last):" });
  assert.equal(d.surface, true);
});

// -- steering header ---------------------------------------------------------
check("steering header empty when no active item", () => {
  assert.equal(buildSteeringHeader({ activeItem: null }), "");
});
check("steering header names item + scope + gate", () => {
  const h = buildSteeringHeader({ activeItem: { id: "S07-T1", title: "do x", status: "in-progress", writeScope: "src/" }, lane: "L2" });
  assert.ok(h.includes("S07-T1"));
  assert.ok(h.includes("write scope: src/"));
  assert.ok(h.includes("lane: L2"));
  assert.ok(/live/.test(h));
});

// -- pin ---------------------------------------------------------------------
check("pin empty when nothing durable", () => {
  assert.equal(buildPinContext({}), "");
});
check("pin includes item + audit tip", () => {
  const p = buildPinContext({ activeItem: { id: "S07-T1" }, auditHead: "abc123", criterion: "users can log in" });
  assert.ok(p.includes("S07-T1"));
  assert.ok(p.includes("abc123"));
  assert.ok(p.includes("users can log in"));
});

// -- rehydrate ---------------------------------------------------------------
check("rehydrate empty when nothing on disk", () => {
  assert.equal(buildRehydrateContext({}), "");
});
check("rehydrate resumes item + last audit + fix plan", () => {
  const r = buildRehydrateContext({ activeItem: { id: "S07-T1", status: "in-progress" }, lastAudit: "status S07: wip", fixPlan: "fix_plan.md" });
  assert.ok(r.includes("S07-T1"));
  assert.ok(r.includes("last audit event"));
  assert.ok(r.includes("fix_plan.md"));
});

process.stdout.write(`\nloop-hooks: ${passed} checks passed\n`);
