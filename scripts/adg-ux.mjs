#!/usr/bin/env node
// Requirements-to-UX-as-code validator and truth-pass reporter.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const elicitationPath = "config/agentic/elicitation.json";
const uxPath = "config/agentic/ux-as-code.json";
const backlogDbPath = "data/backlog.sqlite";

const lifecycleClasses = new Set(["live", "partial", "hidden", "staged", "broken"]);
const liveLikeStatuses = new Set(["live", "verified", "implemented", "released"]);
const openItemStatuses = new Set(["planned", "claimed", "in-progress", "blocked", "failed", "deferred"]);
const liveExpectedStates = new Set(["live", "success", "ready", "valid-packet"]);
const routeStatePattern = /^(?:route|page|screen):/u;
const vagueEvidencePattern = /\b(?:verified|tested|checked|works|done)\b/iu;

function abs(file) {
  return path.isAbsolute(file) ? file : path.join(root, file);
}

function parseArgs(argv) {
  const args = { command: argv[0] ?? "help", flags: new Set(), values: {} };
  for (let i = 1; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    args.flags.add(key);
    if (next && !next.startsWith("--")) {
      args.values[key] = next;
      i += 1;
    } else {
      args.values[key] = true;
    }
  }
  return args;
}

function value(args, key, fallback = "") {
  const raw = args.values[key];
  if (raw === undefined || raw === true) return fallback;
  return String(raw);
}

