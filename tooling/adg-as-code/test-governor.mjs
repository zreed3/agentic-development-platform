#!/usr/bin/env node
// Unit tests for the ADG loop governor (packages/core/governor.mjs).
// Asserts the Stop-hook decision: refuse turn-end on a release-gate violation (block mode),
// yield on stop_hook_active, yield past the turn ceiling, and stay advisory in warn mode.
// Run: node tooling/adg-as-code/test-governor.mjs

import assert from "node:assert/strict";
import { governorDecision } from "../../packages/core/governor.mjs";

let passed = 0;
function check(label, fn) {
  fn();
  passed += 1;
  process.stdout.write(`  ok  ${label}\n`);
}

const V = [{ item_id: "S07-TASK-03", release_classes: "deploy" }];

// -- clean: no violations, within caps -> allow -----------------------------
check("no violations -> allow", () => {
  const d = governorDecision({ violations: [], caps: { maxTurns: 60 }, turnCount: 1, mode: "block" });
  assert.equal(d.action, "allow");
});

// -- block mode: a release-gate violation refuses the stop ------------------
check("violation in block mode -> block, names the item", () => {
  const d = governorDecision({ violations: V, caps: { maxTurns: 60 }, turnCount: 1, mode: "block" });
  assert.equal(d.action, "block");
  assert.ok(d.reason.includes("S07-TASK-03"));
  assert.ok(/live/.test(d.reason));
});

// -- warn mode: advisory, still allows --------------------------------------
check("violation in warn mode -> allow + advisory", () => {
  const d = governorDecision({ violations: V, mode: "warn", turnCount: 1 });
  assert.equal(d.action, "allow");
  assert.equal(d.advisory, true);
});

// -- off mode disables --------------------------------------------------------
check("off mode -> allow even with violations", () => {
  const d = governorDecision({ violations: V, mode: "off", turnCount: 1 });
  assert.equal(d.action, "allow");
});

// -- never trap: stop_hook_active always yields, even with a violation -------
check("stop_hook_active -> allow (no trap) despite violation", () => {
  const d = governorDecision({ violations: V, mode: "block", stopHookActive: true, turnCount: 1 });
  assert.equal(d.action, "allow");
  assert.ok(/stop_hook_active/.test(d.reason));
});

// -- failsafe ceiling: past maxTurns the governor yields ---------------------
check("turnCount >= maxTurns -> allow (failsafe ceiling)", () => {
  const d = governorDecision({ violations: V, mode: "block", caps: { maxTurns: 60 }, turnCount: 60 });
  assert.equal(d.action, "allow");
  assert.ok(/ceiling/.test(d.reason));
});

// -- unknown mode defaults to block (safe default for the quality gate) ------
check("unknown mode defaults to block", () => {
  const d = governorDecision({ violations: V, mode: "nonsense", turnCount: 1 });
  assert.equal(d.action, "block");
});

// -- determinism --------------------------------------------------------------
check("same inputs -> same output", () => {
  const a = governorDecision({ violations: V, mode: "block", caps: { maxTurns: 60 }, turnCount: 2 });
  const b = governorDecision({ violations: V, mode: "block", caps: { maxTurns: 60 }, turnCount: 2 });
  assert.deepEqual(a, b);
});

process.stdout.write(`\ngovernor: ${passed} checks passed\n`);
