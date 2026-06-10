#!/usr/bin/env node
// Test the harness-neutral pre-tool adapter: it must reproduce the shared hook's
// deny/ask/allow decisions and normalise harness field-name variants.
//
// Run: npm run test:adg-codex-hook

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decide } from "./adg-codex-pretool.mjs";

const adapter = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "adg-codex-pretool.mjs");

function rawRun(rawInput) {
  const res = spawnSync(process.execPath, [adapter], { input: rawInput, encoding: "utf8" });
  let out = {};
  try {
    out = JSON.parse(res.stdout || "{}");
  } catch {
    out = {};
  }
  return { status: res.status, decision: out.decision, reason: out.reason };
}

function run(event) {
  return rawRun(JSON.stringify(event));
}

let passed = 0;
const ok = (label) => {
  passed += 1;
  console.log(`  ok ${label}`);
};

// Decisions mirror the shared hook.
let r = run({ tool_name: "Bash", tool_input: { command: "rm -rf /" } });
assert.equal(r.decision, "deny", "destructive must deny");
assert.equal(r.status, 2, "deny must exit 2");
ok("a destructive command is denied (exit 2)");

r = run({ tool_name: "Bash", tool_input: { command: "git push origin main" } });
assert.equal(r.decision, "ask", "production/deploy must ask");
assert.equal(r.status, 0, "ask must exit 0");
ok("a production/deploy command asks for confirmation");

r = run({ tool_name: "Bash", tool_input: { command: "ls -la" } });
assert.equal(r.decision, "allow", "ordinary command must allow");
assert.equal(r.status, 0, "allow must exit 0");
ok("an ordinary command is allowed");

r = run({ tool_name: "Read", tool_input: { file_path: "data/backlog.sqlite" } });
assert.equal(r.decision, "deny", "reading a generated context hazard must block");
ok("reading a generated context hazard is blocked");

// Field-name normalisation: the same policy regardless of the harness's event shape.
r = run({ toolName: "Bash", toolInput: { command: "rm -rf /tmp/x" } });
assert.equal(r.decision, "deny", "toolName/toolInput variant must normalise");
ok("normalises toolName/toolInput field names");

r = run({ name: "Bash", arguments: { command: "terraform apply" } });
assert.equal(r.decision, "ask", "name/arguments variant must normalise");
ok("normalises name/arguments field names");

// A non-object JSON event (literal null) must not crash the adapter.
r = rawRun("null");
assert.equal(r.status, 0, "literal null input must not crash (exit 0)");
assert.equal(r.decision, "allow", "an empty/unknown tool defaults to allow");
ok("a non-object JSON event (null) does not crash the adapter");

// If the hook cannot run cleanly, fail CLOSED for mutating tools, OPEN for reads.
const brokenHook = () => ({ status: 127, stdout: "", stderr: "node: cannot find module" });
assert.equal(decide({ tool_name: "Bash", tool_input: { command: "echo hi" } }, brokenHook).decision, "deny", "a broken hook must deny a mutating action (fail closed)");
assert.equal(decide({ tool_name: "Edit", tool_input: { file_path: "x" } }, brokenHook).decision, "deny", "a broken hook must deny an edit (fail closed)");
assert.equal(decide({ tool_name: "Read", tool_input: { file_path: "x" } }, brokenHook).decision, "allow", "a broken hook fails open for a read");
ok("a broken/missing hook fails closed for mutating tools, open for reads");

console.log(`\nadg codex pre-tool adapter: ${passed} checks passed`);
