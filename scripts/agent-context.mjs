#!/usr/bin/env node
// Context broker: SQLite chooses the context.
//
// Given a task (feature / item) and a workflow profile, the broker queries the
// local SQLite database and emits a *bounded* context packet: the feature, the
// relevant backlog items, routes, recent audit events, the specific files to
// read next, the required checks, and the files that must NOT be bulk-loaded.
//
// The whole point is restraint: instead of feeding an agent the giant generated
// mirrors, the broker hands it a few KB of exactly the right pointers and lets
// it open only the files the packet names. See docs/token-reduction.md.
//
// The broker never mutates the audit log or backlog. It only reads.

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
// One consolidated database backs both the backlog and the tracker-style views.
const trackerDbPath = "data/backlog.sqlite";
const backlogDbPath = "data/backlog.sqlite";
const profilePath = "config/agentic/context-profiles.yaml";
const elicitationPath = "config/agentic/elicitation.json";
const manifestDir = "tooling/agent-context/manifests";
const lastManifestPath = `${manifestDir}/last-context-packet.json`;
const historyManifestPath = `${manifestDir}/history.jsonl`;

function abs(file) {
  return path.join(root, file);
}

function exec(cmd) {
  return execSync(cmd, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, shell: "/bin/zsh" }).trim();
}

function parseArgs(argv) {
  const args = { command: argv[0] ?? "help", values: {}, flags: new Set() };
  for (let i = 1; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--") continue;
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      if (args.values[key] === undefined) args.values[key] = next;
      else if (Array.isArray(args.values[key])) args.values[key].push(next);
      else args.values[key] = [args.values[key], next];
      i += 1;
    } else {
      args.flags.add(key);
      args.values[key] = true;
    }
  }
  return args;
}

function value(args, key, fallback = "") {
  const raw = args.values[key];
  if (raw === undefined || raw === true) return fallback;
  return Array.isArray(raw) ? String(raw.at(-1)) : String(raw);
}

