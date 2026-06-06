#!/usr/bin/env node
// Requirements-to-UX-as-code validator.

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const elicitationPath = "config/agentic/elicitation.json";
const uxPath = "config/agentic/ux-as-code.json";

function abs(file) {
  return path.isAbsolute(file) ? file : path.join(root, file);
}

function parseArgs(argv) {
  const args = { command: argv[0] ?? "help", values: {} };
  for (let i = 1; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    args.values[key] = next && !next.startsWith("--") ? next : true;
    if (next && !next.startsWith("--")) i += 1;
  }
  return args;
}

function value(args, key, fallback = "") {
  const raw = args.values[key];
  if (raw === undefined || raw === true) return fallback;
  return String(raw);
}

function asArray(input) {
  return Array.isArray(input) ? input : [];
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(abs(file), "utf8"));
}

function surfaceProfile(config, surface) {
  return asArray(config.surfaceProfiles).find((profile) => String(surface ?? "").startsWith(profile.matchPrefix)) ?? asArray(config.surfaceProfiles)[0];
}

function validateFeature(feature, uxConfig) {
  const failures = [];
  const warnings = [];
  const requirements = new Set(asArray(feature.functionalRequirements).map((row) => row.id));
  const useCases = new Set(asArray(feature.useCases).map((row) => row.id));
  const criteriaRequirements = new Set([...asArray(feature.successCriteria), ...asArray(feature.antiSuccessCriteria)].flatMap((row) => asArray(row.requirementIds)));
  const scenarios = new Map(asArray(feature.scenarios).map((row) => [row.id, row]));
  const journeysByContract = new Map();
  for (const journey of asArray(feature.journeyMatrix)) {
    const rows = journeysByContract.get(journey.contractId) ?? [];
    rows.push(journey);
    journeysByContract.set(journey.contractId, rows);
  }
  for (const requirement of asArray(feature.functionalRequirements)) {
    if (!useCases.has(requirement.useCaseId)) failures.push(`${requirement.id}: requirement must map to a use case`);
    if (!criteriaRequirements.has(requirement.id)) failures.push(`${requirement.id}: requirement must map to success or anti-success criteria`);
  }
  for (const contract of asArray(feature.experienceContracts)) {
    for (const field of uxConfig.requiredContractFields ?? []) {
      const raw = contract[field];
      if (Array.isArray(raw) ? raw.length === 0 : !raw) failures.push(`${contract.id}: missing ${field}`);
    }
    for (const reqId of asArray(contract.requirementIds)) {
      if (!requirements.has(reqId)) failures.push(`${contract.id}: unknown requirement ${reqId}`);
    }
    const outcomes = new Set();
    for (const scenarioId of asArray(contract.scenarioIds)) {
      const scenario = scenarios.get(scenarioId);
      if (!scenario) failures.push(`${contract.id}: unknown scenario ${scenarioId}`);
      else outcomes.add(scenario.outcome);
    }
    for (const outcome of asArray(uxConfig.requiredScenarioOutcomes)) {
      if (!outcomes.has(outcome)) failures.push(`${contract.id}: missing ${outcome} scenario`);
    }
    const profile = surfaceProfile(uxConfig, contract.surface);
    const states = new Set(asArray(contract.uiStates));
    for (const state of asArray(profile?.requiredStates)) {
      if (!states.has(state)) warnings.push(`${contract.id}: ${profile.id} profile recommends state ${state}`);
    }
    const journeys = journeysByContract.get(contract.id) ?? [];
    for (const outcome of asArray(uxConfig.requiredScenarioOutcomes)) {
      if (!journeys.some((row) => row.outcome === outcome)) failures.push(`${contract.id}: journey matrix missing ${outcome} row`);
    }
    if (!asArray(feature.rbacStories).some((row) => row.persona === contract.persona && row.role === contract.role)) {
      failures.push(`${contract.id}: no RBAC story for ${contract.persona}:${contract.role}`);
    }
  }
  return { failures, warnings };
}

function payload(featureId = "") {
  const elicitation = readJson(elicitationPath);
  const uxConfig = readJson(uxPath);
  const features = featureId ? asArray(elicitation.features).filter((feature) => feature.id === featureId) : asArray(elicitation.features);
  if (featureId && !features.length) throw new Error(`Unknown feature ${featureId}`);
  const featureResults = features.map((feature) => ({ featureId: feature.id, ...validateFeature(feature, uxConfig) }));
  const failures = featureResults.flatMap((row) => row.failures);
  const warnings = featureResults.flatMap((row) => row.warnings);
  return {
    kind: "ux-as-code-validation",
    generatedAt: new Date().toISOString(),
    modelVersion: uxConfig.modelVersion,
    valid: failures.length === 0,
    feature: { id: featureId },
    summary: {
      features: features.length,
      contracts: features.reduce((total, feature) => total + asArray(feature.experienceContracts).length, 0),
      journeys: features.reduce((total, feature) => total + asArray(feature.journeyMatrix).length, 0),
      failures: failures.length,
      warnings: warnings.length,
    },
    failures,
    warnings,
    featureResults,
  };
}

function toonEscape(input) {
  return String(input ?? "").replaceAll("\t", " ").replaceAll("\n", " ").trim();
}

function render(result, format) {
  if (format === "json") return `${JSON.stringify(result, null, 2)}\n`;
  if (format === "toon") {
    return `${[
      "uxAsCode:",
      `  valid: ${result.valid}`,
      `  features: ${result.summary.features}`,
      `  contracts: ${result.summary.contracts}`,
      `  failures: ${result.summary.failures}`,
      `failures[${result.failures.length}]{message}:`,
      ...result.failures.map((message) => toonEscape(message)),
      `warnings[${result.warnings.length}]{message}:`,
      ...result.warnings.map((message) => toonEscape(message)),
    ].join("\n")}\n`;
  }
  if (format === "markdown") {
    return `# UX As Code Validation

Valid: ${result.valid}
Features: ${result.summary.features}
Contracts: ${result.summary.contracts}
Failures: ${result.summary.failures}
Warnings: ${result.summary.warnings}
`;
  }
  throw new Error(`Unsupported format ${format}`);
}

const args = parseArgs(process.argv.slice(2));
if (!["validate", "packet"].includes(args.command)) {
  console.log("Usage: node scripts/adg-ux.mjs validate|packet [--feature S07] [--format json|toon|markdown]");
  process.exit(args.command === "help" ? 0 : 1);
}

try {
  const result = payload(value(args, "feature"));
  process.stdout.write(render(result, value(args, "format", args.command === "packet" ? "toon" : "json")));
  if (!result.valid) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
