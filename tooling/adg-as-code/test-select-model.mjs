#!/usr/bin/env node
// Unit tests for the ADG model orchestrator (packages/core/select-model.mjs).
// Asserts effort-first, capability-as-floor tier selection is deterministic and that
// risk/role can only RAISE the tier, never lower it.
// Run: node tooling/adg-as-code/test-select-model.mjs

import assert from "node:assert";
import { selectModel, loadModelPolicy } from "../../packages/core/select-model.mjs";

const policy = loadModelPolicy();
let passed = 0;
function check(label, fn) {
  fn();
  passed += 1;
  process.stdout.write(`  ok  ${label}\n`);
}

// -- lane drives the base tier (effort-first) -------------------------------
check("L0 -> economy / low effort", () => {
  const r = selectModel({ lane: "L0" }, policy);
  assert.equal(r.tier, "economy");
  assert.equal(r.effort, "low");
  assert.equal(r.model, "claude-haiku-4-5");
});
check("L2 -> balanced / medium effort", () => {
  const r = selectModel({ lane: "L2" }, policy);
  assert.equal(r.tier, "balanced");
  assert.equal(r.effort, "medium");
});
check("L4 -> frontier / high effort", () => {
  const r = selectModel({ lane: "L4" }, policy);
  assert.equal(r.tier, "frontier-reasoning");
  assert.equal(r.effort, "high");
});

// -- risk floor can only RAISE ----------------------------------------------
check("L0 + secrets risk is raised to frontier (floor, not lane)", () => {
  const r = selectModel({ lane: "L0", risk: "secrets" }, policy);
  assert.equal(r.tier, "frontier-reasoning");
  assert.ok(/risk/.test(r.reason));
});
check("L4 + migration risk stays frontier (floor never lowers)", () => {
  const r = selectModel({ lane: "L4", risk: "migration" }, policy);
  assert.equal(r.tier, "frontier-reasoning"); // lane L4 already > migration's 'balanced' floor
});

// -- role floor can only RAISE ----------------------------------------------
check("L1 + planner role raised to frontier", () => {
  const r = selectModel({ lane: "L1", role: "planner" }, policy);
  assert.equal(r.tier, "frontier-reasoning");
});
check("L2 + ordinary worker role unchanged (no floor)", () => {
  const r = selectModel({ lane: "L2", role: "worker" }, policy);
  assert.equal(r.tier, "balanced");
});

// -- explicit override is honored, but a risk floor still wins --------------
check("explicit tier raises economy->balanced", () => {
  const r = selectModel({ lane: "L0", tier: "balanced" }, policy);
  assert.equal(r.tier, "balanced");
});
check("explicit economy cannot undercut a secrets risk floor", () => {
  const r = selectModel({ lane: "L0", tier: "economy", risk: "secrets" }, policy);
  assert.equal(r.tier, "frontier-reasoning");
});

// -- provider neutrality -----------------------------------------------------
check("openai provider resolves the same tier to its own model id", () => {
  const r = selectModel({ lane: "L4", provider: "openai" }, policy);
  assert.equal(r.tier, "frontier-reasoning");
  assert.equal(r.model, "5.5-pro");
});

// -- determinism -------------------------------------------------------------
check("same inputs -> same output", () => {
  const a = selectModel({ lane: "L3", risk: "billing", role: "judge" }, policy);
  const b = selectModel({ lane: "L3", risk: "billing", role: "judge" }, policy);
  assert.deepEqual(a, b);
});

// -- unknown provider for a tier fails loudly (no silent wrong-model) --------
check("missing provider model throws rather than returning undefined", () => {
  assert.throws(() => selectModel({ lane: "L2", provider: "nonesuch" }, policy));
});

process.stdout.write(`\nselect-model: ${passed} checks passed\n`);
