#!/usr/bin/env node
// SQL-first backlog engine for the Agentic Development Platform.
//
// This is the platform's "SQL server": a single local SQLite database that is the
// canonical, queryable source of truth for backlog items, their lifecycle events,
// claims, routes, integrations, persona workflows, and the audit mirror.
//
// Design rules (see docs/sql-data-layer.md):
//   - SQLite is generated and queryable; it is rebuilt from text sources.
//   - data/backlog-source.sql (.dump) and data/schema.sql (.schema) are the
//     reviewable, diffable, version-controlled mirrors.
//   - data/seed/backlog.seed.json is the human-editable empty install seed.
//   - data/audit/audit-log.jsonl is the append-only audit source, imported only
//     when setup is run with --with-audit.
//
// The database is intentionally cheap to throw away and rebuild: `setup` drops
// and recreates it from the text sources in a few hundred milliseconds.

import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const dbPath = "data/backlog.sqlite";
const dumpPath = "data/backlog-source.sql";
const schemaPath = "data/schema.sql";
const defaultSeedPath = "data/seed/backlog.seed.json";
const auditLogPath = "data/audit/audit-log.jsonl";

function abs(file) {
  return path.isAbsolute(file) ? file : path.join(root, file);
}

function exec(cmd) {
  return execSync(cmd, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, shell: "/bin/zsh" }).trim();
}

