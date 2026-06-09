#!/usr/bin/env node
// Smoke test for the ADG deterministic PreToolUse hook.
// Asserts the deny/ask/allow decisions are deterministic for representative
// tool calls. Run: node plugins/adg-governance/hooks/test-adg-guardrail-hook.mjs

import assert from "node:assert";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HOOK = path.join(path.dirname(fileURLToPath(import.meta.url)), "adg-guardrail-hook.mjs");

function run(event) {
  const res = spawnSync("node", [HOOK], {
    input: JSON.stringify(event),
    encoding: "utf8",
  });
  let json = null;
  try {
    json = res.stdout ? JSON.parse(res.stdout) : null;
  } catch {
    json = null;
  }
  return { code: res.status, stderr: res.stderr, decision: json?.hookSpecificOutput?.permissionDecision ?? null };
}

const cases = [
  // [label, event, expected code, expected decision]
  ["block destructive rm -rf", { tool_name: "Bash", tool_input: { command: "rm -rf ./build" } }, 2, null],
  ["block force push", { tool_name: "Bash", tool_input: { command: "git push origin main --force" } }, 2, null],
  ["block DROP TABLE", { tool_name: "Bash", tool_input: { command: "sqlite3 db 'DROP TABLE users'" } }, 2, null],
  ["block reading a .sqlite", { tool_name: "Read", tool_input: { file_path: "data/backlog.sqlite" } }, 2, null],
  ["block cat of generated dump", { tool_name: "Bash", tool_input: { command: "cat data/backlog.sql" } }, 2, null],
  ["ask on git push", { tool_name: "Bash", tool_input: { command: "git push origin main" } }, 0, "ask"],
  ["ask on deploy", { tool_name: "Bash", tool_input: { command: "vercel deploy --prod" } }, 0, "ask"],
  ["ask on .env read", { tool_name: "Bash", tool_input: { command: "grep KEY .env.local" } }, 0, "ask"],
  ["ask on migration write", { tool_name: "Write", tool_input: { file_path: "packages/db/migrations/0001_init.sql" } }, 0, "ask"],
  ["allow normal read", { tool_name: "Read", tool_input: { file_path: "src/index.ts" } }, 0, null],
  ["allow normal edit", { tool_name: "Edit", tool_input: { file_path: "src/app/page.tsx" } }, 0, null],
  ["allow normal bash", { tool_name: "Bash", tool_input: { command: "npm run test" } }, 0, null],
  ["safe-allow malformed/empty event (no spurious block)", { tool_name: "Bash", tool_input: null }, 0, null],
];

let passed = 0;
for (const [label, event, expectedCode, expectedDecision] of cases) {
  const { code, decision } = run(event);
  assert.strictEqual(code, expectedCode, `${label}: expected exit ${expectedCode}, got ${code}`);
  assert.strictEqual(decision, expectedDecision, `${label}: expected decision ${expectedDecision}, got ${decision}`);
  passed += 1;
}

console.log(`adg-guardrail-hook: ${passed}/${cases.length} deterministic decisions OK`);
