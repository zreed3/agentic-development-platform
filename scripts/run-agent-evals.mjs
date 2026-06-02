#!/usr/bin/env node
// Run local agent eval / AI-security scenarios against the guardrail policy.
//
// Each scenario asserts the decision (allow/deny), whether confirmation is
// required, and the security outcome the policy should produce for a given
// input and allowed-tool set. Results are mirrored into SQLite/SQL/JSON so they
// are queryable and reviewable. Exits non-zero if any scenario fails.

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const scenarioDir = "tooling/agent-evals/scenarios";
const policyPath = "config/agentic/guardrails.json";
const outJson = "data/agent-evals.json";
const outSqlite = "data/agent-evals.sqlite";
const outSql = "data/agent-evals.sql";

function abs(file) {
  return path.join(root, file);
}

function sqlString(value) {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function exec(cmd) {
  return execSync(cmd, { cwd: root, encoding: "utf8", shell: "/bin/zsh" }).trim();
}

function walk(dir) {
  if (!fs.existsSync(abs(dir))) return [];
  return fs.readdirSync(abs(dir), { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name).replaceAll(path.sep, "/");
    return entry.isDirectory() ? walk(file) : [file];
  });
}

const policy = JSON.parse(fs.readFileSync(abs(policyPath), "utf8"));
const toolMap = new Map(policy.tools.map((tool) => [tool.name, tool]));
const now = new Date().toISOString();
const scenarioFiles = walk(scenarioDir).filter((file) => file.endsWith(".json")).sort();
const scenarios = scenarioFiles.map((file) => ({ file, ...JSON.parse(fs.readFileSync(abs(file), "utf8")) }));

const results = scenarios.map((scenario) => {
  const tool = toolMap.get(scenario.expected.tool);
  const actualDecision = tool?.allowed && scenario.allowedTools.includes(scenario.expected.tool) ? "allow" : "deny";
  const actualRequiresConfirmation = Boolean(tool?.requiresConfirmation ?? policy.riskClasses?.[tool?.riskClass]?.requiresConfirmation);
  const pass =
    actualDecision === scenario.expected.decision &&
    actualRequiresConfirmation === scenario.expected.requiresConfirmation &&
    (scenario.expected.decision === "deny" || scenario.allowedTools.includes(scenario.expected.tool));
  return {
    id: scenario.id,
    title: scenario.title,
    category: scenario.category,
    risk: scenario.risk,
    file: scenario.file,
    expectedDecision: scenario.expected.decision,
    actualDecision,
    expectedTool: scenario.expected.tool,
    actualRequiresConfirmation,
    expectedRequiresConfirmation: scenario.expected.requiresConfirmation,
    expectedSecurityOutcome: scenario.expected.securityOutcome,
    status: pass ? "passed" : "failed",
    assertions: scenario.assertions,
  };
});

const payload = {
  generatedAt: now,
  policyVersion: policy.policyVersion,
  scenarioCount: results.length,
  passed: results.filter((result) => result.status === "passed").length,
  failed: results.filter((result) => result.status === "failed").length,
  results,
};

fs.mkdirSync(path.dirname(abs(outJson)), { recursive: true });
fs.writeFileSync(abs(outJson), `${JSON.stringify(payload, null, 2)}\n`, "utf8");

const statements = [
  "PRAGMA foreign_keys = ON;",
  "DROP TABLE IF EXISTS eval_assertions;",
  "DROP TABLE IF EXISTS eval_results;",
  "DROP TABLE IF EXISTS eval_runs;",
  "CREATE TABLE eval_runs (id TEXT PRIMARY KEY, generated_at TEXT NOT NULL, policy_version TEXT NOT NULL, scenario_count INTEGER NOT NULL, passed INTEGER NOT NULL, failed INTEGER NOT NULL);",
  "CREATE TABLE eval_results (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, title TEXT NOT NULL, category TEXT NOT NULL, risk TEXT NOT NULL, file_path TEXT NOT NULL, expected_decision TEXT NOT NULL, actual_decision TEXT NOT NULL, expected_tool TEXT NOT NULL, expected_requires_confirmation INTEGER NOT NULL, actual_requires_confirmation INTEGER NOT NULL, expected_security_outcome TEXT NOT NULL, status TEXT NOT NULL, FOREIGN KEY(run_id) REFERENCES eval_runs(id));",
  "CREATE TABLE eval_assertions (id TEXT PRIMARY KEY, result_id TEXT NOT NULL, position INTEGER NOT NULL, assertion TEXT NOT NULL, FOREIGN KEY(result_id) REFERENCES eval_results(id));",
  `INSERT INTO eval_runs VALUES ('EVAL-RUN-001', ${sqlString(now)}, ${sqlString(policy.policyVersion)}, ${results.length}, ${payload.passed}, ${payload.failed});`,
];

for (const result of results) {
  statements.push(`INSERT INTO eval_results VALUES (${sqlString(result.id)}, 'EVAL-RUN-001', ${sqlString(result.title)}, ${sqlString(result.category)}, ${sqlString(result.risk)}, ${sqlString(result.file)}, ${sqlString(result.expectedDecision)}, ${sqlString(result.actualDecision)}, ${sqlString(result.expectedTool)}, ${result.expectedRequiresConfirmation ? 1 : 0}, ${result.actualRequiresConfirmation ? 1 : 0}, ${sqlString(result.expectedSecurityOutcome)}, ${sqlString(result.status)});`);
  result.assertions.forEach((assertion, index) => {
    statements.push(`INSERT INTO eval_assertions VALUES (${sqlString(`${result.id}-ASSERT-${String(index + 1).padStart(2, "0")}`)}, ${sqlString(result.id)}, ${index + 1}, ${sqlString(assertion)});`);
  });
}

fs.writeFileSync(abs(outSql), `${statements.join("\n")}\n`, "utf8");
if (fs.existsSync(abs(outSqlite))) fs.rmSync(abs(outSqlite));
exec(`sqlite3 ${JSON.stringify(abs(outSqlite))} < ${JSON.stringify(abs(outSql))}`);

console.log(JSON.stringify(payload, null, 2));
if (payload.failed > 0) process.exit(1);
