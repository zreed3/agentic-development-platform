#!/usr/bin/env node
// Synthetic-event tests for the tuned ADG guardrail hook.
import { spawnSync } from "node:child_process";

const HOOK = process.argv[2];
const cases = [
  // [name, expected, event]  expected: "allow" | "block" | "ask"
  ["sqlite3 .tables piped to head (was FALSE POSITIVE)", "allow",
    { tool_name: "Bash", tool_input: { command: 'sqlite3 data/backlog.sqlite ".tables" | head' } }],
  ["read-only SELECT count (was FALSE POSITIVE)", "allow",
    { tool_name: "Bash", tool_input: { command: 'sqlite3 data/backlog.sqlite "SELECT COUNT(*) FROM backlog_items;" | head -5' } }],
  ["commit message containing drop schema words (was FALSE POSITIVE)", "allow",
    { tool_name: "Bash", tool_input: { command: 'git commit -m "guard: reject drop schema cascade and TRUNCATE in prose"' } }],
  ["grep for DROP TABLE in sql sources (was FALSE POSITIVE)", "allow",
    { tool_name: "Bash", tool_input: { command: 'grep -rn "DROP TABLE" packages/db/sql/' } }],
  ["cat .env.example (was ASK false positive)", "allow",
    { tool_name: "Bash", tool_input: { command: "cat .env.example" } }],
  ["Grep tool searching for .sqlite string (was FALSE POSITIVE)", "allow",
    { tool_name: "Grep", tool_input: { pattern: "\\.sqlite", path: "packages/db/src" } }],
  ["wc on audit log", "allow",
    { tool_name: "Bash", tool_input: { command: "wc -l data/audit/audit-log.jsonl" } }],

  ["cat raw sqlite (must still block)", "block",
    { tool_name: "Bash", tool_input: { command: "cat data/backlog.sqlite" } }],
  ["head raw sqlite (must still block)", "block",
    { tool_name: "Bash", tool_input: { command: "head -c 1000 data/backlog.sqlite" } }],
  ["sqlite3 whole-db .dump (must still block)", "block",
    { tool_name: "Bash", tool_input: { command: "sqlite3 data/backlog.sqlite .dump" } }],
  ["psql executing DROP TABLE (must still block)", "block",
    { tool_name: "Bash", tool_input: { command: 'psql -c "DROP TABLE crm.clients"' } }],
  ["sqlite3 executing TRUNCATE (must still block)", "block",
    { tool_name: "Bash", tool_input: { command: 'sqlite3 data/backlog.sqlite "TRUNCATE items"' } }],
  ["rm -rf (must still block)", "block",
    { tool_name: "Bash", tool_input: { command: "rm -rf /tmp/whatever" } }],
  ["force push (must still block)", "block",
    { tool_name: "Bash", tool_input: { command: "git push --force origin main" } }],
  ["redirect over audit log (must still block)", "block",
    { tool_name: "Bash", tool_input: { command: 'echo x > data/audit/audit-log.jsonl' } }],
  ["Read tool on raw sqlite (must still block)", "block",
    { tool_name: "Read", tool_input: { file_path: "data/backlog.sqlite" } }],

  ["commit message naming sqlite3 AND TRUNCATE on different lines (regression: blocked own tune commit)", "allow",
    { tool_name: "Bash", tool_input: { command: 'git commit -m "$(cat <<X\n- allow sqlite3 .tables queries\n- gate DROP/TRUNCATE on executor\nX\n)"' } }],
  ["destructive SQL piped into psql (must still block)", "block",
    { tool_name: "Bash", tool_input: { command: 'echo "DROP TABLE crm.clients" | psql' } }],
  ["heredoc destructive SQL into sqlite3 (must still block)", "block",
    { tool_name: "Bash", tool_input: { command: 'sqlite3 data/x.db <<SQL\nTRUNCATE items;\nSQL' } }],
  ["cat real .env (must still ask)", "ask",
    { tool_name: "Bash", tool_input: { command: "cat .env" } }],
  ["cat .env.local (must still ask)", "ask",
    { tool_name: "Bash", tool_input: { command: "cat .env.local" } }],
  ["git push non-force (must still ask)", "ask",
    { tool_name: "Bash", tool_input: { command: "git push origin main" } }],
  ["edit guardrails.json (must still ask)", "ask",
    { tool_name: "Edit", tool_input: { file_path: "config/agentic/guardrails.json" } }],
];

let fail = 0;
for (const [name, expected, event] of cases) {
  const r = spawnSync("node", [HOOK], { input: JSON.stringify(event), encoding: "utf8" });
  let actual;
  if (r.status === 2) actual = "block";
  else if (r.status === 0 && r.stdout.includes('"permissionDecision":"ask"')) actual = "ask";
  else if (r.status === 0) actual = "allow";
  else actual = `exit${r.status}`;
  const ok = actual === expected;
  if (!ok) fail += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  expected=${expected} actual=${actual}  ${name}`);
}
console.log(fail ? `\n${fail} FAILURES` : "\nALL PASS");
process.exit(fail ? 1 : 0);
