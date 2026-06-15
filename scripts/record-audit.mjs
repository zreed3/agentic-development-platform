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
import {
  advanceChainState,
  chainEvent,
  deriveChainState,
  entriesFromText,
  nextPrevHash,
  readChainState,
  writeChainState,
} from "./audit-chain.mjs";

const root = process.cwd();
// Canonical append-only log + DB mirror. ADG_AUDIT_LOG_PATH / ADG_AUDIT_DB_PATH
// override them for hermetic tests only; both default to the canonical paths and
// the write stays strictly append-only (fs.appendFileSync, never a rewrite).
const auditLogPath = process.env.ADG_AUDIT_LOG_PATH || "data/audit/audit-log.jsonl";
const dbPath = process.env.ADG_AUDIT_LOG_PATH && !process.env.ADG_AUDIT_DB_PATH ? "" : (process.env.ADG_AUDIT_DB_PATH || "data/backlog.sqlite");

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

// Stamp the rolling hash chain: prevHash = the prior chained event's hash (or the
// GENESIS sentinel for the first chained event), and hash = the canonical projection
// of this event. prevHash/hash stay top-level (out of summary/details/evidence) so the
// secret scan never mistakes a 64-hex hash for a secret. The write stays a single
// append; no earlier line is ever read-modify-written.
fs.mkdirSync(path.dirname(abs(auditLogPath)), { recursive: true });
const existingLines = fs.existsSync(abs(auditLogPath)) ? fs.readFileSync(abs(auditLogPath), "utf8").split(/\r?\n/u) : [];
chainEvent(event, nextPrevHash(existingLines));
fs.appendFileSync(abs(auditLogPath), `${JSON.stringify(event)}\n`, "utf8");

// Advance the chain-state high-water-mark sidecar. This is the tamper-evidence the
// chain alone cannot provide: it lets validation detect a later rewrite that strips
// hashes (downgrading chained events to "legacy") or truncates the chained tip.
// Re-read the now-appended log, derive the snapshot, and merge so the mark never
// regresses and the legacy prefix stays frozen. A sidecar failure must never block the
// append (the log is the primary record and is already written), so warn and continue.
try {
  const entries = entriesFromText(fs.readFileSync(abs(auditLogPath), "utf8"));
  const nextState = advanceChainState(readChainState(abs(auditLogPath)), deriveChainState(entries));
  writeChainState(abs(auditLogPath), nextState);
} catch (error) {
  console.error(`warning: could not update audit chain-state sidecar (${error instanceof Error ? error.message : error})`);
}

const mirrorToDb = Boolean(dbPath) && fs.existsSync(abs(dbPath));
if (mirrorToDb) {
  const insert = `INSERT OR REPLACE INTO audit_events VALUES (${sqlString(event.id)}, ${sqlString(event.occurredAt)}, ${sqlString(event.actor)}, ${sqlString(event.eventType)}, ${sqlString(event.targetType)}, ${sqlString(event.targetId)}, ${sqlString(event.featureId)}, ${sqlString(event.status)}, ${sqlString(event.summary)}, ${sqlString(event.details)}, ${sqlString(JSON.stringify(event.evidence))}, ${sqlString(event.evidenceTier)});`;
  execSync(`sqlite3 ${JSON.stringify(abs(dbPath))} ${JSON.stringify(insert)}`, { cwd: root, shell: "/bin/zsh" });
}

console.log(JSON.stringify({ recorded: event.id, eventType: event.eventType, featureId: event.featureId, evidenceTier: event.evidenceTier, mirroredToDb: mirrorToDb }, null, 2));
