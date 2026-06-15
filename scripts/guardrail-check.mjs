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
// Single policy source. ADG_GUARDRAILS_PATH overrides it for hermetic tests only;
// it defaults to the canonical path and never weakens the policy.
const policyPath = process.env.ADG_GUARDRAILS_PATH || "config/agentic/guardrails.json";

// Canonical control registry. The validator and the deterministic hook pin the
// same always-on floor IN CODE so a hand-edit to guardrails.json that relaxes an
// always-on control is rejected here (and ignored at runtime by the hook).
const KNOWN_CONTROLS = new Set([
  "destructiveDeny",
  "auditAppendOnly",
  "forbiddenBulkRead",
  "secretsConfirm",
  "productionConfirm",
  "migrationConfirm",
  "billingConfirm",
  "controlFileGuard",
  "assetLint",
]);
const MANDATORY_ALWAYS_ON = { destructiveDeny: "deny", auditAppendOnly: "block", forbiddenBulkRead: "block" };
const VALID_EFFECTS = new Set(["deny", "ask", "allow", "block"]);

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
  failures.push(...validateControls(policy));
  return failures;
}

// Validate the toggleable-controls block. Deny-by-default extends here: an unknown
// control key, a relaxed always-on control, or a malformed definition is a hard
// failure, never silently ignored. This is what makes a config toggle tamper-evident.
function validateControls(policy) {
  const failures = [];
  const controls = policy.controls;
  if (controls === undefined) return failures; // optional block; absence is all-enabled (fail-closed)
  if (typeof controls !== "object" || Array.isArray(controls)) return ["controls must be an object"];
  if (typeof controls.version !== "string" || !controls.version) failures.push("controls.version must be a non-empty string");
  const defs = controls.definitions;
  if (typeof defs !== "object" || defs === null || Array.isArray(defs)) return [...failures, "controls.definitions must be an object"];

  const riskClasses = new Set(Object.keys(policy.riskClasses ?? {}));
  for (const [name, def] of Object.entries(defs)) {
    if (!KNOWN_CONTROLS.has(name)) failures.push(`controls: unknown control "${name}" (not in the canonical registry)`);
    if (typeof def !== "object" || def === null) { failures.push(`controls.${name}: definition must be an object`); continue; }
    if (typeof def.enabled !== "boolean") failures.push(`controls.${name}: enabled must be a boolean`);
    if (typeof def.alwaysOn !== "boolean") failures.push(`controls.${name}: alwaysOn must be a boolean`);
    if (!VALID_EFFECTS.has(def.effect)) failures.push(`controls.${name}: effect must be one of ${[...VALID_EFFECTS].join("/")}`);
    if (def.appliesTo !== undefined && !riskClasses.has(def.appliesTo)) failures.push(`controls.${name}: appliesTo references unknown riskClass "${def.appliesTo}"`);
  }
  // The mandatory always-on floor cannot be relaxed by editing the policy.
  for (const [name, requiredEffect] of Object.entries(MANDATORY_ALWAYS_ON)) {
    const def = defs[name];
    if (!def) { failures.push(`controls: mandatory always-on control "${name}" is missing`); continue; }
    if (def.alwaysOn !== true) failures.push(`controls.${name}: must stay alwaysOn:true (mandatory always-on control)`);
    if (def.enabled !== true) failures.push(`controls.${name}: must stay enabled:true (mandatory always-on control cannot be disabled)`);
    if (def.effect !== requiredEffect) failures.push(`controls.${name}: effect must stay "${requiredEffect}" (mandatory always-on floor)`);
  }
  return failures;
}

const args = parseArgs(process.argv.slice(2));
const quiet = Boolean(args.quiet);
// In quiet mode, emit ONE machine-readable line; in verbose mode, pretty JSON. Exit
// codes are byte-identical in both modes (quiet changes output only, never control flow).
function emit(stream, payload, line) {
  stream.write(`${quiet ? line : JSON.stringify(payload, null, 2)}\n`);
}
const policy = loadPolicy();
const failures = validatePolicy(policy);

if (failures.length > 0) {
  emit(process.stderr, { policyPath, valid: false, failures }, `guardrails: FAIL (${failures.length} failure${failures.length === 1 ? "" : "s"}: ${failures[0]})`);
  process.exit(1);
}

if (args.control) {
  const def = policy.controls?.definitions?.[args.control];
  if (!def) {
    console.error(JSON.stringify({ policyPath, control: args.control, found: false, known: [...KNOWN_CONTROLS] }, null, 2));
    process.exit(2);
  }
  console.log(JSON.stringify({ policyPath, control: args.control, ...def, mandatoryAlwaysOn: args.control in MANDATORY_ALWAYS_ON }, null, 2));
  process.exit(0);
}

if (!args.tool) {
  const controls = policy.controls?.definitions ?? {};
  const controlNames = Object.keys(controls);
  const disabledControls = controlNames.filter((n) => controls[n]?.enabled === false);
  emit(process.stdout, {
    policyPath,
    policyVersion: policy.policyVersion,
    valid: true,
    tools: policy.tools.length,
    controls: controlNames.length,
    controlsVersion: policy.controls?.version ?? null,
    disabledControls,
  }, `guardrails: ok (${policy.tools.length} tools, ${controlNames.length} controls${disabledControls.length ? `, disabled: ${disabledControls.join(",")}` : ""})`);
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
