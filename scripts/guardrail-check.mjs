#!/usr/bin/env node
// Validate the guardrail policy, and optionally resolve a single tool decision.
//
//   node scripts/guardrail-check.mjs                 -> validate the whole policy
//   node scripts/guardrail-check.mjs --tool code.edit -> resolve one tool decision
//
// The policy is deny-by-default. Validation fails if the shape is wrong or if a
// tool's risk class requires confirmation but the tool does not declare it.

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const policyPath = "config/agentic/guardrails.json";

function abs(file) {
  return path.isAbsolute(file) ? file : path.join(root, file);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith("--")) continue;
    const name = key.slice(2);
    const value = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
    args[name] = value;
  }
  return args;
}

function loadPolicy() {
  return JSON.parse(fs.readFileSync(abs(policyPath), "utf8"));
}

function validatePolicy(policy) {
  const failures = [];
  if (!policy.schemaVersion) failures.push("schemaVersion is required");
  if (!policy.policyVersion) failures.push("policyVersion is required");
  if (policy.defaultDecision !== "deny") failures.push("defaultDecision must be deny");
  if (!policy.riskClasses || typeof policy.riskClasses !== "object") failures.push("riskClasses object is required");
  if (!Array.isArray(policy.tools)) failures.push("tools array is required");
  const riskClasses = new Set(Object.keys(policy.riskClasses ?? {}));
  const names = new Set();
  for (const tool of policy.tools ?? []) {
    if (!tool.name) failures.push("tool name is required");
    if (names.has(tool.name)) failures.push(`duplicate tool ${tool.name}`);
    names.add(tool.name);
    if (!riskClasses.has(tool.riskClass)) failures.push(`${tool.name}: unknown riskClass ${tool.riskClass}`);
    if (!["read", "write"].includes(tool.mode)) failures.push(`${tool.name}: mode must be read or write`);
    if (!Array.isArray(tool.requiredEvidence)) failures.push(`${tool.name}: requiredEvidence must be an array`);
    const riskClass = policy.riskClasses?.[tool.riskClass];
    if (riskClass?.requiresConfirmation && !tool.requiresConfirmation) failures.push(`${tool.name}: risk class requires confirmation`);
  }
  return failures;
}

const args = parseArgs(process.argv.slice(2));
const policy = loadPolicy();
const failures = validatePolicy(policy);

if (failures.length > 0) {
  console.error(JSON.stringify({ policyPath, valid: false, failures }, null, 2));
  process.exit(1);
}

if (!args.tool) {
  console.log(JSON.stringify({ policyPath, policyVersion: policy.policyVersion, valid: true, tools: policy.tools.length }, null, 2));
  process.exit(0);
}

const tool = policy.tools.find((item) => item.name === args.tool);
const decision = tool?.allowed ? "allow" : "deny";
const requiresConfirmation = Boolean(tool?.requiresConfirmation ?? policy.riskClasses?.[tool?.riskClass]?.requiresConfirmation);
const result = {
  policyPath,
  policyVersion: policy.policyVersion,
  tool: args.tool,
  decision,
  requiresConfirmation,
  riskClass: tool?.riskClass ?? "unknown",
  requiredEvidence: tool?.requiredEvidence ?? [],
};
console.log(JSON.stringify(result, null, 2));
if (decision !== "allow") process.exit(2);
