#!/usr/bin/env node
// Tests for @adg/sdk — the vendor-SDK governance adapters. These verify the objects the
// adapters PRODUCE behave correctly; they do not require the vendor SDKs to be installed
// (the adapters import nothing from them). The action gate is exercised against the real
// hardened hook via the policy client.
// Run: node tooling/adg-as-code/test-sdk.mjs

import assert from "node:assert/strict";
import { withClaudeGovernance, adgCanUseTool, adgClaudeHooks, governAgentModel } from "../../packages/sdk/claude.mjs";
import { governTool, adgOutputGuardrail, modelSettingsFor, loopCaps } from "../../packages/sdk/openai.mjs";

let passed = 0;
async function check(label, fn) {
  await fn();
  passed += 1;
  process.stdout.write(`  ok  ${label}\n`);
}

// -- Claude: action gate via canUseTool (delegates to the real hook) ---------
const gate = adgCanUseTool(undefined, {});
await check("canUseTool DENIES a destructive command", async () => {
  const r = await gate("Bash", { command: "rm -rf ./build" }, {});
  assert.equal(r.behavior, "deny");
  assert.ok(/ADG/.test(r.message));
});
await check("canUseTool ALLOWS a normal command", async () => {
  const r = await gate("Bash", { command: "npm run test" }, {});
  assert.equal(r.behavior, "allow");
});
await check("canUseTool ASK with no approver -> deny (headless-safe)", async () => {
  const r = await gate("Bash", { command: "git push origin main" }, {});
  assert.equal(r.behavior, "deny"); // 'ask' with no prior approver denies
});
await check("canUseTool ASK delegates to a prior approver when present", async () => {
  const prior = async () => ({ behavior: "allow", updatedInput: { command: "git push origin main" } });
  const g = adgCanUseTool(prior, {});
  const r = await g("Bash", { command: "git push origin main" }, {});
  assert.equal(r.behavior, "allow"); // deferred to the caller's approver
});

// -- Claude: withClaudeGovernance patches Options without dropping caller's --
await check("withClaudeGovernance wires canUseTool + all lifecycle hooks", async () => {
  const opts = withClaudeGovernance({ model: "opus", hooks: { Stop: [{ callback: async () => ({}) }] } });
  assert.equal(typeof opts.canUseTool, "function");
  for (const ev of ["Stop", "PostToolUse", "UserPromptSubmit", "PreCompact", "SessionStart"]) {
    assert.ok(Array.isArray(opts.hooks[ev]) && opts.hooks[ev].length >= 1, `has ${ev}`);
  }
  assert.equal(opts.hooks.Stop.length, 2, "kept the caller's Stop hook and added ADG's");
  assert.equal(opts.model, "opus", "preserved caller options");
});

// -- Claude: governor Stop hook callback blocks/permits via the demo DB ------
await check("Stop hook callback returns an object (no block on the clean demo DB)", async () => {
  const hooks = adgClaudeHooks({});
  const r = await hooks.Stop[0].callback({ stop_hook_active: false });
  assert.ok(r && typeof r === "object"); // {} on clean DB, {decision:'block',...} on violation
});
await check("Stop hook yields on stop_hook_active", async () => {
  const hooks = adgClaudeHooks({});
  const r = await hooks.Stop[0].callback({ stop_hook_active: true });
  assert.deepEqual(r, {});
});

// -- Claude: PostToolUse backpressure callback -------------------------------
await check("PostToolUse surfaces a failed verification command", async () => {
  const hooks = adgClaudeHooks({});
  const r = await hooks.PostToolUse[0].callback({ tool_name: "Bash", tool_input: { command: "npm run test" }, tool_response: { exit_code: 1 } });
  assert.ok(r.hookSpecificOutput.additionalContext.includes("backpressure"));
});

// -- Claude: model orchestration fragment for AgentDefinition ----------------
await check("governAgentModel returns {model, effort} for an AgentDefinition", async () => {
  const frag = governAgentModel({ lane: "L3", risk: "secrets" });
  assert.equal(frag.model, "claude-opus-4-8");
  assert.equal(frag.effort, "high");
});

// -- OpenAI: governed tool wrapper denies a destructive call -----------------
await check("governTool throws on a denied call, runs the fn otherwise", async () => {
  let ran = false;
  const safe = governTool("Bash", async () => { ran = true; return "ok"; }, {});
  await assert.rejects(() => safe({ command: "rm -rf /" }, {}));
  assert.equal(ran, false);
  const out = await safe({ command: "echo hi" }, {});
  assert.equal(out, "ok");
});

// -- OpenAI: output guardrail shape + model settings -------------------------
await check("adgOutputGuardrail returns a named guardrail with execute()", async () => {
  const g = adgOutputGuardrail({});
  assert.equal(g.name, "adg-release-gate");
  const r = await g.execute();
  assert.equal(typeof r.tripwireTriggered, "boolean");
});
await check("modelSettingsFor maps lane/risk to {model, reasoning.effort}", async () => {
  const s = modelSettingsFor({ lane: "L4" });
  assert.equal(s.model, "5.5-pro");
  assert.equal(s.reasoning.effort, "high");
});
await check("loopCaps exposes the hard-stop ceiling", async () => {
  assert.ok(Number.isFinite(loopCaps().maxTurns));
});

process.stdout.write(`\nsdk: ${passed} checks passed\n`);
