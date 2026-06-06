#!/usr/bin/env node
// Feature elicitation as code.
//
// Editable source: config/agentic/elicitation.json
// Queryable mirror: data/elicitation.sqlite
// Agent transport: JSON / Markdown / TOON packets

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const defaultConfigPath = "config/agentic/elicitation.json";
const sqlitePath = "data/elicitation.sqlite";

function abs(file) {
  if (path.isAbsolute(file)) return file;
  return path.join(root, file);
}

function parseArgs(argv) {
  const args = { command: argv[0] ?? "help", flags: new Set(), values: {} };
  for (let i = 1; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--") continue;
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

function sqlString(input) {
  if (input === null || input === undefined) return "NULL";
  return `'${String(input).replaceAll("'", "''")}'`;
}

function usage() {
  console.log(`Usage:
  node scripts/adg-elicitation.mjs validate [--config config/agentic/elicitation.json] [--feature S07] [--format json|markdown|toon] [--no-sqlite|--check|--read-only]
  node scripts/adg-elicitation.mjs packet --feature S07 [--format json|markdown|toon]
  node scripts/adg-elicitation.mjs graph [--feature S07] [--format json|markdown|toon]

The validator treats elicitation coverage gaps as advisory unless config policy
marks them as hard-gated. Invalid config shape still exits non-zero. By default
validate refreshes the SQLite projection for the default config; --check and
--read-only compare the existing projection without writing.`);
}

function loadConfig(configPath) {
  return JSON.parse(fs.readFileSync(abs(configPath), "utf8"));
}

function asArray(valueToCheck) {
  return Array.isArray(valueToCheck) ? valueToCheck : [];
}

function byId(rows) {
  return new Set(asArray(rows).map((row) => row.id).filter(Boolean));
}

function asMap(rows) {
  return new Map(asArray(rows).map((row) => [row.id, row]));
}

function deriveRoutePattern(surface = "") {
  const text = String(surface ?? "");
  if (/^(?:route|page|screen):/u.test(text)) return text.replace(/^(?:route|page|screen):/u, "");
  return text;
}

function enrichJourney(feature, journey) {
  const contracts = asMap(feature.experienceContracts);
  const scenarios = asMap(feature.scenarios);
  const contract = contracts.get(journey.contractId) ?? {};
  const scenario = asArray(contract.scenarioIds)
    .map((id) => scenarios.get(id))
    .find((row) => row?.outcome === journey.outcome) ?? {};
  const surface = journey.surface ?? contract.surface ?? "";
  return {
    ...journey,
    featureId: feature.id,
    routeId: journey.routeId ?? journey.routePattern ?? deriveRoutePattern(surface),
    routePattern: journey.routePattern ?? deriveRoutePattern(surface),
    tenantRole: journey.tenantRole ?? journey.role ?? contract.role ?? "",
    platformRole: journey.platformRole ?? "",
    businessScope: journey.businessScope ?? "",
    entitlement: journey.entitlement ?? "",
    expectedState: journey.expectedState ?? journey.state ?? "",
    primaryAction: journey.primaryAction ?? contract.primaryAction ?? "",
    fallbackAction: journey.fallbackAction ?? contract.fallbackAction ?? "",
    evidencePath: journey.evidencePath ?? "",
    evidenceCommand: journey.evidenceCommand ?? journey.testEvidence ?? scenario.testEvidence ?? asArray(contract.testEvidence)[0] ?? "",
  };
}

function makeGap({ featureId, domain, severity = "medium", summary, remediation = "", blocksImplementation = false, channel = "gap-register" }) {
  return {
    id: `GAP-${featureId}-${domain.toUpperCase()}-${Math.random().toString(16).slice(2, 8)}`,
    featureId,
    domain,
    severity,
    summary,
    remediation,
    channel,
    blocksImplementation,
  };
}

function validateFeature(feature, config) {
  const failures = [];
  const gaps = [];
  const featureId = feature?.id ?? "UNKNOWN";
  const addGap = (fields) => gaps.push(makeGap({ featureId, ...fields }));

  if (!feature?.id) failures.push("feature is missing id");
  if (!feature?.name) failures.push(`${featureId}: feature is missing name`);

  for (const field of ["goalFit", "platformFit", "expectedValue"]) {
    if (!feature?.brief?.[field]) addGap({ domain: "feature_brief", summary: `${featureId}: brief.${field} is missing`, remediation: "Complete the feature brief before implementation evidence is finalized." });
  }
  if (!asArray(feature?.brief?.nonGoals).length) addGap({ domain: "feature_brief", summary: `${featureId}: brief.nonGoals is empty`, remediation: "Name explicit non-goals so agents do not invent scope." });
  if (!asArray(feature?.brief?.risks).length) addGap({ domain: "feature_brief", summary: `${featureId}: brief.risks is empty`, remediation: "Name delivery, safety, or context risks." });

  if (!asArray(feature.rbacStories).length) addGap({ domain: "rbac", severity: "high", summary: `${featureId}: no RBAC-aligned stories`, remediation: "Add at least one persona/role/access story." });
  if (!asArray(feature.userStories).length) addGap({ domain: "requirements", severity: "high", summary: `${featureId}: no user stories`, remediation: "Add user stories before building the feature." });
  if (!asArray(feature.useCases).length) addGap({ domain: "requirements", severity: "high", summary: `${featureId}: no use cases`, remediation: "Add use cases linked to user stories." });

  const requirements = asArray(feature.functionalRequirements);
  if (!requirements.some((row) => row.level === "high")) addGap({ domain: "requirements", severity: "high", summary: `${featureId}: no high-level functional requirements`, remediation: "Add outcome-level requirements." });
  if (!requirements.some((row) => row.level === "low")) addGap({ domain: "requirements", severity: "high", summary: `${featureId}: no low-level functional requirements`, remediation: "Add state, validation, scope, data, and failure behavior requirements." });
  if (!asArray(feature.successCriteria).length) addGap({ domain: "criteria", severity: "high", summary: `${featureId}: no success criteria`, remediation: "Add observable success criteria." });
  if (!asArray(feature.antiSuccessCriteria).length) addGap({ domain: "criteria", severity: "high", summary: `${featureId}: no anti-success criteria`, remediation: "Add explicit unsafe or misleading outcomes to prevent." });
  if (!asArray(feature.experienceContracts).length) addGap({ domain: "ux_as_code", severity: "high", summary: `${featureId}: no experience contracts`, remediation: "Add an experience contract as the agent build document." });
  if (!asArray(feature.journeyMatrix).length) addGap({ domain: "ux_as_code", severity: "medium", summary: `${featureId}: no journey matrix`, remediation: "Add compact persona/state/outcome rows for agent review." });

  const requirementIds = byId(requirements);
  const scenarioIds = byId(feature.scenarios);
  const contractIds = byId(feature.experienceContracts);
  const useCaseIds = byId(feature.useCases);

  for (const useCase of asArray(feature.useCases)) {
    if (!useCase.storyId) addGap({ domain: "requirements", summary: `${useCase.id}: use case is not linked to a story`, remediation: "Set storyId." });
  }
  for (const requirement of requirements) {
    if (requirement.useCaseId && !useCaseIds.has(requirement.useCaseId)) failures.push(`${requirement.id}: unknown useCaseId ${requirement.useCaseId}`);
  }
  for (const criterion of [...asArray(feature.successCriteria), ...asArray(feature.antiSuccessCriteria)]) {
    for (const reqId of asArray(criterion.requirementIds)) {
      if (!requirementIds.has(reqId)) failures.push(`${criterion.id}: unknown requirement ${reqId}`);
    }
  }
  for (const contract of asArray(feature.experienceContracts)) {
    if (contract.useCaseId && !useCaseIds.has(contract.useCaseId)) failures.push(`${contract.id}: unknown useCaseId ${contract.useCaseId}`);
    if (!asArray(contract.requirementIds).length) addGap({ domain: "ux_as_code", summary: `${contract.id}: no requirement links`, remediation: "Link the contract to high and low functional requirements." });
    if (!asArray(contract.scenarioIds).length) addGap({ domain: "ux_as_code", summary: `${contract.id}: no scenario links`, remediation: "Link happy, sad, denial, and recovery scenarios." });
    if (!asArray(contract.testEvidence).length) addGap({ domain: "testing", summary: `${contract.id}: no test evidence`, remediation: "Name at least one test or verification command." });
    for (const reqId of asArray(contract.requirementIds)) {
      if (!requirementIds.has(reqId)) failures.push(`${contract.id}: unknown requirement ${reqId}`);
    }
    for (const scenarioId of asArray(contract.scenarioIds)) {
      if (!scenarioIds.has(scenarioId)) failures.push(`${contract.id}: unknown scenario ${scenarioId}`);
    }
  }
  for (const row of asArray(feature.journeyMatrix)) {
    if (row.contractId && !contractIds.has(row.contractId)) failures.push(`${row.id}: unknown contractId ${row.contractId}`);
    if (!row.expectedExperience) addGap({ domain: "ux_as_code", summary: `${row.id}: missing expectedExperience`, remediation: "Describe what the user should experience." });
  }

  const configuredOutcomes = asArray(config.policy?.requiredScenarioOutcomes);
  const outcomes = new Set(asArray(feature.scenarios).map((scenario) => scenario.outcome));
  for (const outcome of configuredOutcomes) {
    if (!outcomes.has(outcome)) addGap({ domain: "scenarios", severity: "high", summary: `${featureId}: missing ${outcome} scenario`, remediation: `Add at least one ${outcome} path scenario.` });
  }

  for (const gap of asArray(feature.gaps)) gaps.push({ featureId, blocksImplementation: false, channel: "gap-register", ...gap });
  return { failures, gaps };
}

function validateConfig(config) {
  const failures = [];
  const gaps = [];
  if (config.schemaVersion !== 1) failures.push("schemaVersion must be 1");
  if (!config.modelVersion) failures.push("modelVersion is required");
  if (!Array.isArray(config.features)) failures.push("features must be an array");
  const featureIds = new Set();
  for (const feature of asArray(config.features)) {
    if (featureIds.has(feature.id)) failures.push(`duplicate feature ${feature.id}`);
    featureIds.add(feature.id);
    const result = validateFeature(feature, config);
    failures.push(...result.failures);
    gaps.push(...result.gaps);
  }
  const hardGaps = gaps.filter((gap) => gap.blocksImplementation === true);
  return {
    valid: failures.length === 0 && hardGaps.length === 0,
    failures,
    gaps,
    hardGaps,
  };
}

function flatten(config, validation) {
  const features = asArray(config.features);
  return {
    features,
    rbacStories: features.flatMap((feature) => asArray(feature.rbacStories).map((row) => ({ featureId: feature.id, ...row }))),
    userStories: features.flatMap((feature) => asArray(feature.userStories).map((row) => ({ featureId: feature.id, ...row }))),
    useCases: features.flatMap((feature) => asArray(feature.useCases).map((row) => ({ featureId: feature.id, ...row }))),
    requirements: features.flatMap((feature) => asArray(feature.functionalRequirements).map((row) => ({ featureId: feature.id, ...row }))),
    successCriteria: features.flatMap((feature) => asArray(feature.successCriteria).map((row) => ({ featureId: feature.id, type: "success", ...row }))),
    antiSuccessCriteria: features.flatMap((feature) => asArray(feature.antiSuccessCriteria).map((row) => ({ featureId: feature.id, type: "anti-success", ...row }))),
    contracts: features.flatMap((feature) => asArray(feature.experienceContracts).map((row) => ({ featureId: feature.id, ...row }))),
    scenarios: features.flatMap((feature) => asArray(feature.scenarios).map((row) => ({ featureId: feature.id, ...row }))),
    journeyMatrix: features.flatMap((feature) => asArray(feature.journeyMatrix).map((row) => enrichJourney(feature, row))),
    gaps: validation.gaps,
  };
}

function graphNode(type, id, label, featureId, attributes = {}) {
  return {
    id: `${type}:${id}`,
    type,
    sourceId: id,
    featureId,
    label: label || id,
    attributes,
  };
}

function graphEdge(type, fromType, fromId, toType, toId, featureId, attributes = {}) {
  return {
    id: `${type}:${fromType}:${fromId}->${toType}:${toId}`,
    type,
    from: `${fromType}:${fromId}`,
    to: `${toType}:${toId}`,
    featureId,
    attributes,
  };
}

function buildGraph(config, validation, featureId = "") {
  const requestedFeatures = featureId ? asArray(config.features).filter((feature) => feature.id === featureId) : asArray(config.features);
  if (featureId && !requestedFeatures.length) throw new Error(`Unknown elicitation feature ${featureId}`);
  const nodes = [];
  const edges = [];
  for (const feature of requestedFeatures) {
    nodes.push(graphNode("feature", feature.id, feature.name, feature.id, { status: feature.status ?? "" }));
    for (const story of asArray(feature.userStories)) {
      nodes.push(graphNode("user_story", story.id, story.goal, feature.id, { persona: story.persona ?? "", benefit: story.benefit ?? "" }));
      edges.push(graphEdge("feature_to_story", "feature", feature.id, "user_story", story.id, feature.id));
    }
    for (const rbac of asArray(feature.rbacStories)) {
      nodes.push(graphNode("rbac_story", rbac.id, rbac.story, feature.id, { persona: rbac.persona ?? "", role: rbac.role ?? "", access: rbac.access ?? "", realm: rbac.realm ?? "" }));
      edges.push(graphEdge("feature_to_rbac_story", "feature", feature.id, "rbac_story", rbac.id, feature.id));
    }
    for (const useCase of asArray(feature.useCases)) {
      nodes.push(graphNode("use_case", useCase.id, useCase.name, feature.id, { primaryActor: useCase.primaryActor ?? "", expectedOutcome: useCase.expectedOutcome ?? "" }));
      if (useCase.storyId) edges.push(graphEdge("story_to_use_case", "user_story", useCase.storyId, "use_case", useCase.id, feature.id));
    }
    for (const requirement of asArray(feature.functionalRequirements)) {
      nodes.push(graphNode("requirement", requirement.id, requirement.statement, feature.id, { level: requirement.level ?? "", category: requirement.category ?? "" }));
      if (requirement.useCaseId) edges.push(graphEdge("use_case_to_requirement", "use_case", requirement.useCaseId, "requirement", requirement.id, feature.id));
    }
    for (const criterion of asArray(feature.successCriteria)) {
      nodes.push(graphNode("criterion", criterion.id, criterion.statement, feature.id, { kind: "success" }));
      for (const reqId of asArray(criterion.requirementIds)) edges.push(graphEdge("requirement_to_criterion", "requirement", reqId, "criterion", criterion.id, feature.id, { kind: "success" }));
    }
    for (const criterion of asArray(feature.antiSuccessCriteria)) {
      nodes.push(graphNode("criterion", criterion.id, criterion.statement, feature.id, { kind: "anti-success" }));
      for (const reqId of asArray(criterion.requirementIds)) edges.push(graphEdge("requirement_to_criterion", "requirement", reqId, "criterion", criterion.id, feature.id, { kind: "anti-success" }));
    }
    for (const contract of asArray(feature.experienceContracts)) {
      nodes.push(graphNode("experience_contract", contract.id, contract.title, feature.id, { persona: contract.persona ?? "", role: contract.role ?? "", surface: contract.surface ?? "" }));
      if (contract.useCaseId) edges.push(graphEdge("use_case_to_contract", "use_case", contract.useCaseId, "experience_contract", contract.id, feature.id));
      for (const reqId of asArray(contract.requirementIds)) edges.push(graphEdge("requirement_to_contract", "requirement", reqId, "experience_contract", contract.id, feature.id));
      for (const evidence of asArray(contract.testEvidence)) {
        const evidenceId = `${contract.id}:${evidence}`;
        nodes.push(graphNode("test_evidence", evidenceId, evidence, feature.id, { command: evidence }));
        edges.push(graphEdge("contract_to_test_evidence", "experience_contract", contract.id, "test_evidence", evidenceId, feature.id));
      }
    }
    for (const scenario of asArray(feature.scenarios)) {
      nodes.push(graphNode("scenario", scenario.id, scenario.then, feature.id, { outcome: scenario.outcome ?? "", testEvidence: scenario.testEvidence ?? "" }));
      if (scenario.contractId) edges.push(graphEdge("contract_to_scenario", "experience_contract", scenario.contractId, "scenario", scenario.id, feature.id, { outcome: scenario.outcome ?? "" }));
      if (scenario.testEvidence) {
        const evidenceId = `${scenario.id}:${scenario.testEvidence}`;
        nodes.push(graphNode("test_evidence", evidenceId, scenario.testEvidence, feature.id, { command: scenario.testEvidence }));
        edges.push(graphEdge("scenario_to_test_evidence", "scenario", scenario.id, "test_evidence", evidenceId, feature.id));
      }
    }
    for (const journey of asArray(feature.journeyMatrix).map((row) => enrichJourney(feature, row))) {
      nodes.push(graphNode("journey_row", journey.id, journey.expectedExperience, feature.id, { persona: journey.persona ?? "", role: journey.role ?? "", routePattern: journey.routePattern ?? "", expectedState: journey.expectedState ?? "", primaryAction: journey.primaryAction ?? "", fallbackAction: journey.fallbackAction ?? "", state: journey.state ?? "", outcome: journey.outcome ?? "" }));
      if (journey.contractId) edges.push(graphEdge("contract_to_journey", "experience_contract", journey.contractId, "journey_row", journey.id, feature.id, { outcome: journey.outcome ?? "" }));
    }
  }
  const nodeIds = new Set(nodes.map((node) => node.id));
  const danglingEdges = edges.filter((edge) => !nodeIds.has(edge.from) || !nodeIds.has(edge.to));
  return {
    kind: "elicitation-graph",
    generatedAt: new Date().toISOString(),
    modelVersion: config.modelVersion,
    feature: { id: featureId || "" },
    valid: validation.valid && danglingEdges.length === 0,
    nodes,
    edges,
    summary: {
      features: requestedFeatures.length,
      nodes: nodes.length,
      edges: edges.length,
      danglingEdges: danglingEdges.length,
      gaps: validation.gaps.filter((gap) => !featureId || gap.featureId === featureId).length,
    },
    failures: [...validation.failures, ...danglingEdges.map((edge) => `${edge.id}: dangling graph edge`)],
  };
}

function writeSqlite(config, validation) {
  fs.mkdirSync(path.dirname(abs(sqlitePath)), { recursive: true });
  const flat = flatten(config, validation);
  const statements = [
    "PRAGMA foreign_keys = OFF;",
    "DROP TABLE IF EXISTS elicitation_features;",
    "DROP TABLE IF EXISTS elicitation_rbac_stories;",
    "DROP TABLE IF EXISTS elicitation_user_stories;",
    "DROP TABLE IF EXISTS elicitation_use_cases;",
    "DROP TABLE IF EXISTS elicitation_requirements;",
    "DROP TABLE IF EXISTS elicitation_criteria;",
    "DROP TABLE IF EXISTS elicitation_experience_contracts;",
    "DROP TABLE IF EXISTS elicitation_scenarios;",
    "DROP TABLE IF EXISTS elicitation_journey_matrix;",
    "DROP TABLE IF EXISTS elicitation_gaps;",
    "DROP TABLE IF EXISTS elicitation_graph_nodes;",
    "DROP TABLE IF EXISTS elicitation_graph_edges;",
    "CREATE TABLE elicitation_features (id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL, goal_fit TEXT NOT NULL, platform_fit TEXT NOT NULL, expected_value TEXT NOT NULL, non_goals_json TEXT NOT NULL, risks_json TEXT NOT NULL, dependencies_json TEXT NOT NULL, affected_surfaces_json TEXT NOT NULL);",
    "CREATE TABLE elicitation_rbac_stories (id TEXT PRIMARY KEY, feature_id TEXT NOT NULL, persona TEXT NOT NULL, role TEXT NOT NULL, realm TEXT NOT NULL, access TEXT NOT NULL, story TEXT NOT NULL);",
    "CREATE TABLE elicitation_user_stories (id TEXT PRIMARY KEY, feature_id TEXT NOT NULL, persona TEXT NOT NULL, goal TEXT NOT NULL, benefit TEXT NOT NULL);",
    "CREATE TABLE elicitation_use_cases (id TEXT PRIMARY KEY, feature_id TEXT NOT NULL, story_id TEXT NOT NULL, name TEXT NOT NULL, primary_actor TEXT NOT NULL, trigger TEXT NOT NULL, expected_outcome TEXT NOT NULL);",
    "CREATE TABLE elicitation_requirements (id TEXT PRIMARY KEY, feature_id TEXT NOT NULL, level TEXT NOT NULL, use_case_id TEXT NOT NULL, category TEXT NOT NULL, statement TEXT NOT NULL);",
    "CREATE TABLE elicitation_criteria (id TEXT PRIMARY KEY, feature_id TEXT NOT NULL, type TEXT NOT NULL, requirement_ids_json TEXT NOT NULL, statement TEXT NOT NULL);",
    "CREATE TABLE elicitation_experience_contracts (id TEXT PRIMARY KEY, feature_id TEXT NOT NULL, title TEXT NOT NULL, use_case_id TEXT NOT NULL, persona TEXT NOT NULL, role TEXT NOT NULL, intent TEXT NOT NULL, surface TEXT NOT NULL, primary_action TEXT NOT NULL, fallback_action TEXT NOT NULL, ui_states_json TEXT NOT NULL, expected_copy TEXT NOT NULL, data_touched_json TEXT NOT NULL, audit_behavior TEXT NOT NULL, requirement_ids_json TEXT NOT NULL, scenario_ids_json TEXT NOT NULL, test_evidence_json TEXT NOT NULL);",
    "CREATE TABLE elicitation_scenarios (id TEXT PRIMARY KEY, feature_id TEXT NOT NULL, contract_id TEXT NOT NULL, outcome TEXT NOT NULL, given_text TEXT NOT NULL, when_text TEXT NOT NULL, then_text TEXT NOT NULL, test_evidence TEXT NOT NULL);",
    "CREATE TABLE elicitation_journey_matrix (id TEXT PRIMARY KEY, feature_id TEXT NOT NULL, contract_id TEXT NOT NULL, route_id TEXT NOT NULL, route_pattern TEXT NOT NULL, persona TEXT NOT NULL, role TEXT NOT NULL, tenant_role TEXT NOT NULL, platform_role TEXT NOT NULL, business_scope TEXT NOT NULL, entitlement TEXT NOT NULL, state TEXT NOT NULL, expected_state TEXT NOT NULL, outcome TEXT NOT NULL, primary_action TEXT NOT NULL, fallback_action TEXT NOT NULL, expected_experience TEXT NOT NULL, test_evidence TEXT NOT NULL, evidence_path TEXT NOT NULL, evidence_command TEXT NOT NULL);",
    "CREATE TABLE elicitation_gaps (id TEXT PRIMARY KEY, feature_id TEXT NOT NULL, domain TEXT NOT NULL, severity TEXT NOT NULL, summary TEXT NOT NULL, remediation TEXT NOT NULL, channel TEXT NOT NULL, blocks_implementation INTEGER NOT NULL);",
    "CREATE TABLE elicitation_graph_nodes (id TEXT PRIMARY KEY, feature_id TEXT NOT NULL, type TEXT NOT NULL, source_id TEXT NOT NULL, label TEXT NOT NULL, attributes_json TEXT NOT NULL);",
    "CREATE TABLE elicitation_graph_edges (id TEXT PRIMARY KEY, feature_id TEXT NOT NULL, type TEXT NOT NULL, from_node TEXT NOT NULL, to_node TEXT NOT NULL, attributes_json TEXT NOT NULL);",
  ];

  for (const feature of flat.features) {
    statements.push(`INSERT INTO elicitation_features VALUES (${sqlString(feature.id)}, ${sqlString(feature.name)}, ${sqlString(feature.status ?? "")}, ${sqlString(feature.brief?.goalFit ?? "")}, ${sqlString(feature.brief?.platformFit ?? "")}, ${sqlString(feature.brief?.expectedValue ?? "")}, ${sqlString(JSON.stringify(feature.brief?.nonGoals ?? []))}, ${sqlString(JSON.stringify(feature.brief?.risks ?? []))}, ${sqlString(JSON.stringify(feature.brief?.dependencies ?? feature.dependencies ?? []))}, ${sqlString(JSON.stringify(feature.brief?.affectedSurfaces ?? []))});`);
  }
  for (const row of flat.rbacStories) statements.push(`INSERT INTO elicitation_rbac_stories VALUES (${sqlString(row.id)}, ${sqlString(row.featureId)}, ${sqlString(row.persona)}, ${sqlString(row.role)}, ${sqlString(row.realm)}, ${sqlString(row.access)}, ${sqlString(row.story)});`);
  for (const row of flat.userStories) statements.push(`INSERT INTO elicitation_user_stories VALUES (${sqlString(row.id)}, ${sqlString(row.featureId)}, ${sqlString(row.persona)}, ${sqlString(row.goal)}, ${sqlString(row.benefit)});`);
  for (const row of flat.useCases) statements.push(`INSERT INTO elicitation_use_cases VALUES (${sqlString(row.id)}, ${sqlString(row.featureId)}, ${sqlString(row.storyId)}, ${sqlString(row.name)}, ${sqlString(row.primaryActor)}, ${sqlString(row.trigger)}, ${sqlString(row.expectedOutcome)});`);
  for (const row of flat.requirements) statements.push(`INSERT INTO elicitation_requirements VALUES (${sqlString(row.id)}, ${sqlString(row.featureId)}, ${sqlString(row.level)}, ${sqlString(row.useCaseId)}, ${sqlString(row.category)}, ${sqlString(row.statement)});`);
  for (const row of [...flat.successCriteria, ...flat.antiSuccessCriteria]) statements.push(`INSERT INTO elicitation_criteria VALUES (${sqlString(row.id)}, ${sqlString(row.featureId)}, ${sqlString(row.type)}, ${sqlString(JSON.stringify(row.requirementIds ?? []))}, ${sqlString(row.statement)});`);
  for (const row of flat.contracts) statements.push(`INSERT INTO elicitation_experience_contracts VALUES (${sqlString(row.id)}, ${sqlString(row.featureId)}, ${sqlString(row.title)}, ${sqlString(row.useCaseId)}, ${sqlString(row.persona)}, ${sqlString(row.role)}, ${sqlString(row.intent)}, ${sqlString(row.surface)}, ${sqlString(row.primaryAction)}, ${sqlString(row.fallbackAction)}, ${sqlString(JSON.stringify(row.uiStates ?? []))}, ${sqlString(row.expectedCopy)}, ${sqlString(JSON.stringify(row.dataTouched ?? []))}, ${sqlString(row.auditBehavior)}, ${sqlString(JSON.stringify(row.requirementIds ?? []))}, ${sqlString(JSON.stringify(row.scenarioIds ?? []))}, ${sqlString(JSON.stringify(row.testEvidence ?? []))});`);
  for (const row of flat.scenarios) statements.push(`INSERT INTO elicitation_scenarios VALUES (${sqlString(row.id)}, ${sqlString(row.featureId)}, ${sqlString(row.contractId)}, ${sqlString(row.outcome)}, ${sqlString(row.given)}, ${sqlString(row.when)}, ${sqlString(row.then)}, ${sqlString(row.testEvidence)});`);
  for (const row of flat.journeyMatrix) statements.push(`INSERT INTO elicitation_journey_matrix VALUES (${sqlString(row.id)}, ${sqlString(row.featureId)}, ${sqlString(row.contractId)}, ${sqlString(row.routeId)}, ${sqlString(row.routePattern)}, ${sqlString(row.persona)}, ${sqlString(row.role)}, ${sqlString(row.tenantRole)}, ${sqlString(row.platformRole)}, ${sqlString(row.businessScope)}, ${sqlString(row.entitlement)}, ${sqlString(row.state)}, ${sqlString(row.expectedState)}, ${sqlString(row.outcome)}, ${sqlString(row.primaryAction)}, ${sqlString(row.fallbackAction)}, ${sqlString(row.expectedExperience)}, ${sqlString(row.testEvidence)}, ${sqlString(row.evidencePath)}, ${sqlString(row.evidenceCommand)});`);
  for (const gap of flat.gaps) statements.push(`INSERT INTO elicitation_gaps VALUES (${sqlString(gap.id)}, ${sqlString(gap.featureId)}, ${sqlString(gap.domain)}, ${sqlString(gap.severity)}, ${sqlString(gap.summary)}, ${sqlString(gap.remediation)}, ${sqlString(gap.channel ?? "gap-register")}, ${gap.blocksImplementation ? 1 : 0});`);
  const graph = buildGraph(config, validation);
  for (const node of graph.nodes) statements.push(`INSERT OR REPLACE INTO elicitation_graph_nodes VALUES (${sqlString(node.id)}, ${sqlString(node.featureId)}, ${sqlString(node.type)}, ${sqlString(node.sourceId)}, ${sqlString(node.label)}, ${sqlString(JSON.stringify(node.attributes ?? {}))});`);
  for (const edge of graph.edges) statements.push(`INSERT OR REPLACE INTO elicitation_graph_edges VALUES (${sqlString(edge.id)}, ${sqlString(edge.featureId)}, ${sqlString(edge.type)}, ${sqlString(edge.from)}, ${sqlString(edge.to)}, ${sqlString(JSON.stringify(edge.attributes ?? {}))});`);

  if (fs.existsSync(abs(sqlitePath))) fs.rmSync(abs(sqlitePath));
  execFileSync("sqlite3", [abs(sqlitePath)], { cwd: root, input: `${statements.join("\n")}\n`, encoding: "utf8" });
}

function readSqliteJson(sql) {
  if (!fs.existsSync(abs(sqlitePath))) return null;
  try {
    const output = execFileSync("sqlite3", ["-json", abs(sqlitePath), sql], { cwd: root, encoding: "utf8" }).trim();
    return output ? JSON.parse(output) : [];
  } catch {
    return null;
  }
}

function validateSqlProjection(config, validation) {
  const failures = [];
  const flat = flatten(config, validation);
  const contractRows = readSqliteJson("select id, primary_action, fallback_action from elicitation_experience_contracts order by id");
  const journeyRows = readSqliteJson("select id, route_pattern, expected_state, primary_action, fallback_action, evidence_command from elicitation_journey_matrix order by id");
  if (!contractRows || !journeyRows) {
    return {
      checked: true,
      valid: false,
      failures: [`${sqlitePath}: missing or incompatible SQL projection; run validation without --check to regenerate it first.`],
    };
  }
  const sqlContracts = new Map(contractRows.map((row) => [row.id, row]));
  for (const contract of flat.contracts) {
    const sqlContract = sqlContracts.get(contract.id);
    if (!sqlContract) {
      failures.push(`${contract.id}: missing SQL contract projection`);
      continue;
    }
    if ((contract.primaryAction ?? "") !== (sqlContract.primary_action ?? "")) failures.push(`${contract.id}: primaryAction diverges from SQL primary_action`);
    if ((contract.fallbackAction ?? "") !== (sqlContract.fallback_action ?? "")) failures.push(`${contract.id}: fallbackAction diverges from SQL fallback_action`);
  }
  const sqlJourneys = new Map(journeyRows.map((row) => [row.id, row]));
  for (const journey of flat.journeyMatrix) {
    const sqlJourney = sqlJourneys.get(journey.id);
    if (!sqlJourney) {
      failures.push(`${journey.id}: missing SQL journey projection`);
      continue;
    }
    for (const [jsonKey, sqlKey] of [
      ["routePattern", "route_pattern"],
      ["expectedState", "expected_state"],
      ["primaryAction", "primary_action"],
      ["fallbackAction", "fallback_action"],
      ["evidenceCommand", "evidence_command"],
    ]) {
      if ((journey[jsonKey] ?? "") !== (sqlJourney[sqlKey] ?? "")) failures.push(`${journey.id}: ${jsonKey} diverges from SQL ${sqlKey}`);
    }
  }
  return {
    checked: true,
    valid: failures.length === 0,
    failures,
  };
}

function featurePacket(config, validation, featureId) {
  const sourceFeature = asArray(config.features).find((row) => row.id === featureId);
  const feature = sourceFeature ? { ...sourceFeature, journeyMatrix: asArray(sourceFeature.journeyMatrix).map((row) => enrichJourney(sourceFeature, row)) } : null;
  if (!feature) throw new Error(`Unknown elicitation feature ${featureId}`);
  const gaps = validation.gaps.filter((gap) => gap.featureId === featureId);
  return {
    kind: "elicitation-packet",
    generatedAt: new Date().toISOString(),
    modelVersion: config.modelVersion,
    policy: config.policy,
    feature,
    status: {
      valid: validation.failures.length === 0,
      advisoryGapCount: gaps.filter((gap) => !gap.blocksImplementation).length,
      hardGapCount: gaps.filter((gap) => gap.blocksImplementation).length,
      gaps,
    },
  };
}

function toonEscape(input) {
  return String(input ?? "").replaceAll("\t", " ").replaceAll("\n", " ").trim();
}

function renderRows(name, rows, columns) {
  if (!rows.length) return `${name}[0]{${columns.join(",")}}:`;
  return `${name}[${rows.length}]{${columns.join(",")}}:\n${rows.map((row) => columns.map((column) => toonEscape(row[column])).join("\t")).join("\n")}`;
}

function renderToon(packet) {
  const feature = packet.feature;
  const criteria = [
    ...asArray(feature.successCriteria).map((row) => ({ ...row, type: "success" })),
    ...asArray(feature.antiSuccessCriteria).map((row) => ({ ...row, type: "anti-success" })),
  ];
  return [
    "elicitation:",
    `  feature: ${feature.id}`,
    `  name: ${toonEscape(feature.name)}`,
    `  status: ${toonEscape(feature.status)}`,
    `  advisoryGaps: ${packet.status.advisoryGapCount}`,
    renderRows("rbacStories", asArray(feature.rbacStories), ["id", "persona", "role", "access", "story"]),
    renderRows("userStories", asArray(feature.userStories), ["id", "persona", "goal", "benefit"]),
    renderRows("useCases", asArray(feature.useCases), ["id", "storyId", "name", "expectedOutcome"]),
    renderRows("requirements", asArray(feature.functionalRequirements), ["id", "level", "useCaseId", "category", "statement"]),
    renderRows("criteria", criteria, ["id", "type", "statement"]),
    renderRows("experienceContracts", asArray(feature.experienceContracts), ["id", "title", "persona", "role", "surface", "intent"]),
    renderRows("scenarios", asArray(feature.scenarios), ["id", "contractId", "outcome", "then"]),
    renderRows("journeyMatrix", asArray(feature.journeyMatrix), ["id", "contractId", "routePattern", "persona", "role", "expectedState", "outcome", "primaryAction", "fallbackAction", "evidenceCommand"]),
    renderRows("gaps", packet.status.gaps, ["id", "domain", "severity", "summary", "remediation"]),
  ].join("\n");
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

function renderMarkdown(packet) {
  const feature = packet.feature;
  return `# Elicitation Packet: ${feature.id} - ${feature.name}

Generated: ${packet.generatedAt}
Status: ${feature.status}
Advisory gaps: ${packet.status.advisoryGapCount}

## Brief

- Goal fit: ${feature.brief?.goalFit ?? ""}
- Platform fit: ${feature.brief?.platformFit ?? ""}
- Expected value: ${feature.brief?.expectedValue ?? ""}

## Requirements

${markdownTable(asArray(feature.functionalRequirements), [
  { key: "id", label: "ID" },
  { key: "level", label: "Level" },
  { key: "category", label: "Category" },
  { key: "statement", label: "Statement" },
])}

## Experience Contracts

${markdownTable(asArray(feature.experienceContracts), [
  { key: "id", label: "ID" },
  { key: "title", label: "Title" },
  { key: "persona", label: "Persona" },
  { key: "role", label: "Role" },
  { key: "surface", label: "Surface" },
])}

## Journey Matrix

${markdownTable(asArray(feature.journeyMatrix), [
  { key: "id", label: "ID" },
  { key: "routePattern", label: "Route" },
  { key: "persona", label: "Persona" },
  { key: "role", label: "Role" },
  { key: "expectedState", label: "Expected State" },
  { key: "outcome", label: "Outcome" },
  { key: "primaryAction", label: "Primary Action" },
  { key: "fallbackAction", label: "Fallback" },
  { key: "evidenceCommand", label: "Evidence" },
])}

## Gaps

${markdownTable(packet.status.gaps, [
  { key: "id", label: "ID" },
  { key: "domain", label: "Domain" },
  { key: "severity", label: "Severity" },
  { key: "summary", label: "Summary" },
])}
`;
}

function renderPacket(packet, format) {
  if (packet.kind === "elicitation-graph") return renderGraph(packet, format);
  if (format === "json") return `${JSON.stringify(packet, null, 2)}\n`;
  if (format === "toon") return `${renderToon(packet)}\n`;
  if (format === "markdown") return renderMarkdown(packet);
  throw new Error(`Unsupported format ${format}`);
}

function renderGraph(packet, format) {
  if (format === "json") return `${JSON.stringify(packet, null, 2)}\n`;
  if (format === "toon") {
    return `${[
      "elicitationGraph:",
      `  feature: ${packet.feature.id || "all"}`,
      `  nodes: ${packet.summary.nodes}`,
      `  edges: ${packet.summary.edges}`,
      `  danglingEdges: ${packet.summary.danglingEdges}`,
      renderRows("nodes", packet.nodes, ["id", "type", "sourceId", "label"]),
      renderRows("edges", packet.edges, ["id", "type", "from", "to"]),
    ].join("\n")}\n`;
  }
  if (format === "markdown") {
    return `# Elicitation Graph: ${packet.feature.id || "all"}

Nodes: ${packet.summary.nodes}
Edges: ${packet.summary.edges}
Dangling edges: ${packet.summary.danglingEdges}

## Nodes

${markdownTable(packet.nodes, [
  { key: "id", label: "ID" },
  { key: "type", label: "Type" },
  { key: "sourceId", label: "Source" },
  { key: "label", label: "Label" },
])}

## Edges

${markdownTable(packet.edges, [
  { key: "id", label: "ID" },
  { key: "type", label: "Type" },
  { key: "from", label: "From" },
  { key: "to", label: "To" },
])}
`;
  }
  throw new Error(`Unsupported format ${format}`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.command === "help") {
    usage();
    return;
  }
  const configPath = value(args, "config", defaultConfigPath);
  const format = value(args, "format", "json");
  const config = loadConfig(configPath);
  const validation = validateConfig(config);
  if (args.command === "validate") {
    const readOnly = args.flags.has("check") || args.flags.has("read-only");
    if (!args.flags.has("no-sqlite") && !readOnly && configPath === defaultConfigPath) writeSqlite(config, validation);
    const sqlProjection = configPath === defaultConfigPath && readOnly ? validateSqlProjection(config, validation) : { checked: false, valid: true, failures: [] };
    const featureId = value(args, "feature");
    const featureGaps = featureId ? validation.gaps.filter((gap) => gap.featureId === featureId) : validation.gaps;
    const result = {
      configPath,
      valid: validation.valid && sqlProjection.valid,
      readOnly,
      features: asArray(config.features).length,
      failures: [...validation.failures, ...sqlProjection.failures],
      advisoryGaps: featureGaps.filter((gap) => !gap.blocksImplementation),
      hardGaps: featureGaps.filter((gap) => gap.blocksImplementation),
      sqlite: configPath === defaultConfigPath && !args.flags.has("no-sqlite") && !readOnly ? sqlitePath : null,
      sqlProjection,
    };
    process.stdout.write(renderPacket({ kind: "elicitation-validation", generatedAt: new Date().toISOString(), ...result, feature: { id: featureId || "" }, status: { gaps: featureGaps, advisoryGapCount: featureGaps.length } }, format));
    if (!result.valid) process.exitCode = 1;
    return;
  }

  if (args.command === "packet") {
    const featureId = value(args, "feature");
    if (!featureId) throw new Error("packet requires --feature");
    process.stdout.write(renderPacket(featurePacket(config, validation, featureId), format));
    if (!validation.valid) process.exitCode = 1;
    return;
  }

  if (args.command === "graph") {
    const featureId = value(args, "feature");
    const graph = buildGraph(config, validation, featureId);
    process.stdout.write(renderPacket(graph, format));
    if (!graph.valid) process.exitCode = 1;
    return;
  }

  usage();
  process.exitCode = 1;
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