function sqlString(value) {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function nowIso() {
  return new Date().toISOString();
}

function parseArgs(argv) {
  const args = { command: argv[0] ?? "help", flags: new Set(), values: {} };
  for (let i = 1; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--") continue;
    if (!token.startsWith("--")) continue;
    args.flags.add(token.slice(2));
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      if (args.values[key] === undefined) args.values[key] = next;
      else if (Array.isArray(args.values[key])) args.values[key].push(next);
      else args.values[key] = [args.values[key], next];
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
  return Array.isArray(raw) ? String(raw.at(-1)) : String(raw);
}

function values(args, key) {
  const raw = args.values[key];
  if (raw === undefined || raw === true) return [];
  return Array.isArray(raw) ? raw.map(String) : [String(raw)];
}

// Ordered evidence tiers (weakest -> strongest). A claim's evidence_tier records
// what kind of proof backs it: asserted < config < test < live. The release gate
// (see release_gate_violations) requires a `live` event to sign off claims in a
// declared-sensitive release class. Keep this list in sync with
// config/agentic/guardrails.json -> evidence.tiers and the CHECK constraints below.
const EVIDENCE_TIERS = ["asserted", "config", "test", "live"];

function evidenceTierFromArgs(args, fallback = "asserted") {
  const tier = value(args, "tier", fallback);
  if (!EVIDENCE_TIERS.includes(tier)) {
    throw new Error(`Invalid --tier "${tier}". Expected one of: ${EVIDENCE_TIERS.join(", ")}.`);
  }
  return tier;
}

// Canonical sensitive release classes are policy, read from guardrails.json so there
// is a single source of truth (no SQL/JS drift). A feature opts into the release
// gate with a `release-class:<class>` label. The gate itself (the
// release_gate_violations view) fails safe -- it treats ANY release-class:* label as
// sensitive, so a typo like release-class:deployy is still gated rather than silently
// escaping -- and validateBacklog separately flags any class not in this list as a
// misconfiguration to correct.
const SENSITIVE_RELEASE_CLASSES_FALLBACK = ["deploy", "infra", "performance", "runtime-security", "data-residency"];

function sensitiveReleaseClasses() {
  try {
    const policy = JSON.parse(fs.readFileSync(abs("config/agentic/guardrails.json"), "utf8"));
    const classes = policy.evidence?.sensitiveReleaseClasses;
    return Array.isArray(classes) && classes.length ? classes : SENSITIVE_RELEASE_CLASSES_FALLBACK;
  } catch {
    return SENSITIVE_RELEASE_CLASSES_FALLBACK;
  }
}

function usage() {
  console.log(`Usage:
  node scripts/backlog-db.mjs setup [--force] [--seed data/seed/backlog.seed.json] [--with-audit]
                                                   Rebuild SQLite from schema + seed. Default seed is empty.
  node scripts/backlog-db.mjs export               Re-emit data/backlog-source.sql and data/schema.sql
  node scripts/backlog-db.mjs validate             Structural integrity checks
  node scripts/backlog-db.mjs list                 Backlog summary table
  node scripts/backlog-db.mjs next [--feature S07] [--type task] [--limit 5] [--strict-dependencies]
  node scripts/backlog-db.mjs show --item S07-TASK-01
  node scripts/backlog-db.mjs claim --item S07-TASK-01 [--actor agent] [--ttl-hours 8] [--scope path]
  node scripts/backlog-db.mjs start --item S07-TASK-01 [--summary "..."]
  node scripts/backlog-db.mjs block --item S07-TASK-01 --summary "Blocked by ..."
  node scripts/backlog-db.mjs complete --item S07-TASK-01 --summary "..." [--evidence path]
  node scripts/backlog-db.mjs verify --item S07-TASK-01 --summary "..." [--evidence command-or-path] [--tier asserted|config|test|live]
  node scripts/backlog-db.mjs fail --item S07-TASK-01 --summary "Failed because ..." [--evidence command-or-path] [--tier asserted|config|test|live]
  node scripts/backlog-db.mjs release --item S07-TASK-01 [--summary "..."]
  node scripts/backlog-db.mjs active               Active (unexpired) claims

The SQLite database is the canonical local source of truth:
  ${dbPath}
The reviewable mirrors are:
  ${dumpPath}
  ${schemaPath}
`);
}

function sqlite(command, options = {}) {
  const flags = options.json ? "-json " : "";
  const normalized = command.replace(/\s+/gu, " ").trim();
  const output = exec(`sqlite3 ${flags}${JSON.stringify(abs(dbPath))} ${JSON.stringify(normalized)}`);
  return options.json ? JSON.parse(output || "[]") : output;
}

function runSqlFile(sql) {
  fs.mkdirSync(path.dirname(abs(dbPath)), { recursive: true });
  const tempPath = abs(`data/.backlog-command-${process.pid}-${randomBytes(2).toString("hex")}.sql`);
  fs.writeFileSync(tempPath, `.timeout 10000\n${sql.replace(/\n+$/u, "")}\n`, "utf8");
  try {
    execSync(`sqlite3 ${JSON.stringify(abs(dbPath))} < ${JSON.stringify(tempPath)}`, { cwd: root, stdio: "inherit", shell: "/bin/zsh" });
  } finally {
    if (fs.existsSync(tempPath)) fs.rmSync(tempPath);
  }
}

function gitState() {
  const safe = (cmd, fallback) => {
    try {
      return exec(cmd);
    } catch {
      return fallback;
    }
  };
  return {
    branch: safe("git rev-parse --abbrev-ref HEAD", "unknown"),
    commit: safe("git rev-parse HEAD", "uncommitted"),
    status: safe("git status --porcelain=v1", "") || "clean",
  };
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

function schemaStatements() {
  return [
    "PRAGMA foreign_keys = ON;",
    "CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
    "CREATE TABLE labels (label TEXT PRIMARY KEY);",
    "CREATE TABLE epics (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, summary TEXT NOT NULL DEFAULT '', labels_json TEXT NOT NULL DEFAULT '[]');",
    "CREATE TABLE features (id TEXT PRIMARY KEY, epic_id TEXT NOT NULL, feature_key TEXT NOT NULL DEFAULT '', title TEXT NOT NULL, priority INTEGER, estimate INTEGER, status TEXT NOT NULL DEFAULT 'planned', release_band TEXT NOT NULL DEFAULT 'TBD', slug TEXT NOT NULL DEFAULT '', classification TEXT NOT NULL DEFAULT 'internal', category TEXT NOT NULL DEFAULT 'general', labels_json TEXT NOT NULL DEFAULT '[]', personas_json TEXT NOT NULL DEFAULT '[]', permissions_json TEXT NOT NULL DEFAULT '[]', anchors_json TEXT NOT NULL DEFAULT '[]', architecture TEXT NOT NULL DEFAULT '', ux TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT 'seed', FOREIGN KEY(epic_id) REFERENCES epics(id));",
    "CREATE TABLE feature_dependencies (feature_id TEXT NOT NULL, depends_on_feature_id TEXT NOT NULL, PRIMARY KEY(feature_id, depends_on_feature_id), FOREIGN KEY(feature_id) REFERENCES features(id), FOREIGN KEY(depends_on_feature_id) REFERENCES features(id));",
    "CREATE TABLE feature_labels (feature_id TEXT NOT NULL, label TEXT NOT NULL, PRIMARY KEY(feature_id, label), FOREIGN KEY(feature_id) REFERENCES features(id), FOREIGN KEY(label) REFERENCES labels(label));",
    "CREATE TABLE feature_items (id TEXT PRIMARY KEY, feature_id TEXT NOT NULL, item_type TEXT NOT NULL, position INTEGER NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'planned', FOREIGN KEY(feature_id) REFERENCES features(id));",
    "CREATE TABLE feature_persona_workflows (id TEXT PRIMARY KEY, feature_id TEXT NOT NULL, persona_id TEXT NOT NULL, rbac_role TEXT NOT NULL DEFAULT '', realm TEXT NOT NULL DEFAULT '', access_level TEXT NOT NULL DEFAULT '', workflow TEXT NOT NULL DEFAULT '', expected_state TEXT NOT NULL DEFAULT '', primary_route TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'planned', FOREIGN KEY(feature_id) REFERENCES features(id));",
    "CREATE TABLE routes (id TEXT PRIMARY KEY, feature_id TEXT NOT NULL DEFAULT '', path TEXT NOT NULL, kind TEXT NOT NULL DEFAULT '', realm TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'planned', file_path TEXT NOT NULL DEFAULT '', permission TEXT NOT NULL DEFAULT '', rbac_roles TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '');",
    "CREATE TABLE integrations (id TEXT PRIMARY KEY, feature_id TEXT NOT NULL DEFAULT '', name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'planned', owner TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '');",
    "CREATE TABLE audit_events (id TEXT PRIMARY KEY, occurred_at TEXT NOT NULL, actor TEXT NOT NULL DEFAULT '', event_type TEXT NOT NULL, target_type TEXT NOT NULL DEFAULT '', target_id TEXT NOT NULL DEFAULT '', feature_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT '', summary TEXT NOT NULL DEFAULT '', details TEXT NOT NULL DEFAULT '', evidence TEXT NOT NULL DEFAULT '[]', evidence_tier TEXT NOT NULL DEFAULT 'asserted' CHECK (evidence_tier IN ('asserted', 'config', 'test', 'live')));",
    "CREATE TABLE backlog_item_events (id TEXT PRIMARY KEY, item_id TEXT NOT NULL, feature_id TEXT NOT NULL, event_type TEXT NOT NULL, status TEXT NOT NULL, actor TEXT NOT NULL, summary TEXT NOT NULL, details TEXT NOT NULL DEFAULT '', evidence_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL, git_branch TEXT NOT NULL DEFAULT '', git_commit TEXT NOT NULL DEFAULT '', git_status TEXT NOT NULL DEFAULT '', evidence_tier TEXT NOT NULL DEFAULT 'asserted' CHECK (evidence_tier IN ('asserted', 'config', 'test', 'live')), FOREIGN KEY(item_id) REFERENCES feature_items(id), FOREIGN KEY(feature_id) REFERENCES features(id));",
    "CREATE TABLE backlog_item_claims (item_id TEXT PRIMARY KEY, feature_id TEXT NOT NULL, actor TEXT NOT NULL, claimed_at TEXT NOT NULL, expires_at TEXT NOT NULL, status TEXT NOT NULL, write_scope_json TEXT NOT NULL DEFAULT '[]', notes TEXT NOT NULL DEFAULT '', last_event_id TEXT NOT NULL DEFAULT '', FOREIGN KEY(item_id) REFERENCES feature_items(id), FOREIGN KEY(feature_id) REFERENCES features(id));",
    "CREATE INDEX idx_feature_dependencies_feature ON feature_dependencies(feature_id);",
    "CREATE INDEX idx_feature_items_feature_type_order ON feature_items(feature_id, item_type, position);",
    "CREATE INDEX idx_routes_feature ON routes(feature_id);",
    "CREATE INDEX idx_integrations_feature ON integrations(feature_id);",
    "CREATE INDEX idx_audit_events_feature_time ON audit_events(feature_id, occurred_at);",
    "CREATE INDEX idx_backlog_item_events_item_time ON backlog_item_events(item_id, created_at);",
    "CREATE INDEX idx_backlog_item_events_feature_time ON backlog_item_events(feature_id, created_at);",
    "CREATE INDEX idx_backlog_item_claims_status_expires ON backlog_item_claims(status, expires_at);",
    "CREATE VIEW feature_tasks AS SELECT id, feature_id, position, title, status FROM feature_items WHERE item_type = 'task';",
    "CREATE VIEW feature_test_cases AS SELECT id, feature_id, position, title, status FROM feature_items WHERE item_type = 'test_case';",
    "CREATE VIEW feature_success_criteria AS SELECT id, feature_id, position, title, status FROM feature_items WHERE item_type = 'success_criterion';",
    "CREATE VIEW feature_use_cases AS SELECT id, feature_id, position, title, status FROM feature_items WHERE item_type = 'use_case';",
    "CREATE VIEW persona_workflows AS SELECT id, feature_id, persona_id, rbac_role, realm, access_level, workflow, expected_state, primary_route, notes, status FROM feature_persona_workflows;",
    // Current feature status: planned status from the feature row, current status from the latest audit event.
    "CREATE VIEW feature_current_status AS SELECT f.id AS feature_id, f.title, f.status AS planned_status, COALESCE((SELECT a.status FROM audit_events a WHERE a.feature_id = f.id AND a.status <> '' ORDER BY a.occurred_at DESC, a.id DESC LIMIT 1), f.status) AS current_status, (SELECT a.summary FROM audit_events a WHERE a.feature_id = f.id ORDER BY a.occurred_at DESC, a.id DESC LIMIT 1) AS latest_update, (SELECT a.occurred_at FROM audit_events a WHERE a.feature_id = f.id ORDER BY a.occurred_at DESC, a.id DESC LIMIT 1) AS latest_update_at FROM features f;",
    // Current item status: base status from the item row, current status + claim from the event/claim tables.
    "CREATE VIEW backlog_item_current_status AS SELECT i.id, i.feature_id, i.item_type, i.position, i.title, i.status AS base_status, COALESCE((SELECT e.status FROM backlog_item_events e WHERE e.item_id = i.id AND e.status <> '' ORDER BY e.created_at DESC, e.id DESC LIMIT 1), i.status) AS current_status, (SELECT e.summary FROM backlog_item_events e WHERE e.item_id = i.id ORDER BY e.created_at DESC, e.id DESC LIMIT 1) AS latest_update, (SELECT e.created_at FROM backlog_item_events e WHERE e.item_id = i.id ORDER BY e.created_at DESC, e.id DESC LIMIT 1) AS latest_update_at, CASE WHEN c.status = 'active' AND c.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now') THEN c.actor ELSE '' END AS active_claim_actor, CASE WHEN c.status = 'active' AND c.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now') THEN c.expires_at ELSE '' END AS active_claim_expires_at, c.write_scope_json AS write_scope_json FROM feature_items i LEFT JOIN backlog_item_claims c ON c.item_id = i.id;",
    "CREATE VIEW backlog_summary AS SELECT f.id, e.name AS epic, f.feature_key, f.title, f.priority, f.estimate, f.status, f.release_band, (SELECT count(*) FROM feature_items t WHERE t.feature_id = f.id AND t.item_type = 'task') AS task_count, (SELECT count(*) FROM feature_items tc WHERE tc.feature_id = f.id AND tc.item_type = 'test_case') AS test_count FROM features f JOIN epics e ON e.id = f.epic_id ORDER BY f.id;",
    // Release gate (F-A / v0.9.1 F2): an item whose feature carries a `release-class:*`
    // label is in a declared-sensitive class (deploy/infra/performance/runtime-security/
    // data-residency). Such an item cannot be signed off (current_status = 'verified')
    // on asserted/config/test evidence alone -- it requires at least one backlog event
    // with evidence_tier = 'live'. Every row of this view is a blocking violation;
    // `backlog:validate` fails while it is non-empty.
    "CREATE VIEW release_gate_violations AS SELECT i.id AS item_id, i.feature_id, f.title AS feature_title, (SELECT group_concat(replace(fl.label, 'release-class:', ''), ', ') FROM feature_labels fl WHERE fl.feature_id = f.id AND fl.label LIKE 'release-class:%') AS release_classes, s.current_status, COALESCE((SELECT max(CASE e.evidence_tier WHEN 'live' THEN 3 WHEN 'test' THEN 2 WHEN 'config' THEN 1 ELSE 0 END) FROM backlog_item_events e WHERE e.item_id = i.id), 0) AS max_evidence_rank FROM feature_items i JOIN features f ON f.id = i.feature_id JOIN backlog_item_current_status s ON s.id = i.id WHERE EXISTS (SELECT 1 FROM feature_labels fl WHERE fl.feature_id = f.id AND fl.label LIKE 'release-class:%') AND s.current_status = 'verified' AND NOT EXISTS (SELECT 1 FROM backlog_item_events e WHERE e.item_id = i.id AND e.evidence_tier = 'live');",
  ];
}

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

function pad(index) {
  return String(index + 1).padStart(2, "0");
}

function seedStatements(seed) {
  const statements = [];
  const meta = seed.metadata ?? {};
  statements.push(`INSERT INTO metadata VALUES ('source', ${sqlString(meta.source ?? "seed")});`);
  statements.push(`INSERT INTO metadata VALUES ('initiative', ${sqlString(meta.initiative ?? "Agentic Development Platform")});`);

  for (const label of seed.labels ?? []) statements.push(`INSERT INTO labels VALUES (${sqlString(label)});`);
  for (const epic of seed.epics ?? []) {
    statements.push(`INSERT INTO epics VALUES (${sqlString(epic.id)}, ${sqlString(epic.name)}, ${sqlString(epic.summary ?? "")}, ${sqlString(JSON.stringify(epic.labels ?? []))});`);
  }

  const knownLabels = new Set(seed.labels ?? []);
  const dependencyStatements = [];
  for (const feature of seed.features ?? []) {
    statements.push(`INSERT INTO features VALUES (${sqlString(feature.id)}, ${sqlString(feature.epicId)}, ${sqlString(feature.featureKey ?? "")}, ${sqlString(feature.title)}, ${Number.isFinite(feature.priority) ? feature.priority : "NULL"}, ${Number.isFinite(feature.estimate) ? feature.estimate : "NULL"}, ${sqlString(feature.status ?? "planned")}, ${sqlString(feature.releaseBand ?? "TBD")}, ${sqlString(feature.slug ?? "")}, ${sqlString(feature.classification ?? "internal")}, ${sqlString(feature.category ?? "general")}, ${sqlString(JSON.stringify(feature.labels ?? []))}, ${sqlString(JSON.stringify(feature.personas ?? []))}, ${sqlString(JSON.stringify(feature.permissions ?? []))}, ${sqlString(JSON.stringify(feature.anchors ?? []))}, ${sqlString(feature.architecture ?? "")}, ${sqlString(feature.ux ?? "")}, ${sqlString(feature.source ?? "seed")});`);
    for (const dep of feature.dependsOn ?? []) dependencyStatements.push(`INSERT INTO feature_dependencies VALUES (${sqlString(feature.id)}, ${sqlString(dep)});`);
    for (const label of feature.labels ?? []) {
      if (!knownLabels.has(label)) {
        statements.push(`INSERT OR IGNORE INTO labels VALUES (${sqlString(label)});`);
        knownLabels.add(label);
      }
      statements.push(`INSERT INTO feature_labels VALUES (${sqlString(feature.id)}, ${sqlString(label)});`);
    }
    (feature.tasks ?? []).forEach((task, index) => {
      statements.push(`INSERT INTO feature_items VALUES (${sqlString(`${feature.id}-TASK-${pad(index)}`)}, ${sqlString(feature.id)}, 'task', ${index + 1}, ${sqlString(task)}, 'planned');`);
    });
    (feature.testCases ?? []).forEach((test, index) => {
      statements.push(`INSERT INTO feature_items VALUES (${sqlString(`${feature.id}-TEST-${pad(index)}`)}, ${sqlString(feature.id)}, 'test_case', ${index + 1}, ${sqlString(test)}, 'planned');`);
    });
    (feature.successCriteria ?? []).forEach((criterion, index) => {
      statements.push(`INSERT INTO feature_items VALUES (${sqlString(`${feature.id}-CRITERION-${pad(index)}`)}, ${sqlString(feature.id)}, 'success_criterion', ${index + 1}, ${sqlString(criterion)}, 'planned');`);
    });
    (feature.useCases ?? []).forEach((useCase, index) => {
      statements.push(`INSERT INTO feature_items VALUES (${sqlString(`${feature.id}-USE-CASE-${pad(index)}`)}, ${sqlString(feature.id)}, 'use_case', ${index + 1}, ${sqlString(useCase)}, 'planned');`);
    });
    (feature.routes ?? []).forEach((route, index) => {
      statements.push(`INSERT INTO routes VALUES (${sqlString(`${feature.id}-ROUTE-${pad(index)}`)}, ${sqlString(feature.id)}, ${sqlString(route.path)}, ${sqlString(route.kind ?? "")}, ${sqlString(route.realm ?? "")}, ${sqlString(route.status ?? "planned")}, ${sqlString(route.filePath ?? "")}, ${sqlString(route.permission ?? "")}, ${sqlString(route.rbacRoles ?? "")}, ${sqlString(route.notes ?? "")});`);
    });
    (feature.integrations ?? []).forEach((integration, index) => {
      statements.push(`INSERT INTO integrations VALUES (${sqlString(`${feature.id}-INT-${pad(index)}`)}, ${sqlString(feature.id)}, ${sqlString(integration.name)}, ${sqlString(integration.status ?? "planned")}, ${sqlString(integration.owner ?? "")}, ${sqlString(integration.source ?? "")}, ${sqlString(integration.notes ?? "")});`);
    });
    (feature.personaWorkflows ?? []).forEach((workflow) => {
      const slug = String(workflow.personaId ?? "").toUpperCase().replace(/[^A-Z0-9]+/gu, "-").replace(/^-|-$/gu, "") || "PERSONA";
      statements.push(`INSERT INTO feature_persona_workflows VALUES (${sqlString(`${feature.id}-PW-${slug}`)}, ${sqlString(feature.id)}, ${sqlString(workflow.personaId ?? "")}, ${sqlString(workflow.rbacRole ?? "")}, ${sqlString(workflow.realm ?? "")}, ${sqlString(workflow.accessLevel ?? "")}, ${sqlString(workflow.workflow ?? "")}, ${sqlString(workflow.expectedState ?? "")}, ${sqlString(workflow.primaryRoute ?? "")}, ${sqlString(workflow.notes ?? "")}, ${sqlString(workflow.status ?? "planned")});`);
    });
  }
  statements.push(...dependencyStatements);
  return statements;
}

function auditImportStatements() {
  if (!fs.existsSync(abs(auditLogPath))) return [];
  const lines = fs.readFileSync(abs(auditLogPath), "utf8").split(/\r?\n/u).filter(Boolean);
  return lines.map((line) => {
    const event = JSON.parse(line);
    return `INSERT OR REPLACE INTO audit_events VALUES (${sqlString(event.id)}, ${sqlString(event.occurredAt)}, ${sqlString(event.actor ?? "")}, ${sqlString(event.eventType)}, ${sqlString(event.targetType ?? "")}, ${sqlString(event.targetId ?? "")}, ${sqlString(event.featureId ?? "")}, ${sqlString(event.status ?? "")}, ${sqlString(event.summary ?? "")}, ${sqlString(event.details ?? "")}, ${sqlString(JSON.stringify(event.evidence ?? []))}, ${sqlString(EVIDENCE_TIERS.includes(event.evidenceTier) ? event.evidenceTier : "asserted")});`;
  });
}

function exportSql() {
  const dump = exec(`sqlite3 ${JSON.stringify(abs(dbPath))} .dump`);
  fs.writeFileSync(abs(dumpPath), `${dump}\n`, "utf8");
  const schema = exec(`sqlite3 ${JSON.stringify(abs(dbPath))} .schema`);
  fs.writeFileSync(abs(schemaPath), `${schema}\n`, "utf8");
}

function setup(args) {
  const seedPath = value(args, "seed", defaultSeedPath);
  if (fs.existsSync(abs(dbPath)) && !args.flags.has("force")) {
    // Rebuild is always safe (it is generated from text sources), but require --force
    // only to avoid surprising an operator who expected an incremental command.
  }
  if (!fs.existsSync(abs(seedPath))) throw new Error(`Seed file not found: ${seedPath}`);
  const seed = JSON.parse(fs.readFileSync(abs(seedPath), "utf8"));
  const statements = [...schemaStatements(), ...seedStatements(seed), `INSERT INTO metadata VALUES ('seed_path', ${sqlString(seedPath)});`];
  if (args.flags.has("with-audit")) statements.push(...auditImportStatements());
  fs.mkdirSync(path.dirname(abs(dbPath)), { recursive: true });
  const tempPath = abs("data/.backlog-setup.sql");
  fs.writeFileSync(tempPath, `${statements.join("\n")}\n`, "utf8");
  if (fs.existsSync(abs(dbPath))) fs.rmSync(abs(dbPath));
  execSync(`sqlite3 ${JSON.stringify(abs(dbPath))} < ${JSON.stringify(tempPath)}`, { cwd: root, stdio: "inherit", shell: "/bin/zsh" });
  fs.rmSync(tempPath);
  exportSql();
  const featureCount = sqlite("select count(*) as count from features", { json: true })[0]?.count ?? 0;
  const itemCount = sqlite("select count(*) as count from feature_items", { json: true })[0]?.count ?? 0;
  const auditCount = sqlite("select count(*) as count from audit_events", { json: true })[0]?.count ?? 0;
  console.log(JSON.stringify({ database: dbPath, seed: seedPath, auditImported: args.flags.has("with-audit"), features: featureCount, items: itemCount, auditEvents: auditCount, dump: dumpPath, schema: schemaPath }, null, 2));
}

function requireDb() {
  if (!fs.existsSync(abs(dbPath))) throw new Error(`${dbPath} does not exist. Run \`npm run setup\` first.`);
}

// ---------------------------------------------------------------------------
// Lifecycle commands
// ---------------------------------------------------------------------------

function getItem(itemId) {
  requireDb();
  const rows = sqlite(
    `select i.id, i.feature_id, i.item_type, i.position, i.title, i.status, f.title as feature_title, f.priority, f.release_band from feature_items i join features f on f.id = i.feature_id where i.id = ${sqlString(itemId)}`,
    { json: true },
  );
  if (!rows[0]) throw new Error(`Unknown backlog item ${itemId}.`);
  return rows[0];
}

function itemEventId() {
  return `BIE-${nowIso().replace(/[-:.TZ]/gu, "").slice(0, 14)}-${randomBytes(3).toString("hex")}`;
}

function recordItemEvent({ itemId, eventType, status, summary, details = "", evidence = [], actor = "agent", claimSql = "", evidenceTier = "asserted" }) {
  const item = getItem(itemId);
  const id = itemEventId();
  const createdAt = nowIso();
  const git = gitState();
  runSqlFile(`
PRAGMA foreign_keys=ON;
BEGIN TRANSACTION;
INSERT INTO backlog_item_events VALUES (
  ${sqlString(id)}, ${sqlString(item.id)}, ${sqlString(item.feature_id)}, ${sqlString(eventType)}, ${sqlString(status)}, ${sqlString(actor)}, ${sqlString(summary)}, ${sqlString(details)}, ${sqlString(JSON.stringify(evidence))}, ${sqlString(createdAt)}, ${sqlString(git.branch)}, ${sqlString(git.commit)}, ${sqlString(git.status)}, ${sqlString(evidenceTier)}
);
${status ? `UPDATE feature_items SET status = ${sqlString(status)} WHERE id = ${sqlString(item.id)};` : ""}
${claimSql}
COMMIT;
`);
  exportSql();
  console.log(JSON.stringify({ id, itemId: item.id, featureId: item.feature_id, eventType, status, summary, evidence, evidenceTier }, null, 2));
}

function claimItem(args) {
  const itemId = value(args, "item");
  if (!itemId) throw new Error("--item is required.");
  const actor = value(args, "actor", process.env.USER ?? "agent");
  const ttlHours = Number(value(args, "ttl-hours", "8"));
  const claimedAt = nowIso();
  const expiresAt = new Date(Date.now() + (Number.isFinite(ttlHours) && ttlHours > 0 ? ttlHours : 8) * 60 * 60 * 1000).toISOString();
  const writeScope = values(args, "scope");
  const notes = value(args, "notes");
  const item = getItem(itemId);
  const activeClaim = sqlite(
    `select item_id, actor, expires_at from backlog_item_claims where item_id = ${sqlString(itemId)} and status = 'active' and expires_at > ${sqlString(nowIso())}`,
    { json: true },
  )[0];
  if (activeClaim && !args.flags.has("force")) {
    throw new Error(`${itemId} is already claimed by ${activeClaim.actor} until ${activeClaim.expires_at}. Use --force to replace the claim.`);
  }
  const eventId = itemEventId();
  const git = gitState();
  runSqlFile(`
PRAGMA foreign_keys=ON;
BEGIN TRANSACTION;
INSERT INTO backlog_item_events VALUES (${sqlString(eventId)}, ${sqlString(item.id)}, ${sqlString(item.feature_id)}, 'claim', 'claimed', ${sqlString(actor)}, ${sqlString(`Claimed ${item.id}`)}, ${sqlString(notes)}, ${sqlString(JSON.stringify(writeScope))}, ${sqlString(claimedAt)}, ${sqlString(git.branch)}, ${sqlString(git.commit)}, ${sqlString(git.status)}, 'asserted');
INSERT OR REPLACE INTO backlog_item_claims VALUES (${sqlString(item.id)}, ${sqlString(item.feature_id)}, ${sqlString(actor)}, ${sqlString(claimedAt)}, ${sqlString(expiresAt)}, 'active', ${sqlString(JSON.stringify(writeScope))}, ${sqlString(notes)}, ${sqlString(eventId)});
UPDATE feature_items SET status = 'claimed' WHERE id = ${sqlString(item.id)};
COMMIT;
`);
  exportSql();
  console.log(JSON.stringify({ id: eventId, itemId: item.id, featureId: item.feature_id, actor, expiresAt, writeScope }, null, 2));
}

function transitionItem(args, eventType, status, defaultSummary) {
  const itemId = value(args, "item");
  if (!itemId) throw new Error("--item is required.");
  const actor = value(args, "actor", process.env.USER ?? "agent");
  const summary = value(args, "summary", defaultSummary);
  const details = value(args, "details");
  const evidence = values(args, "evidence");
  const evidenceTier = evidenceTierFromArgs(args);
  const claimStatus = status === "implemented" || status === "verified" ? "completed" : status === "blocked" ? "blocked" : "active";
  const item = getItem(itemId);
  const claimSql = `UPDATE backlog_item_claims SET status = ${sqlString(claimStatus)}, last_event_id = (select id from backlog_item_events where item_id = ${sqlString(item.id)} order by created_at desc, id desc limit 1) WHERE item_id = ${sqlString(item.id)};`;
  recordItemEvent({ itemId, eventType, status, actor, summary, details, evidence, claimSql, evidenceTier });
}

function releaseItem(args) {
  const itemId = value(args, "item");
  if (!itemId) throw new Error("--item is required.");
  const actor = value(args, "actor", process.env.USER ?? "agent");
  const summary = value(args, "summary", `Released claim for ${itemId}`);
  const item = getItem(itemId);
  // A release gives up a claim (status -> planned); it makes no evidence claim, so it
  // intentionally does not accept --tier and records the default 'asserted'. Evidence
  // tiers belong on verify/complete/fail events, which the release gate reads.
  recordItemEvent({
    itemId,
    eventType: "release",
    status: "planned",
    actor,
    summary,
    details: value(args, "details"),
    evidence: values(args, "evidence"),
    claimSql: `UPDATE backlog_item_claims SET status = 'released', last_event_id = (select id from backlog_item_events where item_id = ${sqlString(item.id)} order by created_at desc, id desc limit 1) WHERE item_id = ${sqlString(item.id)};`,
  });
}

function activeClaims() {
  requireDb();
  const rows = sqlite(
    `select c.item_id, c.feature_id, f.title as feature_title, i.item_type, i.title as item_title, c.actor, c.claimed_at, c.expires_at, c.write_scope_json, c.notes from backlog_item_claims c join feature_items i on i.id = c.item_id join features f on f.id = c.feature_id where c.status = 'active' and c.expires_at > ${sqlString(nowIso())} order by c.expires_at, c.item_id`,
    { json: true },
  );
  console.log(JSON.stringify(rows, null, 2));
}

function itemTypeRankSql() {
  return "case i.item_type when 'task' then 1 when 'test_case' then 2 when 'success_criterion' then 3 when 'use_case' then 4 else 9 end";
}

function releaseBandRankSql() {
  return "case f.release_band when 'P0' then 0 when 'P1' then 1 when 'P2' then 2 else 9 end";
}

function nextItems(args) {
  requireDb();
  const limit = Number(value(args, "limit", "10"));
  const feature = value(args, "feature");
  const type = value(args, "type");
  const filters = ["s.current_status in ('planned','deferred','failed')", "coalesce(s.active_claim_actor, '') = ''"];
  if (feature) filters.push(`i.feature_id = ${sqlString(feature)}`);
  if (type) filters.push(`i.item_type = ${sqlString(type)}`);
  if (args.flags.has("strict-dependencies")) {
    filters.push("not exists (select 1 from feature_dependencies d join features dep on dep.id = d.depends_on_feature_id where d.feature_id = f.id and dep.status not in ('implemented','verified'))");
  }
  const rows = sqlite(
    `select i.id, i.feature_id, f.title as feature_title, f.release_band, f.priority, i.item_type, i.position, i.title, s.current_status,
      (select count(*) from feature_dependencies d join features dep on dep.id = d.depends_on_feature_id where d.feature_id = f.id and dep.status not in ('implemented','verified')) as blocking_dependency_count
     from feature_items i join features f on f.id = i.feature_id join backlog_item_current_status s on s.id = i.id
     where ${filters.join(" and ")}
     order by ${releaseBandRankSql()}, f.priority, f.id, ${itemTypeRankSql()}, i.position
     limit ${Number.isFinite(limit) && limit > 0 ? limit : 10}`,
    { json: true },
  );
  console.log(JSON.stringify(rows, null, 2));
}

function showItem(args) {
  const itemId = value(args, "item");
  if (!itemId) throw new Error("--item is required.");
  requireDb();
  const item = getItem(itemId);
  const status = sqlite(`select * from backlog_item_current_status where id = ${sqlString(itemId)}`, { json: true })[0] ?? {};
  const feature = sqlite(`select f.*, e.name as epic from features f join epics e on e.id = f.epic_id where f.id = ${sqlString(item.feature_id)}`, { json: true })[0] ?? {};
  const siblingItems = sqlite(`select id, item_type, position, title, status from feature_items where feature_id = ${sqlString(item.feature_id)} order by item_type, position`, { json: true });
  const personaWorkflows = sqlite(`select persona_id, rbac_role, realm, access_level, workflow, expected_state, primary_route, status from feature_persona_workflows where feature_id = ${sqlString(item.feature_id)} order by realm, persona_id`, { json: true });
  const events = sqlite(`select id, event_type, status, actor, summary, details, evidence_json, created_at from backlog_item_events where item_id = ${sqlString(itemId)} order by created_at, id`, { json: true });
  console.log(JSON.stringify({ item: { ...item, ...status }, feature, siblingItems, personaWorkflows, events }, null, 2));
}

function listBacklog() {
  requireDb();
  const rows = sqlite("select id, epic, feature_key, title, priority, estimate, status, task_count, test_count from backlog_summary", { json: true });
  console.table(rows);
}

function validateBacklog() {
  requireDb();
  const checks = [
    ["features", "select count(*) as count from features"],
    ["epics", "select count(*) as count from epics"],
    ["audit_events", "select count(*) as count from audit_events"],
    ["orphan_feature_dependencies", "select count(*) as count from feature_dependencies d left join features f on f.id = d.depends_on_feature_id where f.id is null"],
    ["orphan_routes", "select count(*) as count from routes r where r.feature_id <> '' and not exists (select 1 from features f where f.id = r.feature_id)"],
    ["features_without_tasks", "select count(*) as count from features f where not exists (select 1 from feature_items t where t.feature_id = f.id and t.item_type = 'task')"],
    ["features_without_tests", "select count(*) as count from features f where not exists (select 1 from feature_items t where t.feature_id = f.id and t.item_type = 'test_case')"],
  ];
  const results = checks.map(([name, sql]) => ({ name, count: sqlite(sql, { json: true })[0]?.count ?? 0 }));
  const structuralFailures = results.filter((row) => (row.name.startsWith("orphan") || row.name.startsWith("features_without")) && row.count > 0);
  // Release gate (F-A): sign-offs on declared-sensitive release classes require live evidence.
  const releaseGateViolations = sqlite(
    "select item_id, feature_id, feature_title, release_classes, current_status, max_evidence_rank from release_gate_violations order by item_id",
    { json: true },
  );
  // Any release-class:<class> label must name a canonical sensitive class (policy in
  // guardrails.json). The gate fails safe on any release-class:* label; this check
  // surfaces typos/misuse so they are corrected rather than silently mis-declared.
  const canonicalClasses = sensitiveReleaseClasses();
  const declaredClasses = sqlite(
    "select distinct replace(label, 'release-class:', '') as class from feature_labels where label like 'release-class:%' order by class",
    { json: true },
  ).map((row) => row.class);
  const unknownReleaseClasses = declaredClasses.filter((cls) => !canonicalClasses.includes(cls));
  const valid = structuralFailures.length === 0 && releaseGateViolations.length === 0 && unknownReleaseClasses.length === 0;
  console.log(JSON.stringify({
    database: dbPath,
    valid,
    results,
    releaseGate: {
      rule: "Items under a feature labelled release-class:<class> cannot be signed off (status 'verified') on asserted/config/test evidence alone -- they require a backlog event with evidence_tier 'live'. Declared classes must be one of the canonical sensitive classes.",
      sensitiveReleaseClasses: canonicalClasses,
      violations: releaseGateViolations,
      unknownReleaseClasses,
    },
  }, null, 2));
  if (!valid) process.exitCode = 1;
}

const args = parseArgs(process.argv.slice(2));

try {
  if (args.command === "setup") setup(args);
  else if (args.command === "export") {
    requireDb();
    exportSql();
    console.log(JSON.stringify({ exported: [dumpPath, schemaPath] }, null, 2));
  } else if (args.command === "validate") validateBacklog();
  else if (args.command === "list") listBacklog();
  else if (args.command === "next") nextItems(args);
  else if (args.command === "show") showItem(args);
  else if (args.command === "claim") claimItem(args);
  else if (args.command === "start") transitionItem(args, "status", "in-progress", `Started ${value(args, "item", "backlog item")}`);
  else if (args.command === "block") transitionItem(args, "status", "blocked", `Blocked ${value(args, "item", "backlog item")}`);
  else if (args.command === "complete") transitionItem(args, "status", "implemented", `Completed ${value(args, "item", "backlog item")}`);
  else if (args.command === "verify") transitionItem(args, "test-result", "verified", `Verified ${value(args, "item", "backlog item")}`);
  else if (args.command === "fail") transitionItem(args, "test-result", "failed", `Failed ${value(args, "item", "backlog item")}`);
  else if (args.command === "release") releaseItem(args);
  else if (args.command === "active") activeClaims();
  else usage();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
