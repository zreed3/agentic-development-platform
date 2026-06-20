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
import { deriveChainState, readChainState, verifyChain, verifyChainState } from "./audit-chain.mjs";

const root = process.cwd();
// ADG_AUDIT_LOG_PATH overrides the log path for hermetic tests only; defaults canonical.
const auditLogPath = process.env.ADG_AUDIT_LOG_PATH || "data/audit/audit-log.jsonl";
const policyPath = process.env.ADG_GUARDRAILS_PATH || "config/agentic/guardrails.json";
// --quiet emits one machine-readable line; exit codes are byte-identical to verbose.
const quiet = process.argv.includes("--quiet");
function emit(payload, line) {
  console.log(quiet ? line : JSON.stringify(payload, null, 2));
}

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
    emit({ auditLogPath, valid: true, events: 0, warnings: ["Audit log does not exist yet."], failures: [] }, "audit: ok (0 events, log not created yet)");
    return;
  }
  const redactKeys = loadRedactKeys();
  const evidenceTiers = loadEvidenceTiers();
  const lines = fs.readFileSync(abs(auditLogPath), "utf8").split(/\r?\n/u);
  const failures = [];
  const warnings = [];
  const ids = new Set();
  const entries = [];
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
    entries.push({ lineNo, event });
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

  // Rolling hash-chain verification (tamper-evidence). A break inside the chained
  // region that KEEPS the event's hash (edit, delete, reorder, insert) is a HARD FAIL.
  // Events written before the chain existed carry no hash and are tolerated (not
  // retroactively chained: that would be a rewrite). A rewrite that also STRIPS the
  // hash field would be reclassified as legacy and slip past this check -- that, plus
  // tip truncation and legacy edits, is caught by the chain-state high-water mark
  // below, not here. Timestamp ordering stays a warning above, because the chain is the
  // authoritative reorder detector within the chained region.
  const chain = verifyChain(entries);
  failures.push(...chain.failures);

  // Chain-state high-water mark (tamper-evidence the chain alone cannot give). The
  // chain TOLERATES hashless events as legacy, so a rewrite that strips a chained
  // event's hash, or truncates the chained tip, would otherwise pass verifyChain. The
  // sidecar HARD-FAILS when the chained region has SHRUNK below, or the frozen legacy
  // prefix differs from, what the trusted writer last recorded. Read-only: the verifier
  // never advances the mark. No sidecar yet -> bootstrap tolerance (enforced=false).
  const recordedState = readChainState(abs(auditLogPath));
  const stateCheck = verifyChainState(deriveChainState(entries), recordedState);
  failures.push(...stateCheck.failures);

  const result = {
    auditLogPath,
    valid: failures.length === 0,
    events: count,
    chained: chain.chainedCount,
    chainStateEnforced: stateCheck.enforced,
    failures,
    warnings,
  };
  emit(result, `audit: ${result.valid ? "ok" : "FAIL"} (${count} events, ${chain.chainedCount} chained${failures.length ? `, ${failures.length} failure(s): ${failures[0]}` : ""})`);
  if (!result.valid) process.exit(1);
}

main();
