import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// The dashboard lives at apps/dashboard; the data layer lives at the repo root.
// Override with ADG_ROOT when serving a built app from elsewhere.
const ROOT = process.env.ADG_ROOT ? resolve(process.env.ADG_ROOT) : resolve(process.cwd(), '../..');

const p = (rel) => resolve(ROOT, rel);

/** Run a read-only query against a SQLite database via the sqlite3 CLI. */
export function query(db, sql) {
  const file = p(db);
  if (!existsSync(file)) return [];
  const out = execFileSync('sqlite3', ['-json', '-readonly', file, sql], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024
  });
  return out.trim() ? JSON.parse(out) : [];
}

export function readJson(rel, fallback = null) {
  const file = p(rel);
  if (!existsSync(file)) return fallback;
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function readJsonl(rel) {
  const file = p(rel);
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

// ---- Domain readers -------------------------------------------------------

export function backlogSummary() {
  return query('data/backlog.sqlite', 'SELECT * FROM backlog_summary ORDER BY priority, id');
}

export function featureStatus() {
  return query(
    'data/backlog.sqlite',
    'SELECT * FROM feature_current_status ORDER BY feature_id'
  );
}

export function statusCounts() {
  return query(
    'data/backlog.sqlite',
    `SELECT current_status AS status, COUNT(*) AS n
     FROM feature_current_status GROUP BY current_status ORDER BY n DESC`
  );
}

export function releaseGateViolations() {
  return query('data/backlog.sqlite', 'SELECT * FROM release_gate_violations');
}

export function featureDetail() {
  return query(
    'data/backlog.sqlite',
    `SELECT s.*, c.current_status, c.latest_update, c.latest_update_at
     FROM backlog_summary s
     LEFT JOIN feature_current_status c ON c.feature_id = s.id
     ORDER BY s.priority, s.id`
  );
}

export function auditEvents() {
  return readJsonl('data/audit/audit-log.jsonl').reverse();
}

export function guardrails() {
  return readJson('config/agentic/guardrails.json', {});
}

// Read-only view of the toggleable-controls state from the single policy source.
// The dashboard never mutates a control; toggling is the governed CLI's job.
export function controlState() {
  const policy = readJson('config/agentic/guardrails.json', {});
  const defs = policy.controls?.definitions ?? {};
  return {
    version: policy.controls?.version ?? null,
    mandatoryAlwaysOn: policy.controls?.mandatoryAlwaysOn ?? [],
    controls: Object.entries(defs).map(([name, d]) => ({
      name,
      enabled: d.enabled !== false,
      alwaysOn: d.alwaysOn === true,
      effect: d.effect ?? '',
      appliesTo: d.appliesTo ?? null,
      description: d.description ?? ''
    }))
  };
}

// Toggle history: the append-only audit decision events the governed toggle writes
// (summary 'Toggled control ...'), newest first. Read-only.
export function controlToggleHistory() {
  return readJsonl('data/audit/audit-log.jsonl')
    .filter((e) => e.eventType === 'decision' && /Toggled control/i.test(e.summary || ''))
    .reverse();
}

export function evals() {
  return readJson('data/agent-evals.json', null);
}

export function doraMetrics() {
  return readJson('data/delivery-metrics.json', null);
}