function hasFlag(args, key) {
  return args.flags.has(key);
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

function sqlString(input) {
  if (input === null || input === undefined) return "NULL";
  return `'${String(input).replaceAll("'", "''")}'`;
}

function sqliteJson(sql) {
  if (!fs.existsSync(abs(backlogDbPath))) return [];
  try {
    const output = execFileSync("sqlite3", ["-json", abs(backlogDbPath), sql], { cwd: root, encoding: "utf8" }).trim();
    return output ? JSON.parse(output) : [];
  } catch {
    return [];
  }
}

function featureFilter(featureIds) {
  if (!featureIds.length) return "";
  return ` where feature_id in (${featureIds.map(sqlString).join(",")})`;
}

function readBacklogSnapshot(features) {
  const ids = features.map((feature) => feature.id).filter(Boolean);
  const featureRows = sqliteJson(`select * from feature_current_status${featureFilter(ids)}`);
  const itemRows = sqliteJson(`select * from backlog_item_current_status${featureFilter(ids)}`);
  const routeRows = sqliteJson(`select * from routes where feature_id in (${ids.map(sqlString).join(",") || "''"}) order by feature_id, path`);
  const workflowRows = sqliteJson(`select * from persona_workflows${featureFilter(ids)}`);
  return {
    available: fs.existsSync(abs(backlogDbPath)),
    features: featureRows,
    items: itemRows,
    routes: routeRows,
    personaWorkflows: workflowRows,
  };
}

function deriveRoutePattern(surface = "") {
  const text = String(surface ?? "");
  if (routeStatePattern.test(text)) return text.replace(routeStatePattern, "");
  return text;
}

function contractMap(feature) {
  return new Map(asArray(feature.experienceContracts).map((contract) => [contract.id, contract]));
}

function scenarioMap(feature) {
  return new Map(asArray(feature.scenarios).map((scenario) => [scenario.id, scenario]));
}

function routeLike(surface = "") {
  return String(surface ?? "").startsWith("route:");
}

function commandLike(evidence = "") {
  return /\b(?:npm|pnpm|yarn|node|npx|playwright|vitest|jest|pytest|curl|sqlite3)\b/u.test(String(evidence ?? ""));
}

function pathLike(evidence = "") {
  return /(?:^|[\s:])(?:[\w.-]+\/)+[\w./-]+(?:\.\w+)?/u.test(String(evidence ?? ""));
}

function normalizeJourney(feature, journey, contracts, scenarios) {
  const contract = contracts.get(journey.contractId) ?? {};
  const scenario = asArray(contract.scenarioIds)
    .map((id) => scenarios.get(id))
    .find((row) => row?.outcome === journey.outcome) ?? {};
  const surface = journey.surface ?? contract.surface ?? "";
  const evidence = journey.evidenceCommand ?? journey.testEvidence ?? scenario.testEvidence ?? asArray(contract.testEvidence)[0] ?? "";
  return {
    featureId: feature.id,
    featureName: feature.name ?? feature.title ?? feature.id,
    journeyId: journey.id,
    contractId: journey.contractId ?? "",
    routeId: journey.routeId ?? journey.routePattern ?? deriveRoutePattern(surface),
    routePattern: journey.routePattern ?? deriveRoutePattern(surface),
    surface,
    persona: journey.persona ?? contract.persona ?? "",
    tenantRole: journey.tenantRole ?? journey.role ?? contract.role ?? "",
    platformRole: journey.platformRole ?? "",
    role: journey.role ?? contract.role ?? "",
    businessScope: journey.businessScope ?? "",
    entitlement: journey.entitlement ?? "",
    expectedState: journey.expectedState ?? journey.state ?? "",
    state: journey.state ?? journey.expectedState ?? "",
    outcome: journey.outcome ?? scenario.outcome ?? "",
    primaryAction: journey.primaryAction ?? contract.primaryAction ?? "",
    fallbackAction: journey.fallbackAction ?? contract.fallbackAction ?? "",
    evidencePath: journey.evidencePath ?? "",
    evidenceCommand: evidence,
    expectedExperience: journey.expectedExperience ?? "",
    observedState: journey.observedState ?? "",
    smokeResult: journey.smokeResult ?? "",
  };
}

function buildJourneyMatrix(feature) {
  const contracts = contractMap(feature);
  const scenarios = scenarioMap(feature);
  return asArray(feature.journeyMatrix).map((journey) => normalizeJourney(feature, journey, contracts, scenarios));
}

function validationMessage(severity, message, details = {}) {
  return { severity, message, ...details };
}

function validateStructuralFeature(feature, uxConfig) {
  const failures = [];
  const warnings = [];
  const requirements = new Set(asArray(feature.functionalRequirements).map((row) => row.id));
  const useCases = new Set(asArray(feature.useCases).map((row) => row.id));
  const criteriaRequirements = new Set([...asArray(feature.successCriteria), ...asArray(feature.antiSuccessCriteria)].flatMap((row) => asArray(row.requirementIds)));
  const scenarios = scenarioMap(feature);
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

function evidenceMentionsJourney(evidence, row) {
  const text = String(evidence ?? "").toLowerCase();
  return [
    row.routePattern,
    row.persona,
    row.primaryAction,
    row.expectedState,
    row.outcome,
  ].some((part) => part && text.includes(String(part).toLowerCase()));
}

function validateEvidenceSpecificity(feature, journeyRows) {
  const failures = [];
  const warnings = [];
  const scenarios = asArray(feature.scenarios);
  const evidenceByText = new Map();
  for (const scenario of scenarios) {
    const evidence = String(scenario.testEvidence ?? "").trim();
    if (!evidence) continue;
    const rows = evidenceByText.get(evidence) ?? [];
    rows.push(scenario);
    evidenceByText.set(evidence, rows);
    if (vagueEvidencePattern.test(evidence) && !commandLike(evidence) && !pathLike(evidence)) {
      warnings.push(validationMessage("high", `${scenario.id}: evidence is too generic; name a route/persona/action/assertion/command`, { featureId: feature.id, scenarioId: scenario.id }));
    }
  }
  for (const [evidence, rows] of evidenceByText.entries()) {
    const outcomes = new Set(rows.map((row) => row.outcome));
    if (rows.length > 1 && outcomes.size > 1) {
      warnings.push(validationMessage("medium", `${feature.id}: evidence reused across ${[...outcomes].join(", ")} scenarios: ${evidence}`, { featureId: feature.id, evidence }));
    }
  }
  for (const row of journeyRows) {
    const evidence = row.evidenceCommand || row.evidencePath;
    if (!evidence) {
      failures.push(validationMessage("high", `${row.journeyId}: missing runnable evidence command or evidence path`, { featureId: feature.id, journeyId: row.journeyId }));
      continue;
    }
    if (routeLike(row.surface) && liveExpectedStates.has(row.expectedState) && !evidenceMentionsJourney(evidence, row) && !commandLike(evidence) && !pathLike(evidence)) {
      failures.push(validationMessage("high", `${row.journeyId}: live route evidence must name route, persona, action, assertion, or command`, { featureId: feature.id, journeyId: row.journeyId }));
    }
  }
  return { failures, warnings };
}

function validateSubstantiveFeature(feature, uxConfig, snapshot) {
  const failures = [];
  const warnings = [];
  const journeyRows = buildJourneyMatrix(feature);
  const requiredJourneyFields = asArray(uxConfig.requiredJourneyFields ?? ["featureId", "routePattern", "persona", "expectedState", "primaryAction", "fallbackAction", "evidenceCommand"]);
  for (const row of journeyRows) {
    for (const field of requiredJourneyFields) {
      if (!row[field]) failures.push(validationMessage("high", `${row.journeyId}: missing ${field}`, { featureId: feature.id, journeyId: row.journeyId, field }));
    }
  }

  const routeJourneyRows = journeyRows.filter((row) => routeLike(row.surface) || routeLike(row.routePattern));
  const liveRouteJourneyRows = routeJourneyRows.filter((row) => liveExpectedStates.has(row.expectedState) || row.expectedState === "live");
  const liveRouteKeys = new Set(liveRouteJourneyRows.map((row) => `${row.routePattern}|${row.persona}|${row.expectedState}`));
  const routeContracts = asArray(feature.experienceContracts).filter((contract) => routeLike(contract.surface));
  if (routeContracts.length === 1 && liveRouteKeys.size > 1) {
    failures.push(validationMessage("high", `${feature.id}: one generic route contract covers ${liveRouteKeys.size} live route/persona/state journeys; split route/persona contracts or make each journey explicit`, { featureId: feature.id }));
  }

  const smokeRows = asArray(feature.browserSmokeMatrix);
  const smokePersonas = new Set(asArray(uxConfig.browserSmokePersonas ?? ["owner", "admin", "manager", "staff", "viewer"]));
  for (const row of liveRouteJourneyRows) {
    if (!smokePersonas.has(row.persona)) continue;
    const smoke = smokeRows.find((candidate) => candidate.route === row.routePattern && candidate.persona === row.persona && candidate.expectedState === row.expectedState);
    if (!smoke) warnings.push(validationMessage("high", `${row.journeyId}: live route/persona has no browser smoke evidence`, { featureId: feature.id, journeyId: row.journeyId, route: row.routePattern, persona: row.persona }));
    else if (String(smoke.result ?? "").toLowerCase() !== "pass") failures.push(validationMessage("high", `${row.journeyId}: browser smoke evidence is not passing`, { featureId: feature.id, journeyId: row.journeyId, result: smoke.result ?? "" }));
  }

  const featureRoutes = snapshot.routes.filter((route) => route.feature_id === feature.id);
  for (const route of featureRoutes.filter((row) => row.status === "live")) {
    const hasJourney = journeyRows.some((row) => row.routePattern === route.path || row.routeId === route.path || row.surface === route.path);
    if (!hasJourney && route.kind === "cli") warnings.push(validationMessage("high", `${feature.id}: live CLI route ${route.path} has no journey contract row`, { featureId: feature.id, route: route.path }));
    else if (!hasJourney) failures.push(validationMessage("high", `${feature.id}: live SQL route ${route.path} has no journey contract row`, { featureId: feature.id, route: route.path }));
  }
  for (const workflow of snapshot.personaWorkflows.filter((row) => row.feature_id === feature.id)) {
    const hasJourney = journeyRows.some((row) => row.persona === workflow.persona_id && (row.routePattern === workflow.primary_route || row.surface === workflow.primary_route || !workflow.primary_route));
    if (!hasJourney && workflow.status !== "planned") warnings.push(validationMessage("medium", `${feature.id}: persona workflow ${workflow.persona_id}:${workflow.primary_route} is not covered by a journey row`, { featureId: feature.id }));
  }

  const evidence = validateEvidenceSpecificity(feature, journeyRows);
  failures.push(...evidence.failures);
  warnings.push(...evidence.warnings);
  return { failures, warnings, journeyRows };
}

function mapStatusToClassification(status) {
  const normalized = String(status ?? "").toLowerCase();
  if (lifecycleClasses.has(normalized)) return normalized;
  if (["verified", "implemented", "released"].includes(normalized)) return "live";
  if (["in-progress", "active", "claimed"].includes(normalized)) return "partial";
  if (["planned", "deferred"].includes(normalized)) return "staged";
  if (["blocked", "failed"].includes(normalized)) return "broken";
  return "partial";
}

function classifyFeature(feature, structural, substantive, snapshot) {
  const dbStatus = snapshot.features.find((row) => row.feature_id === feature.id)?.current_status;
  const configured = feature.lifecycle ?? feature.truthClassification ?? feature.status ?? dbStatus;
  let classification = mapStatusToClassification(configured);
  if (substantive.failures.length || structural.failures.length) classification = "broken";
  const downgrade = [];
  if (classification === "broken") {
    downgrade.push({
      featureId: feature.id,
      recommendedClassification: "broken",
      reason: "Journey evidence has hard structural or substantive failures.",
    });
  } else if (classification === "live" && substantive.warnings.some((warning) => warning.severity === "high")) {
    downgrade.push({
      featureId: feature.id,
      recommendedClassification: "partial",
      reason: "Live classification has high-severity journey evidence warnings.",
    });
  }
  const openItems = snapshot.items.filter((item) => item.feature_id === feature.id && openItemStatuses.has(item.current_status));
  if (liveLikeStatuses.has(String(dbStatus ?? "").toLowerCase()) && openItems.length) {
    substantive.warnings.push(validationMessage("high", `${feature.id}: SQL status is ${dbStatus} but ${openItems.length} backlog rows remain open`, { featureId: feature.id, openItems: openItems.map((item) => item.id) }));
    downgrade.push({
      featureId: feature.id,
      recommendedClassification: classification === "live" ? "partial" : classification,
      reason: `SQL status is ${dbStatus} while open backlog rows remain.`,
    });
  }
  return { classification, dbStatus: dbStatus ?? "", downgrade };
}

function payload(featureId = "", options = {}) {
  const elicitation = readJson(value(options.args ?? { values: {} }, "config", elicitationPath));
  const uxConfig = readJson(value(options.args ?? { values: {} }, "ux-config", uxPath));
  const features = featureId ? asArray(elicitation.features).filter((feature) => feature.id === featureId) : asArray(elicitation.features);
  if (featureId && !features.length) throw new Error(`Unknown feature ${featureId}`);
  const snapshot = readBacklogSnapshot(features);
  const featureResults = features.map((feature) => {
    const structural = validateStructuralFeature(feature, uxConfig);
    const substantive = validateSubstantiveFeature(feature, uxConfig, snapshot);
    const truth = classifyFeature(feature, structural, substantive, snapshot);
    return {
      featureId: feature.id,
      featureName: feature.name ?? "",
      structural: {
        valid: structural.failures.length === 0,
        failures: structural.failures,
        warnings: structural.warnings,
      },
      substantive: {
        valid: substantive.failures.length === 0,
        failures: substantive.failures,
        warnings: substantive.warnings,
      },
      truthClassification: truth.classification,
      sqlStatus: truth.dbStatus,
      downgradeRecommendations: truth.downgrade,
      journeyMatrix: substantive.journeyRows,
    };
  });
  const structuralFailures = featureResults.flatMap((row) => row.structural.failures);
  const structuralWarnings = featureResults.flatMap((row) => row.structural.warnings);
  const substantiveFailures = featureResults.flatMap((row) => row.substantive.failures);
  const substantiveWarnings = featureResults.flatMap((row) => row.substantive.warnings);
  const mode = options.mode ?? "all";
  const valid = (mode === "structural" ? structuralFailures.length : structuralFailures.length + substantiveFailures.length) === 0;
  return {
    kind: options.kind ?? "ux-as-code-validation",
    generatedAt: new Date().toISOString(),
    modelVersion: uxConfig.modelVersion,
    readOnly: true,
    mode,
    feature: { id: featureId },
    valid,
    validationClasses: {
      structural: {
        valid: structuralFailures.length === 0,
        failures: structuralFailures.length,
        warnings: structuralWarnings.length,
      },
      substantive: {
        valid: substantiveFailures.length === 0,
        failures: substantiveFailures.length,
        warnings: substantiveWarnings.length,
      },
    },
    summary: {
      features: features.length,
      contracts: features.reduce((total, feature) => total + asArray(feature.experienceContracts).length, 0),
      journeys: features.reduce((total, feature) => total + asArray(feature.journeyMatrix).length, 0),
      journeyContracts: featureResults.reduce((total, row) => total + row.journeyMatrix.length, 0),
      failures: structuralFailures.length + substantiveFailures.length,
      warnings: structuralWarnings.length + substantiveWarnings.length,
      highSeverityWarnings: substantiveWarnings.filter((warning) => warning.severity === "high").length,
      truthClassifications: featureResults.reduce((counts, row) => {
        counts[row.truthClassification] = (counts[row.truthClassification] ?? 0) + 1;
        return counts;
      }, {}),
      downgradeRecommendations: featureResults.reduce((total, row) => total + row.downgradeRecommendations.length, 0),
    },
    failures: [
      ...structuralFailures.map((message) => ({ severity: "high", message, class: "structural" })),
      ...substantiveFailures.map((failure) => ({ ...failure, class: "substantive" })),
    ],
    warnings: [
      ...structuralWarnings.map((message) => ({ severity: "medium", message, class: "structural" })),
      ...substantiveWarnings.map((warning) => ({ ...warning, class: "substantive" })),
    ],
    downgradeRecommendations: featureResults.flatMap((row) => row.downgradeRecommendations),
    featureResults,
    sourceState: {
      backlogDbAvailable: snapshot.available,
      sqliteReadOnly: true,
    },
  };
}

function toonEscape(input) {
  return String(input ?? "").replaceAll("\t", " ").replaceAll("\n", " ").trim();
}

function md(input) {
  return String(input ?? "").replaceAll("|", "\\|").replace(/\s+/gu, " ").trim();
}

function markdownTable(rows, columns) {
  if (!rows.length) return "_None._";
  return [
    `| ${columns.map((column) => column.label).join(" | ")} |`,
    `| ${columns.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${columns.map((column) => md(row[column.key])).join(" | ")} |`),
  ].join("\n");
}

function renderMarkdown(result) {
  const journeys = result.featureResults.flatMap((feature) => feature.journeyMatrix.map((row) => ({ ...row, truthClassification: feature.truthClassification })));
  return `# ADG Truth-Pass Report

Generated: ${result.generatedAt}
Valid: ${result.valid}
Mode: ${result.mode}

## Validation Classes

| Class | Valid | Failures | Warnings |
| --- | --- | --- | --- |
| Structural | ${result.validationClasses.structural.valid} | ${result.validationClasses.structural.failures} | ${result.validationClasses.structural.warnings} |
| Substantive journey | ${result.validationClasses.substantive.valid} | ${result.validationClasses.substantive.failures} | ${result.validationClasses.substantive.warnings} |

## Feature Classification

${markdownTable(result.featureResults, [
  { key: "featureId", label: "Feature" },
  { key: "featureName", label: "Name" },
  { key: "truthClassification", label: "Truth" },
  { key: "sqlStatus", label: "SQL Status" },
])}

## Route / Persona Journey Matrix

${markdownTable(journeys, [
  { key: "featureId", label: "Feature" },
  { key: "routePattern", label: "Route" },
  { key: "persona", label: "Persona" },
  { key: "tenantRole", label: "Role" },
  { key: "expectedState", label: "Expected State" },
  { key: "primaryAction", label: "Primary Action" },
  { key: "fallbackAction", label: "Fallback" },
  { key: "evidenceCommand", label: "Evidence" },
])}

## Downgrade Recommendations

${markdownTable(result.downgradeRecommendations, [
  { key: "featureId", label: "Feature" },
  { key: "recommendedClassification", label: "Recommended" },
  { key: "reason", label: "Reason" },
])}

## Failures

${markdownTable(result.failures, [
  { key: "severity", label: "Severity" },
  { key: "class", label: "Class" },
  { key: "message", label: "Message" },
])}

## Warnings

${markdownTable(result.warnings, [
  { key: "severity", label: "Severity" },
  { key: "class", label: "Class" },
  { key: "message", label: "Message" },
])}
`;
}

function render(result, format) {
  if (format === "json") return `${JSON.stringify(result, null, 2)}\n`;
  if (format === "toon") {
    return `${[
      "uxTruthPass:",
      `  valid: ${result.valid}`,
      `  mode: ${result.mode}`,
      `  features: ${result.summary.features}`,
      `  contracts: ${result.summary.contracts}`,
      `  journeys: ${result.summary.journeys}`,
      `  structuralFailures: ${result.validationClasses.structural.failures}`,
      `  substantiveFailures: ${result.validationClasses.substantive.failures}`,
      `  highSeverityWarnings: ${result.summary.highSeverityWarnings}`,
      `classifications[${Object.keys(result.summary.truthClassifications).length}]{class,count}:`,
      ...Object.entries(result.summary.truthClassifications).map(([classification, count]) => `${toonEscape(classification)}\t${count}`),
      `downgrades[${result.downgradeRecommendations.length}]{featureId,recommendedClassification,reason}:`,
      ...result.downgradeRecommendations.map((row) => `${toonEscape(row.featureId)}\t${toonEscape(row.recommendedClassification)}\t${toonEscape(row.reason)}`),
      `failures[${result.failures.length}]{severity,class,message}:`,
      ...result.failures.map((row) => `${toonEscape(row.severity)}\t${toonEscape(row.class)}\t${toonEscape(row.message)}`),
      `warnings[${result.warnings.length}]{severity,class,message}:`,
      ...result.warnings.map((row) => `${toonEscape(row.severity)}\t${toonEscape(row.class)}\t${toonEscape(row.message)}`),
    ].join("\n")}\n`;
  }
  if (format === "markdown") return renderMarkdown(result);
  throw new Error(`Unsupported format ${format}`);
}

function usage() {
  console.log(`Usage:
  node scripts/adg-ux.mjs validate [--config path] [--ux-config path] [--feature S07] [--mode structural|substantive|all] [--format json|toon|markdown] [--check|--read-only]
  node scripts/adg-ux.mjs packet --feature S07 [--format json|toon|markdown]
  node scripts/adg-ux.mjs truth-pass [--config path] [--ux-config path] [--feature S07] [--format json|toon|markdown] [--check|--read-only]
  node scripts/adg-ux.mjs downgrade [--config path] [--ux-config path] [--feature S07] [--format json|toon|markdown]

All commands are read-only. The downgrade command reports deterministic
recommendations; it does not mutate the SQL backlog.`);
}

const args = parseArgs(process.argv.slice(2));
if (args.command === "help") {
  usage();
  process.exit(0);
}
if (!["validate", "packet", "truth-pass", "downgrade"].includes(args.command)) {
  usage();
  process.exit(1);
}

try {
  const commandMode = args.command === "validate" ? value(args, "mode", "all") : "all";
  if (!["structural", "substantive", "all"].includes(commandMode)) throw new Error(`Unsupported mode ${commandMode}`);
  const result = payload(value(args, "feature"), {
    args,
    mode: commandMode,
    kind: args.command === "truth-pass" || args.command === "downgrade" ? "adg-truth-pass-report" : "ux-as-code-validation",
  });
  const output = args.command === "downgrade" ? { ...result, featureResults: [], failures: [], warnings: [] } : result;
  process.stdout.write(render(output, value(args, "format", args.command === "packet" ? "toon" : "json")));
  if (!result.valid && args.command !== "downgrade") process.exitCode = 1;
  if ((hasFlag(args, "check") || hasFlag(args, "read-only")) && !result.readOnly) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