function numberValue(args, key, fallback) {
  const raw = Number(value(args, key, String(fallback)));
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

function sqlString(input) {
  if (input === null || input === undefined) return "NULL";
  return `'${String(input).replaceAll("'", "''")}'`;
}

function sqliteJson(dbPath, sql) {
  const normalized = sql.replace(/\s+/gu, " ").trim();
  const output = exec(`sqlite3 -json ${JSON.stringify(abs(dbPath))} ${JSON.stringify(normalized)}`);
  return JSON.parse(output || "[]");
}

function usage() {
  console.log(`Usage:
  node scripts/agent-context.mjs feature --feature S07 [--workflow route] [--format markdown|json|toon] [--no-manifest]
  node scripts/agent-context.mjs item --item S07-TASK-01 [--workflow route] [--format markdown|json|toon] [--no-manifest]
  node scripts/agent-context.mjs audit
  node scripts/agent-context.mjs next [--feature S07] [--workflow route] [--type task] [--max-items 1] [--format markdown|json|toon]
  node scripts/agent-context.mjs loop --feature S07 --workflow route --max-items 3 [--format markdown|json]

The broker queries SQLite and emits bounded context packets. It does not mutate
the audit log or backlog.`);
}

// --- minimal YAML reader (objects, nested maps, and simple/!nested arrays) ---

function preprocessYamlLines(source) {
  return source
    .split(/\r?\n/u)
    .map((raw) => raw.replace(/\s+#.*$/u, ""))
    .filter((line) => line.trim().length > 0 && !line.trimStart().startsWith("#"));
}

function lineIndent(line) {
  return line.match(/^ */u)?.[0].length ?? 0;
}

function parseScalar(raw) {
  const valueText = raw.trim();
  if (valueText === "true") return true;
  if (valueText === "false") return false;
  if (valueText === "null") return null;
  if (/^-?\d+(?:\.\d+)?$/u.test(valueText)) return Number(valueText);
  return valueText.replace(/^["']|["']$/gu, "");
}

function parseYamlBlock(lines, index, indent) {
  const first = lines[index];
  if (!first || lineIndent(first) < indent) return [{}, index];
  const isArray = lineIndent(first) === indent && first.trimStart().startsWith("- ");
  if (isArray) {
    const out = [];
    while (index < lines.length && lineIndent(lines[index]) === indent && lines[index].trimStart().startsWith("- ")) {
      const itemText = lines[index].trimStart().slice(2).trim();
      if (itemText.length > 0) {
        out.push(parseScalar(itemText));
        index += 1;
      } else {
        const parsed = parseYamlBlock(lines, index + 1, indent + 2);
        out.push(parsed[0]);
        index = parsed[1];
      }
    }
    return [out, index];
  }

  const out = {};
  while (index < lines.length && lineIndent(lines[index]) === indent && !lines[index].trimStart().startsWith("- ")) {
    const text = lines[index].trim();
    const separator = text.indexOf(":");
    if (separator === -1) throw new Error(`Invalid YAML line: ${lines[index]}`);
    const key = text.slice(0, separator).trim();
    const rest = text.slice(separator + 1).trim();
    if (rest.length > 0) {
      out[key] = parseScalar(rest);
      index += 1;
    } else {
      const parsed = parseYamlBlock(lines, index + 1, indent + 2);
      out[key] = parsed[0];
      index = parsed[1];
    }
  }
  return [out, index];
}

function loadProfiles() {
  const source = fs.readFileSync(abs(profilePath), "utf8");
  const [parsed] = parseYamlBlock(preprocessYamlLines(source), 0, 0);
  return parsed;
}

function mergeProfile(config, workflowName) {
  const workflows = config.workflows ?? {};
  const workflow = workflows[workflowName];
  if (!workflow) {
    const names = Object.keys(workflows).join(", ");
    throw new Error(`Unknown workflow "${workflowName}". Available workflows: ${names}`);
  }
  return {
    ...(config.defaults ?? {}),
    ...workflow,
    forbiddenBulkFiles: [
      ...new Set([...(config.defaults?.forbiddenBulkFiles ?? []), ...(workflow.forbiddenBulkFiles ?? [])]),
    ],
  };
}

function parseJsonArray(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function asArray(input) {
  return Array.isArray(input) ? input : [];
}

function loadElicitationConfig() {
  if (!fs.existsSync(abs(elicitationPath))) return null;
  return JSON.parse(fs.readFileSync(abs(elicitationPath), "utf8"));
}

function getElicitationContext(featureId) {
  const config = loadElicitationConfig();
  const feature = config?.features?.find((item) => item.id === featureId);
  if (!feature) {
    return {
      status: "missing",
      modelVersion: config?.modelVersion ?? "",
      featureId,
      advisoryGaps: [],
      hardGaps: [],
      experienceContracts: [],
      journeyMatrix: [],
      scenarios: [],
      requiredEvidence: [],
    };
  }
  const gaps = asArray(feature.gaps);
  const requiredOutcomes = asArray(config.policy?.requiredScenarioOutcomes);
  const presentOutcomes = new Set(asArray(feature.scenarios).map((scenario) => scenario.outcome));
  const derivedGaps = requiredOutcomes
    .filter((outcome) => !presentOutcomes.has(outcome))
    .map((outcome) => ({
      id: `PACKET-${featureId}-${outcome}`,
      domain: "scenarios",
      severity: "high",
      summary: `Missing ${outcome} scenario`,
      remediation: `Add at least one ${outcome} path scenario.`,
      blocksImplementation: false,
    }));
  const allGaps = [...gaps, ...derivedGaps];
  return {
    status: allGaps.some((gap) => gap.blocksImplementation === true) ? "hard-gaps" : allGaps.length ? "advisory-gaps" : "ready",
    modelVersion: config.modelVersion,
    featureId,
    brief: {
      goalFit: feature.brief?.goalFit ?? "",
      platformFit: feature.brief?.platformFit ?? "",
      expectedValue: feature.brief?.expectedValue ?? "",
    },
    counts: {
      rbacStories: asArray(feature.rbacStories).length,
      userStories: asArray(feature.userStories).length,
      useCases: asArray(feature.useCases).length,
      requirements: asArray(feature.functionalRequirements).length,
      successCriteria: asArray(feature.successCriteria).length,
      antiSuccessCriteria: asArray(feature.antiSuccessCriteria).length,
      experienceContracts: asArray(feature.experienceContracts).length,
      scenarios: asArray(feature.scenarios).length,
    },
    advisoryGaps: allGaps.filter((gap) => gap.blocksImplementation !== true),
    hardGaps: allGaps.filter((gap) => gap.blocksImplementation === true),
    experienceContracts: asArray(feature.experienceContracts).map((contract) => ({
      id: contract.id,
      title: contract.title,
      persona: contract.persona,
      role: contract.role,
      surface: contract.surface,
      intent: contract.intent,
      testEvidence: asArray(contract.testEvidence).join("; "),
    })),
    journeyMatrix: asArray(feature.journeyMatrix).map((row) => ({
      id: row.id,
      contractId: row.contractId,
      persona: row.persona,
      role: row.role,
      state: row.state,
      outcome: row.outcome,
      expectedExperience: row.expectedExperience,
      testEvidence: row.testEvidence,
    })),
    scenarios: asArray(feature.scenarios).map((scenario) => ({
      id: scenario.id,
      outcome: scenario.outcome,
      then: scenario.then,
      testEvidence: scenario.testEvidence,
    })),
    requiredEvidence: unique(asArray(feature.experienceContracts).flatMap((contract) => asArray(contract.testEvidence))),
  };
}

function getFeature(featureId) {
  const statusRows = sqliteJson(
    trackerDbPath,
    `select feature_id as id, title, planned_status, current_status, latest_update, latest_update_at from feature_current_status where feature_id = ${sqlString(featureId)}`,
  );
  const backlogRows = sqliteJson(
    backlogDbPath,
    `select id, priority, release_band, classification, category, architecture, ux, anchors_json from features where id = ${sqlString(featureId)}`,
  );
  if (!statusRows[0] && !backlogRows[0]) throw new Error(`Unknown feature ${featureId}`);
  const feature = { ...(statusRows[0] ?? {}), ...(backlogRows[0] ?? {}) };
  feature.anchors = parseJsonArray(feature.anchors_json);
  delete feature.anchors_json;
  return feature;
}

function getItem(itemId) {
  const rows = sqliteJson(
    backlogDbPath,
    `select id, feature_id, item_type, position, title, base_status, current_status, latest_update, latest_update_at, active_claim_actor, active_claim_expires_at, write_scope_json from backlog_item_current_status where id = ${sqlString(itemId)}`,
  );
  if (!rows[0]) throw new Error(`Unknown backlog item ${itemId}`);
  return rows[0];
}

function getBacklogItems(featureId, profile) {
  return sqliteJson(
    backlogDbPath,
    `select id, feature_id, item_type, position, title, current_status, latest_update, latest_update_at, active_claim_actor, active_claim_expires_at from backlog_item_current_status where feature_id = ${sqlString(featureId)} order by item_type, position limit ${Number(profile.maxBacklogItems ?? 12)}`,
  );
}

function getBacklogEvents({ featureId, itemId, profile }) {
  const where = itemId ? `item_id = ${sqlString(itemId)}` : `feature_id = ${sqlString(featureId)}`;
  return sqliteJson(
    backlogDbPath,
    `select created_at, event_type, status, actor, item_id, summary, evidence_json from backlog_item_events where ${where} order by created_at desc, id desc limit ${Number(profile.maxBacklogEvents ?? 5)}`,
  ).map((event) => {
    const { evidence_json: evidenceJson, ...rest } = event;
    return { ...rest, evidence: parseJsonArray(evidenceJson) };
  });
}

function getRoutes(featureId, profile) {
  return sqliteJson(
    trackerDbPath,
    `select path, kind, realm, status, file_path, permission, rbac_roles, notes from routes where feature_id = ${sqlString(featureId)} order by path limit ${Number(profile.maxRoutes ?? 12)}`,
  );
}

function getAuditEvents(featureId, profile) {
  return sqliteJson(
    trackerDbPath,
    `select occurred_at, event_type, target_id, status, summary, evidence from audit_events where feature_id = ${sqlString(featureId)} order by occurred_at desc, id desc limit ${Number(profile.maxAuditEvents ?? 5)}`,
  ).map((event) => ({ ...event, evidence: parseJsonArray(event.evidence) }));
}

function getPersonaWorkflows(featureId, limit = 12) {
  return sqliteJson(
    trackerDbPath,
    `select persona_id, rbac_role, realm, access_level, workflow, expected_state, primary_route, status from persona_workflows where feature_id = ${sqlString(featureId)} order by persona_id limit ${Number(limit)}`,
  );
}

function getIntegrations(featureId, limit = 12) {
  return sqliteJson(
    trackerDbPath,
    `select name, status, owner, source, notes from integrations where feature_id = ${sqlString(featureId)} order by name limit ${Number(limit)}`,
  );
}

function unique(values) {
  return [...new Set(values.filter((item) => typeof item === "string" && item.trim().length > 0))];
}

function matchesForbidden(file, patterns) {
  return patterns.some((pattern) => {
    if (pattern.endsWith("/**")) return file.startsWith(pattern.slice(0, -3));
    if (pattern.endsWith("*")) return file.startsWith(pattern.slice(0, -1));
    return file === pattern;
  });
}

function deriveNextFiles({ feature, routes, profile }) {
  const candidates = unique([
    ...(feature.anchors ?? []),
    ...routes.map((route) => route.file_path),
  ]);
  const allowed = candidates.filter((file) => !matchesForbidden(file, profile.forbiddenBulkFiles ?? []));
  return allowed.slice(0, Number(profile.maxFiles ?? 8)).map((file) => ({
    path: file,
    exists: fs.existsSync(abs(file)),
    reason: feature.anchors?.includes(file) ? "feature-anchor" : "route-file",
  }));
}

function buildPacket({ featureId, itemId = "", workflowName, format }) {
  const config = loadProfiles();
  const profile = mergeProfile(config, workflowName);
  const selectedItem = itemId ? getItem(itemId) : null;
  const effectiveFeatureId = featureId || selectedItem?.feature_id;
  if (!effectiveFeatureId) throw new Error("--feature is required unless --item is provided");
  const feature = getFeature(effectiveFeatureId);
  const backlogItems = getBacklogItems(effectiveFeatureId, profile);
  const routes = profile.queries?.includes("routes_by_feature") ? getRoutes(effectiveFeatureId, profile) : [];
  const auditEvents = profile.queries?.includes("recent_audit") ? getAuditEvents(effectiveFeatureId, profile) : [];
  const backlogEvents = getBacklogEvents({ featureId: effectiveFeatureId, itemId, profile });
  const personaWorkflows = profile.queries?.includes("persona_workflows_by_feature") ? getPersonaWorkflows(effectiveFeatureId) : [];
  const integrations = profile.queries?.includes("integrations_by_feature") ? getIntegrations(effectiveFeatureId) : [];
  const elicitation = getElicitationContext(effectiveFeatureId);
  const nextFiles = deriveNextFiles({ feature, routes, profile });

  return {
    kind: "context-packet",
    generatedAt: new Date().toISOString(),
    workflow: workflowName,
    format,
    inputs: { feature: effectiveFeatureId, item: itemId || null },
    source: { trackerDb: trackerDbPath, backlogDb: backlogDbPath, profile: profilePath, elicitation: elicitationPath },
    profile: {
      maxAuditEvents: profile.maxAuditEvents,
      maxBacklogEvents: profile.maxBacklogEvents,
      maxBacklogItems: profile.maxBacklogItems,
      maxRoutes: profile.maxRoutes,
      maxFiles: profile.maxFiles,
      queries: profile.queries ?? [],
      deliveryFlow: profile.deliveryFlow ?? [],
      verificationPolicy: profile.verificationPolicy ?? [],
    },
    feature,
    selectedItem,
    backlogItems,
    backlogEvents,
    routes,
    auditEvents,
    personaWorkflows,
    integrations,
    elicitation,
    nextFiles,
    requiredChecks: profile.requiredChecks ?? [],
    forbiddenBulkFiles: profile.forbiddenBulkFiles ?? [],
    guidance: [
      "Use this packet before opening generated planning artifacts.",
      "Read only files listed in nextFiles unless local evidence points elsewhere.",
      ...(profile.guidance ?? []),
    ],
  };
}

function writeManifest(packet, command) {
  fs.mkdirSync(abs(manifestDir), { recursive: true });
  const files = packet.nextFiles?.map((file) => file.path) ?? [];
  const violations = files.filter((file) => matchesForbidden(file, packet.forbiddenBulkFiles ?? []));
  const manifest = {
    generatedAt: packet.generatedAt,
    command,
    workflow: packet.workflow,
    feature: packet.inputs?.feature,
    item: packet.inputs?.item,
    format: packet.format,
    files,
    fileCount: files.length,
    maxFiles: packet.profile?.maxFiles,
    forbiddenBulkFiles: packet.forbiddenBulkFiles,
    violations,
  };
  fs.writeFileSync(abs(lastManifestPath), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  fs.appendFileSync(abs(historyManifestPath), `${JSON.stringify(manifest)}\n`, "utf8");
}

function md(value) {
  return String(value ?? "").replaceAll("|", "\\|").replace(/\s+/gu, " ").trim();
}

function markdownTable(rows, columns) {
  if (!rows.length) return "_None._";
  const header = `| ${columns.map((column) => column.label).join(" | ")} |`;
  const divider = `| ${columns.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${columns.map((column) => md(row[column.key])).join(" | ")} |`);
  return [header, divider, ...body].join("\n");
}

function renderMarkdown(packet) {
  const selected = packet.selectedItem
    ? `\n## Selected Item\n\n${markdownTable([packet.selectedItem], [
      { key: "id", label: "ID" },
      { key: "item_type", label: "Type" },
      { key: "current_status", label: "Status" },
      { key: "title", label: "Title" },
    ])}\n`
    : "";
  return `# Context Packet

Generated: ${packet.generatedAt}
Workflow: ${packet.workflow}
Feature: ${packet.feature.id} - ${packet.feature.title}
Status: ${packet.feature.current_status ?? packet.feature.status ?? ""}

## Feature

| Field | Value |
|---|---|
| ID | ${md(packet.feature.id)} |
| Priority | ${md(packet.feature.priority)} |
| Release band | ${md(packet.feature.release_band)} |
| Classification | ${md(packet.feature.classification)} |
| Latest update | ${md(packet.feature.latest_update)} |
${selected}
## Next Files

${markdownTable(packet.nextFiles, [
  { key: "path", label: "Path" },
  { key: "exists", label: "Exists" },
  { key: "reason", label: "Reason" },
])}

## Backlog Items

${markdownTable(packet.backlogItems, [
  { key: "id", label: "ID" },
  { key: "item_type", label: "Type" },
  { key: "current_status", label: "Status" },
  { key: "title", label: "Title" },
])}

## Routes

${markdownTable(packet.routes, [
  { key: "path", label: "Path" },
  { key: "status", label: "Status" },
  { key: "realm", label: "Realm" },
  { key: "file_path", label: "File" },
])}

## Recent Audit

${markdownTable(packet.auditEvents, [
  { key: "occurred_at", label: "At" },
  { key: "event_type", label: "Type" },
  { key: "status", label: "Status" },
  { key: "summary", label: "Summary" },
])}

## Elicitation

| Field | Value |
|---|---|
| Status | ${md(packet.elicitation?.status)} |
| Model | ${md(packet.elicitation?.modelVersion)} |
| Experience contracts | ${md(packet.elicitation?.counts?.experienceContracts ?? 0)} |
| Scenarios | ${md(packet.elicitation?.counts?.scenarios ?? 0)} |
| Advisory gaps | ${md(packet.elicitation?.advisoryGaps?.length ?? 0)} |
| Hard gaps | ${md(packet.elicitation?.hardGaps?.length ?? 0)} |

### Experience Contracts

${markdownTable(packet.elicitation?.experienceContracts ?? [], [
  { key: "id", label: "ID" },
  { key: "title", label: "Title" },
  { key: "persona", label: "Persona" },
  { key: "role", label: "Role" },
  { key: "surface", label: "Surface" },
])}

### Journey Matrix

${markdownTable(packet.elicitation?.journeyMatrix ?? [], [
  { key: "id", label: "ID" },
  { key: "persona", label: "Persona" },
  { key: "role", label: "Role" },
  { key: "state", label: "State" },
  { key: "outcome", label: "Outcome" },
  { key: "expectedExperience", label: "Expected Experience" },
])}

### Elicitation Gaps

${markdownTable([...(packet.elicitation?.advisoryGaps ?? []), ...(packet.elicitation?.hardGaps ?? [])], [
  { key: "id", label: "ID" },
  { key: "domain", label: "Domain" },
  { key: "severity", label: "Severity" },
  { key: "summary", label: "Summary" },
])}

## Required Checks

${packet.requiredChecks.map((check) => `- ${check}`).join("\n") || "- None"}

## Plan Design Build Test

${packet.profile.deliveryFlow?.map((line) => `- ${line}`).join("\n") || "- Use the feature's normal workflow."}

## Verification Policy

${packet.profile.verificationPolicy?.map((line) => `- ${line}`).join("\n") || "- Record evidence according to project policy."}

## Do Not Bulk Read

${packet.forbiddenBulkFiles.map((file) => `- ${file}`).join("\n")}

## Guidance

${packet.guidance.map((line) => `- ${line}`).join("\n")}
`;
}

function toonEscape(value) {
  return String(value ?? "").replaceAll("\t", " ").replaceAll("\n", " ").trim();
}

function renderToonRows(name, rows, columns) {
  if (!rows.length) return `${name}[0]{${columns.join(",")}}:`;
  const body = rows.map((row) => columns.map((column) => toonEscape(row[column])).join("\t")).join("\n");
  return `${name}[${rows.length}]{${columns.join(",")}}:\n${body}`;
}

function renderToon(packet) {
  return [
    "context:",
    `  generatedAt: ${packet.generatedAt}`,
    `  workflow: ${packet.workflow}`,
    `  feature: ${packet.feature.id}`,
    `  item: ${packet.selectedItem?.id ?? ""}`,
    "feature:",
    `  id: ${packet.feature.id}`,
    `  title: ${toonEscape(packet.feature.title)}`,
    `  status: ${toonEscape(packet.feature.current_status ?? packet.feature.status)}`,
    `  priority: ${toonEscape(packet.feature.priority)}`,
    `  releaseBand: ${toonEscape(packet.feature.release_band)}`,
    renderToonRows("nextFiles", packet.nextFiles, ["path", "exists", "reason"]),
    renderToonRows("backlogItems", packet.backlogItems, ["id", "item_type", "current_status", "title"]),
    renderToonRows("routes", packet.routes, ["path", "status", "realm", "file_path"]),
    renderToonRows("auditEvents", packet.auditEvents, ["occurred_at", "event_type", "status", "summary"]),
    renderToonRows("experienceContracts", packet.elicitation?.experienceContracts ?? [], ["id", "title", "persona", "role", "surface", "intent"]),
    renderToonRows("journeyMatrix", packet.elicitation?.journeyMatrix ?? [], ["id", "persona", "role", "state", "outcome", "expectedExperience"]),
    renderToonRows("elicitationGaps", [...(packet.elicitation?.advisoryGaps ?? []), ...(packet.elicitation?.hardGaps ?? [])], ["id", "domain", "severity", "summary"]),
    renderToonRows("requiredChecks", packet.requiredChecks.map((check) => ({ check })), ["check"]),
    renderToonRows("deliveryFlow", (packet.profile.deliveryFlow ?? []).map((step) => ({ step })), ["step"]),
    renderToonRows("verificationPolicy", (packet.profile.verificationPolicy ?? []).map((policy) => ({ policy })), ["policy"]),
    renderToonRows("forbiddenBulkFiles", packet.forbiddenBulkFiles.map((pathValue) => ({ path: pathValue })), ["path"]),
  ].join("\n");
}

function renderPacket(packet, format) {
  if (format === "json") return `${JSON.stringify(packet, null, 2)}\n`;
  if (format === "toon") return `${renderToon(packet)}\n`;
  if (format === "markdown") return renderMarkdown(packet);
  throw new Error(`Unsupported format ${format}. Use markdown, json, or toon.`);
}

function auditManifest() {
  if (!fs.existsSync(abs(lastManifestPath))) {
    return {
      manifestPath: lastManifestPath,
      valid: true,
      warnings: ["No context packet manifest exists yet. Run context:feature or context:item first."],
      failures: [],
    };
  }
  const manifest = JSON.parse(fs.readFileSync(abs(lastManifestPath), "utf8"));
  const config = loadProfiles();
  const profile = mergeProfile(config, manifest.workflow);
  const failures = [];
  const warnings = [];
  const files = manifest.files ?? [];
  const forbidden = profile.forbiddenBulkFiles ?? [];
  const violations = files.filter((file) => matchesForbidden(file, forbidden));
  if (violations.length) failures.push(`Forbidden bulk files are present: ${violations.join(", ")}`);
  if (files.length > Number(profile.maxFiles ?? 8)) failures.push(`Packet has ${files.length} files; profile cap is ${profile.maxFiles}`);
  if (!manifest.feature) failures.push("Manifest does not include a feature id.");
  if (!manifest.workflow) failures.push("Manifest does not include a workflow.");
  if (!manifest.generatedAt || Number.isNaN(Date.parse(manifest.generatedAt))) failures.push("Manifest generatedAt is missing or invalid.");
  if (!files.length) warnings.push("Packet has no nextFiles; this may be fine for docs-only or planning tasks.");
  return {
    manifestPath: lastManifestPath,
    checkedAt: new Date().toISOString(),
    workflow: manifest.workflow,
    feature: manifest.feature,
    item: manifest.item,
    fileCount: files.length,
    valid: failures.length === 0,
    warnings,
    failures,
  };
}

function selectNextItems({ featureId, itemType, maxItems }) {
  const filters = ["i.current_status in ('planned', 'in-progress', 'deferred', 'failed')"];
  if (featureId) filters.push(`i.feature_id = ${sqlString(featureId)}`);
  if (itemType) filters.push(`i.item_type = ${sqlString(itemType)}`);
  return sqliteJson(
    backlogDbPath,
    `select i.id, i.feature_id, i.item_type, i.position, i.title, i.current_status, i.active_claim_actor, f.priority, f.release_band from backlog_item_current_status i join features f on f.id = i.feature_id where ${filters.join(" and ")} order by coalesce(f.priority, 999), i.feature_id, i.item_type, i.position limit ${Number(maxItems)}`,
  );
}

function renderLoopPlan({ items, workflowName, maxItems, format }) {
  const summaries = items.map((item) => {
    const packet = buildPacket({ featureId: item.feature_id, itemId: item.id, workflowName, format: "json" });
    return {
      item: item.id,
      feature: item.feature_id,
      status: item.current_status,
      title: item.title,
      nextFiles: packet.nextFiles.map((file) => file.path),
      requiredChecks: packet.requiredChecks,
      command: `npm run context:item -- --item ${item.id} --workflow ${workflowName}`,
    };
  });
  const plan = {
    kind: "agent-loop-plan",
    generatedAt: new Date().toISOString(),
    workflow: workflowName,
    maxItems,
    mode: "bounded-plan-only",
    constraints: [
      "Generate a context packet before editing each item.",
      "Stop on failed checks.",
      "Stop on unexpected dirty files.",
      "Do not run production, billing, secrets, destructive, or migration work unless explicitly requested.",
    ],
    items: summaries,
  };
  if (format === "json") return `${JSON.stringify(plan, null, 2)}\n`;
  return `# Agent Loop Plan

Generated: ${plan.generatedAt}
Workflow: ${workflowName}
Mode: ${plan.mode}
Max items: ${maxItems}

## Items

${markdownTable(summaries, [
  { key: "item", label: "Item" },
  { key: "feature", label: "Feature" },
  { key: "status", label: "Status" },
  { key: "title", label: "Title" },
  { key: "command", label: "Context Command" },
])}

## Constraints

${plan.constraints.map((constraint) => `- ${constraint}`).join("\n")}
`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.command === "help" || args.flags.has("help")) {
    usage();
    return;
  }

  const format = value(args, "format", "markdown");
  const workflowName = value(args, "workflow", "agentic-tooling");
  const shouldWriteManifest = !args.flags.has("no-manifest") && args.values["no-manifest"] !== true;

  if (args.command === "feature" || args.command === "item") {
    const itemId = value(args, "item");
    const featureId = value(args, "feature");
    if (args.command === "feature" && !featureId) throw new Error("context feature requires --feature");
    if (args.command === "item" && !itemId) throw new Error("context item requires --item");
    const packet = buildPacket({ featureId, itemId, workflowName, format });
    if (shouldWriteManifest) writeManifest(packet, args.command);
    process.stdout.write(renderPacket(packet, format));
    return;
  }

  if (args.command === "audit") {
    const result = auditManifest();
    console.log(JSON.stringify(result, null, 2));
    if (!result.valid) process.exitCode = 1;
    return;
  }

  if (args.command === "next" || args.command === "loop") {
    const maxItems = numberValue(args, "max-items", args.command === "next" ? 1 : 3);
    const featureId = value(args, "feature");
    const itemType = value(args, "type", "task");
    const items = selectNextItems({ featureId, itemType, maxItems });
    process.stdout.write(renderLoopPlan({ items, workflowName, maxItems, format }));
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
