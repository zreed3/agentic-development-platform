#!/usr/bin/env node
// Validate the append-only audit log.
//
// The audit log is the trust primitive: it must be parseable, every event must
// carry the minimum fields, ids must be unique, and -- critically -- it must not
// contain secret material. This validator enforces those invariants. It does NOT
// rewrite the log; corrections are made by appending a corrective event.
//
// Exits non-zero if any hard failure is found.

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const auditLogPath = "data/audit/audit-log.jsonl";
const policyPath = "config/agentic/guardrails.json";

function abs(file) {
  return path.isAbsolute(file) ? file : path.join(root, file);
}

const KNOWN_EVENT_TYPES = new Set([
  "status",
  "comment",
  "evidence",
  "test-result",
  "decision",
  "scope-change",
  "workspace-state",
]);

function loadRedactKeys() {
  try {
    const policy = JSON.parse(fs.readFileSync(abs(policyPath), "utf8"));
    return Array.isArray(policy.redactFields) ? policy.redactFields : [];
  } catch {
    return ["password", "secret", "token", "apiKey", "authorization", "cookie", "privateKey", "webhookSecret"];
  }
}

const DEFAULT_EVIDENCE_TIERS = ["asserted", "config", "test", "live"];

function loadEvidenceTiers() {
  try {
    const policy = JSON.parse(fs.readFileSync(abs(policyPath), "utf8"));
    const tiers = policy.evidence?.tiers;
    return Array.isArray(tiers) && tiers.length ? tiers : DEFAULT_EVIDENCE_TIERS;
  } catch {
    return DEFAULT_EVIDENCE_TIERS;
  }
}

function looksLikeSecret(text, redactKeys) {
  if (!text) return null;
  const haystack = String(text);
  // key=value or key: value where key is a redact field and value is non-trivial.
  // Redact keys are simple identifiers (password, token, apiKey, ...) so no
  // regex escaping is required.
  for (const key of redactKeys) {
    const pattern = new RegExp(`\\b${key}\\b\\s*[:=]\\s*['"]?[^\\s'"]{6,}`, "iu");
    if (pattern.test(haystack)) return `value resembling ${key}`;
  }
  // long opaque tokens (JWT-ish, hex/base64 blobs).
  if (/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{6,}\b/u.test(haystack)) return "JWT-like token";
  if (/\b(?:sk|pk|rk|ghp|xox[baprs])[-_][A-Za-z0-9]{16,}\b/u.test(haystack)) return "prefixed API key";
  if (/\b[A-Fa-f0-9]{40,}\b/u.test(haystack)) return "long hex blob";
  return null;
}

function main() {
  if (!fs.existsSync(abs(auditLogPath))) {
    console.log(JSON.stringify({ auditLogPath, valid: true, events: 0, warnings: ["Audit log does not exist yet."], failures: [] }, null, 2));
    return;
  }
  const redactKeys = loadRedactKeys();
  const evidenceTiers = loadEvidenceTiers();
  const lines = fs.readFileSync(abs(auditLogPath), "utf8").split(/\r?\n/u);
  const failures = [];
  const warnings = [];
  const ids = new Set();
  let count = 0;
  let previousAt = null;

  lines.forEach((line, index) => {
    if (!line.trim()) return;
    const lineNo = index + 1;
    let event;
    try {
      event = JSON.parse(line);
    } catch (error) {
      failures.push(`Line ${lineNo}: not valid JSON (${error instanceof Error ? error.message : "parse error"})`);
      return;
    }
    count += 1;
    if (!event.id || typeof event.id !== "string") failures.push(`Line ${lineNo}: missing id`);
    else if (ids.has(event.id)) failures.push(`Line ${lineNo}: duplicate id ${event.id}`);
    else ids.add(event.id);

    if (!event.eventType) failures.push(`Line ${lineNo}: missing eventType`);
    else if (!KNOWN_EVENT_TYPES.has(event.eventType)) warnings.push(`Line ${lineNo}: unknown eventType "${event.eventType}"`);

    const occurredAt = Date.parse(event.occurredAt);
    if (Number.isNaN(occurredAt)) failures.push(`Line ${lineNo}: missing or invalid occurredAt`);
    else {
      if (previousAt !== null && occurredAt < previousAt) warnings.push(`Line ${lineNo}: occurredAt is earlier than the previous event (append-only logs should be time-ordered)`);
      previousAt = occurredAt;
    }

    if (!event.summary) warnings.push(`Line ${lineNo}: empty summary`);

    if (event.evidenceTier !== undefined && !evidenceTiers.includes(event.evidenceTier)) {
      failures.push(`Line ${lineNo}: invalid evidenceTier "${event.evidenceTier}" (expected one of: ${evidenceTiers.join(", ")})`);
    }

    const evidenceText = Array.isArray(event.evidence) ? event.evidence.join(" ") : "";
    const secretHit = looksLikeSecret(event.summary, redactKeys) || looksLikeSecret(event.details, redactKeys) || looksLikeSecret(evidenceText, redactKeys);
    if (secretHit) failures.push(`Line ${lineNo}: possible secret material in event (${secretHit}). Audit events must not contain secrets.`);
  });

  const result = { auditLogPath, valid: failures.length === 0, events: count, failures, warnings };
  console.log(JSON.stringify(result, null, 2));
  if (!result.valid) process.exit(1);
}

main();
