#!/usr/bin/env node
// Capture DORA-style delivery metrics from local signals only: git history over
// the last 30 days plus the append-only audit log. These are deliberately called
// "proxies" -- they approximate deployment frequency, change lead time, change
// failure rate, and rework without an external DevOps platform. Mirrored into
// SQLite/SQL/JSON.

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const auditLogPath = "data/audit/audit-log.jsonl";
const outJson = "data/delivery-metrics.json";
const outSql = "data/delivery-metrics.sql";
const outSqlite = "data/delivery-metrics.sqlite";

function abs(file) {
  return path.join(root, file);
}

function exec(cmd) {
  try {
    return execSync(cmd, { cwd: root, encoding: "utf8", shell: "/bin/zsh" }).trim();
  } catch {
    return "";
  }
}

function sqlString(value) {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function readAuditEvents() {
  if (!fs.existsSync(abs(auditLogPath))) return [];
  return fs.readFileSync(abs(auditLogPath), "utf8")
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

const now = new Date().toISOString();
const auditEvents = readAuditEvents();
const gitLog = exec("git log --since='30 days ago' --pretty=format:%H%x09%ct%x09%s --no-merges")
  .split(/\r?\n/u)
  .filter(Boolean)
  .map((line) => {
    const [sha, timestamp, ...messageParts] = line.split("\t");
    return { sha, timestamp: Number(timestamp), message: messageParts.join("\t") };
  });
const releaseEvents = auditEvents.filter((event) => ["status", "evidence", "test-result"].includes(event.eventType));
const failedSignals = auditEvents.filter((event) => /fail|failed|rollback|incident|breach|blocked/iu.test(`${event.status} ${event.summary} ${event.details}`));
const implementedSignals = auditEvents.filter((event) => ["implemented", "verified"].includes(event.status));
const firstAuditAt = auditEvents.length ? Math.min(...auditEvents.map((event) => Date.parse(event.occurredAt)).filter(Number.isFinite)) : null;
const latestAuditAt = auditEvents.length ? Math.max(...auditEvents.map((event) => Date.parse(event.occurredAt)).filter(Number.isFinite)) : null;
const leadTimeHours = firstAuditAt && latestAuditAt ? Number(((latestAuditAt - firstAuditAt) / 36e5).toFixed(2)) : null;

const metrics = {
  capturedAt: now,
  window: "last 30 days local git plus audit log",
  deploymentFrequencyProxy: {
    commitsLast30Days: gitLog.length,
    releaseEvidenceEvents: releaseEvents.length,
  },
  changeLeadTimeProxy: {
    firstAuditAt: firstAuditAt ? new Date(firstAuditAt).toISOString() : null,
    latestAuditAt: latestAuditAt ? new Date(latestAuditAt).toISOString() : null,
    auditWindowHours: leadTimeHours,
  },
  changeFailureRateProxy: {
    failedSignals: failedSignals.length,
    implementedOrVerifiedSignals: implementedSignals.length,
    ratio: implementedSignals.length ? Number((failedSignals.length / implementedSignals.length).toFixed(3)) : null,
  },
  recoveryTimeProxy: {
    status: "not-enough-incident-data",
    note: "Record incident and recovery audit events to calculate failed deployment recovery time.",
  },
  deploymentReworkRateProxy: {
    reworkSignals: auditEvents.filter((event) => /rework|redo|corrective|superseded/iu.test(`${event.status} ${event.summary} ${event.details}`)).length,
  },
};

fs.mkdirSync(path.dirname(abs(outJson)), { recursive: true });
fs.writeFileSync(abs(outJson), `${JSON.stringify(metrics, null, 2)}\n`, "utf8");

const statements = [
  "DROP TABLE IF EXISTS delivery_metrics;",
  "CREATE TABLE delivery_metrics (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
];
for (const [key, value] of Object.entries({
  captured_at: metrics.capturedAt,
  window: metrics.window,
  commits_last_30_days: metrics.deploymentFrequencyProxy.commitsLast30Days,
  release_evidence_events: metrics.deploymentFrequencyProxy.releaseEvidenceEvents,
  audit_window_hours: metrics.changeLeadTimeProxy.auditWindowHours,
  failed_signals: metrics.changeFailureRateProxy.failedSignals,
  implemented_or_verified_signals: metrics.changeFailureRateProxy.implementedOrVerifiedSignals,
  change_failure_ratio: metrics.changeFailureRateProxy.ratio,
  recovery_time_status: metrics.recoveryTimeProxy.status,
  rework_signals: metrics.deploymentReworkRateProxy.reworkSignals,
})) {
  statements.push(`INSERT INTO delivery_metrics VALUES (${sqlString(key)}, ${sqlString(value)});`);
}
fs.writeFileSync(abs(outSql), `${statements.join("\n")}\n`, "utf8");
if (fs.existsSync(abs(outSqlite))) fs.rmSync(abs(outSqlite));
execSync(`sqlite3 ${JSON.stringify(abs(outSqlite))} < ${JSON.stringify(abs(outSql))}`, { cwd: root, shell: "/bin/zsh" });

console.log(JSON.stringify(metrics, null, 2));
