#!/usr/bin/env node
// Append one event to the append-only audit log, and mirror it into the
// audit_events table if the database exists.
//
//   node scripts/record-audit.mjs --feature S07 --type status \
//     --status in-progress --summary "Started context broker work" \
//     --evidence scripts/agent-context.mjs
//
// This NEVER rewrites existing events. If a past event was wrong, append a
// corrective comment/decision event instead.

import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const auditLogPath = "data/audit/audit-log.jsonl";
const dbPath = "data/backlog.sqlite";

function abs(file) {
  return path.isAbsolute(file) ? file : path.join(root, file);
}

function exec(cmd, fallback = "") {
  try {
    return execSync(cmd, { cwd: root, encoding: "utf8", shell: "/bin/zsh" }).trim();
  } catch {
    return fallback;
  }
}

function sqlString(value) {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function parseArgs(argv) {
  const args = { flags: new Set(), values: {} };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    args.flags.add(key);
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

function multi(args, key) {
  const raw = args.values[key];
  if (raw === undefined || raw === true) return [];
  return Array.isArray(raw) ? raw.map(String) : [String(raw)];
}

// Ordered evidence tiers (asserted < config < test < live). Mirrors
// config/agentic/guardrails.json -> evidence.tiers and the audit_events CHECK
// constraint in scripts/backlog-db.mjs. The tier records what kind of proof backs
// the event; the release gate (backlog:validate) requires `live` to sign off a
// declared-sensitive release class.
const EVIDENCE_TIERS = ["asserted", "config", "test", "live"];

const args = parseArgs(process.argv.slice(2));
const summary = value(args, "summary");
if (!summary) {
  console.error("--summary is required");
  process.exit(1);
}

const evidenceTier = value(args, "tier", "asserted");
if (!EVIDENCE_TIERS.includes(evidenceTier)) {
  console.error(`Invalid --tier "${evidenceTier}". Expected one of: ${EVIDENCE_TIERS.join(", ")}`);
  process.exit(1);
}

const occurredAt = new Date().toISOString();
const id = `AUD-${occurredAt.replace(/[-:.TZ]/gu, "").slice(0, 14)}-${randomBytes(3).toString("hex")}`;
const featureId = value(args, "feature");
const event = {
  id,
  occurredAt,
  actor: value(args, "actor", process.env.USER || "agent"),
  eventType: value(args, "type", "comment"),
  targetType: value(args, "target-type", featureId ? "feature" : "platform"),
  targetId: value(args, "target-id", featureId),
  featureId,
  status: value(args, "status"),
  summary,
  details: value(args, "details"),
  evidence: multi(args, "evidence"),
  evidenceTier,
  git: {
    branch: exec("git rev-parse --abbrev-ref HEAD", "unknown"),
    commit: exec("git rev-parse HEAD", "uncommitted"),
    status: exec("git status --porcelain=v1", "") || "clean",
  },
  source: auditLogPath,
};

fs.mkdirSync(path.dirname(abs(auditLogPath)), { recursive: true });
fs.appendFileSync(abs(auditLogPath), `${JSON.stringify(event)}\n`, "utf8");

if (fs.existsSync(abs(dbPath))) {
  const insert = `INSERT OR REPLACE INTO audit_events VALUES (${sqlString(event.id)}, ${sqlString(event.occurredAt)}, ${sqlString(event.actor)}, ${sqlString(event.eventType)}, ${sqlString(event.targetType)}, ${sqlString(event.targetId)}, ${sqlString(event.featureId)}, ${sqlString(event.status)}, ${sqlString(event.summary)}, ${sqlString(event.details)}, ${sqlString(JSON.stringify(event.evidence))}, ${sqlString(event.evidenceTier)});`;
  execSync(`sqlite3 ${JSON.stringify(abs(dbPath))} ${JSON.stringify(insert)}`, { cwd: root, shell: "/bin/zsh" });
}

console.log(JSON.stringify({ recorded: event.id, eventType: event.eventType, featureId: event.featureId, evidenceTier: event.evidenceTier, mirroredToDb: fs.existsSync(abs(dbPath)) }, null, 2));
