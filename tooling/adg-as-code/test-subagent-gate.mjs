#!/usr/bin/env node
// Unit + negative tests for the ADG subagent budget gate (packages/core/subagent-gate.mjs).
// Asserts the P9 fan-out decision: allow within budget, block/advise on a cap breach by
// mode, treat 0/absent caps as disabled, default to warn, and stay deterministic.
// Run: node tooling/adg-as-code/test-subagent-gate.mjs

import assert from "node:assert/strict";
import { subagentGateDecision, SUBAGENT_GATE_MODES } from "../../packages/core/subagent-gate.mjs";

let passed = 0;
function check(label, fn) {
  fn();
  passed += 1;
  process.stdout.write(`  ok  ${label}\n`);
}

const CAPS = { maxConcurrent: 8, maxTotal: 50 };

// -- within budget -> allow --------------------------------------------------
check("within budget -> allow", () => {
  const d = subagentGateDecision({ activeCount: 3, totalCount: 10, caps: CAPS, mode: "block" });
  assert.equal(d.action, "allow");
  assert.ok(!d.advisory);
});

// -- at the cap (==) is still allowed; only > breaches -----------------------
check("active == maxConcurrent -> allow (boundary)", () => {
  const d = subagentGateDecision({ activeCount: 8, totalCount: 10, caps: CAPS, mode: "block" });
  assert.equal(d.action, "allow");
});

// -- NEGATIVE: concurrent breach in block mode -> block ----------------------
check("concurrent breach in block mode -> block, names the cap", () => {
  const d = subagentGateDecision({ activeCount: 9, totalCount: 10, caps: CAPS, mode: "block" });
  assert.equal(d.action, "block");
  assert.ok(/concurrent fan-out 9 exceeds cap 8/.test(d.reason));
});

// -- NEGATIVE: total breach in block mode -> block ---------------------------
check("total breach in block mode -> block, names the cap", () => {
  const d = subagentGateDecision({ activeCount: 2, totalCount: 51, caps: CAPS, mode: "block" });
  assert.equal(d.action, "block");
  assert.ok(/total subagents 51 exceeds cap 50/.test(d.reason));
});

// -- both breached -> both named in one reason -------------------------------
check("both caps breached -> both named", () => {
  const d = subagentGateDecision({ activeCount: 9, totalCount: 51, caps: CAPS, mode: "block" });
  assert.equal(d.action, "block");
  assert.ok(/concurrent fan-out/.test(d.reason) && /total subagents/.test(d.reason));
});

// -- warn mode: advisory, still allows ---------------------------------------
check("breach in warn mode -> allow + advisory", () => {
  const d = subagentGateDecision({ activeCount: 9, totalCount: 10, caps: CAPS, mode: "warn" });
  assert.equal(d.action, "allow");
  assert.equal(d.advisory, true);
  assert.ok(/P9 subagent budget/.test(d.reason));
});

// -- off mode disables even on a breach --------------------------------------
check("off mode -> allow even on a breach", () => {
  const d = subagentGateDecision({ activeCount: 99, totalCount: 999, caps: CAPS, mode: "off" });
  assert.equal(d.action, "allow");
});

// -- 0 / absent caps are disabled (no breach possible) -----------------------
check("zero caps -> never block", () => {
  const d = subagentGateDecision({ activeCount: 99, totalCount: 999, caps: { maxConcurrent: 0, maxTotal: 0 }, mode: "block" });
  assert.equal(d.action, "allow");
});
check("absent caps -> never block", () => {
  const d = subagentGateDecision({ activeCount: 99, totalCount: 999, mode: "block" });
  assert.equal(d.action, "allow");
});

// -- default mode is warn (not block) ----------------------------------------
check("unknown/absent mode defaults to warn", () => {
  const d = subagentGateDecision({ activeCount: 9, totalCount: 10, caps: CAPS });
  assert.equal(d.action, "allow");
  assert.equal(d.advisory, true);
  const d2 = subagentGateDecision({ activeCount: 9, totalCount: 10, caps: CAPS, mode: "nonsense" });
  assert.equal(d2.advisory, true);
});

// -- mode set is exactly block|warn|off --------------------------------------
check("exported mode set is block|warn|off", () => {
  assert.deepEqual([...SUBAGENT_GATE_MODES].sort(), ["block", "off", "warn"]);
});

// -- determinism -------------------------------------------------------------
check("same inputs -> same output", () => {
  const a = subagentGateDecision({ activeCount: 9, totalCount: 51, caps: CAPS, mode: "block" });
  const b = subagentGateDecision({ activeCount: 9, totalCount: 51, caps: CAPS, mode: "block" });
  assert.deepEqual(a, b);
});

// -- empty input never throws, fails safe to allow ---------------------------
check("empty input -> allow (no throw)", () => {
  const d = subagentGateDecision();
  assert.equal(d.action, "allow");
});

process.stdout.write(`\nsubagent-gate: ${passed} checks passed\n`);
