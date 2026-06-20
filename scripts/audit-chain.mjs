// Shared rolling hash-chain helpers for the append-only audit log.
//
// Both the writer (scripts/record-audit.mjs) and the verifier
// (scripts/validate-audit.mjs) import THIS module, so the canonicalization can
// never drift between write and verify. Design follows RFC 9162 (domain
// separation, second-preimage resistance), research.swtch.com/tlog (linear chain,
// fail loudly), and GoLogX (verbatim canonical bytes, fixed genesis).
//
// Properties:
//   - Forward-only: each event carries prevHash (the prior chained event's hash)
//     and its own hash over a CANONICAL field projection (never the raw JSON line,
//     because the DB mirror rebuilds events column-by-column).
//   - Genesis: the first chained event's prevHash is a fixed sentinel (64 zeros).
//   - Pre-chain tolerant: events written before the chain existed carry no hash and
//     are not retroactively chained (rewriting them would violate append-only).
//   - Tamper-evident: inside the chained region, an edit, delete, reorder, or insert
//     that KEEPS the event's hash field breaks the chain and is a HARD FAIL. A rewrite
//     that also STRIPS the hash field would otherwise be reclassified as a tolerated
//     legacy event -- that laundering path, plus chained-tip truncation and pre-chain
//     edits, is closed by the chain-state sidecar (high-water mark) below, NOT by
//     verifyChain alone.
//   - High-water mark: a git-tracked sidecar records how many events were chained, the
//     tip hash, and a digest freezing the legacy prefix. Validation HARD-FAILS when it
//     later sees fewer chained events (downgrade-to-legacy or tip truncation), or a
//     changed legacy prefix, than the sidecar recorded.
//
// Trust boundary (stated honestly): the chain + sidecar prove the log is INTERNALLY
// consistent and has not SHRUNK since the trusted writer last ran. They do not, by
// themselves, stop an attacker who can rewrite BOTH the log AND the sidecar from
// re-chaining a forged history. The real anchor is the deterministic hook (which
// blocks writes to audit-log.jsonl) plus the sidecar being git-tracked, so a forged
// rewrite must also survive code review / git history. Deleting the sidecar drops back
// to bootstrap tolerance (pre-feature logs still validate) -- the documented limit.

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const CHAIN_VERSION = "adg-audit-chain-v1";
export const GENESIS = "0".repeat(64);

// Fixed field order. Changing this list is a breaking change to the chain, hence
// the version tag is the first element (domain separation / versioning).
const CHAIN_FIELDS = [
  "id",
  "occurredAt",
  "actor",
  "eventType",
  "targetType",
  "targetId",
  "featureId",
  "status",
  "summary",
  "details",
  "evidence",
  "evidenceTier",
];

// Canonical preimage: a deterministic, unambiguous serialization of the event's
// identity and claim plus prevHash, EXCLUDING the hash field itself. A JSON array in
// fixed order is unambiguous (quoting/commas delimit every field, so no boundary can
// shift). evidence is normalised to a JSON array string; missing fields normalise to "".
export function canonicalPreimage(event, prevHash) {
  const values = CHAIN_FIELDS.map((key) => {
    if (key === "evidence") return JSON.stringify(Array.isArray(event.evidence) ? event.evidence : []);
    const v = event[key];
    return v === undefined || v === null ? "" : String(v);
  });
  return JSON.stringify([CHAIN_VERSION, ...values, prevHash]);
}

export function computeHash(event, prevHash) {
  return createHash("sha256").update(canonicalPreimage(event, prevHash)).digest("hex");
}

// Stamp prevHash + hash onto an event (mutates and returns it). hash is computed over
// the canonical projection that INCLUDES prevHash and EXCLUDES hash.
export function chainEvent(event, prevHash) {
  event.prevHash = prevHash;
  event.hash = computeHash(event, prevHash);
  return event;
}

// The hash to chain the NEXT event against, given the existing log lines. Returns the
// last chained event's hash, or GENESIS if no chained event exists yet.
export function nextPrevHash(lines) {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (!line || !line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (typeof event.hash === "string" && event.hash) return event.hash;
    } catch {
      /* skip unparseable lines when looking for the tail hash */
    }
  }
  return GENESIS;
}

// Verify the chained region of a log. Pre-chain events (no hash) are ignored here
// (the caller validates them with the legacy rules). Returns { ok, failures,
// chainedCount, firstChainedLine }. A break anywhere in the chained region is a
// failure (the caller turns failures into a hard exit).
export function verifyChain(entries) {
  // entries: [{ lineNo, event }] in file order, parseable events only.
  const failures = [];
  let prevHash = null; // null until we enter the chained region
  let expectedPrev = GENESIS;
  let chainedCount = 0;
  let firstChainedLine = null;

  for (const { lineNo, event } of entries) {
    const isChained = typeof event.hash === "string" && event.hash;
    if (!isChained) {
      if (prevHash !== null) {
        // A chainless event after the chain started = an inserted/foreign line.
        failures.push(`Line ${lineNo}: event without a hash appears inside the chained region (possible insertion or tampering).`);
      }
      continue;
    }
    if (firstChainedLine === null) firstChainedLine = lineNo;
    chainedCount += 1;
    const declaredPrev = typeof event.prevHash === "string" ? event.prevHash : "";
    if (declaredPrev !== expectedPrev) {
      failures.push(`Line ${lineNo}: prevHash mismatch (chain break: edit, delete, reorder, or insert). expected ${expectedPrev.slice(0, 12)}..., got ${declaredPrev.slice(0, 12)}...`);
    }
    const recomputed = computeHash(event, declaredPrev);
    if (recomputed !== event.hash) {
      failures.push(`Line ${lineNo}: hash mismatch (event content was altered after signing). expected ${recomputed.slice(0, 12)}..., stored ${String(event.hash).slice(0, 12)}...`);
    }
    prevHash = event.hash;
    expectedPrev = event.hash;
  }
  return { ok: failures.length === 0, failures, chainedCount, firstChainedLine };
}

// ---------------------------------------------------------------------------
// Chain-state sidecar (high-water mark)
//
// verifyChain proves the chained region is INTERNALLY consistent, but it TOLERATES a
// hashless event as a pre-chain ("legacy") event. That tolerance is a laundering path:
// an attacker who can rewrite the file can edit a chained event AND strip its
// hash/prevHash, so verifyChain reclassifies it as legacy and passes (A). The same
// blind spot lets the chained tip be truncated (B) and the pre-chain region be
// edited/deleted undetected (C/D).
//
// The sidecar closes those holes by persisting, OUTSIDE the log, what the chain looked
// like the last time the trusted writer ran: the count of chained events (the
// high-water mark), the tip hash, and a digest freezing the legacy prefix. The writer
// (record-audit) advances it monotonically; the verifier (validate-audit) only reads
// it and HARD-FAILS on a regression. It is a sidecar, not a mutable trust store: it is
// git-tracked, so the real anchor remains git history / review.
// ---------------------------------------------------------------------------

export const STATE_VERSION = "adg-audit-chain-state-v1";

// Sidecar path: a sibling of the log (audit-log.jsonl -> audit-log.chain-state.json),
// so a hermetic test pointing ADG_AUDIT_LOG_PATH at a temp log gets its own sidecar.
export function chainStatePath(logPath) {
  const dir = path.dirname(logPath);
  const base = path.basename(logPath).replace(/\.jsonl?$/iu, "");
  return path.join(dir, `${base}.chain-state.json`);
}

// Domain-separated digest over the frozen legacy prefix (the pre-chain events before
// the first chained event). Reuses the canonical field projection so the digest
// captures the same content the chain would, and changes if any legacy event's
// content, count, or order changes.
export function legacyPrefixDigest(legacyEvents) {
  const h = createHash("sha256");
  h.update(`${STATE_VERSION}\nlegacy\n${legacyEvents.length}\n`);
  for (const event of legacyEvents) h.update(`${canonicalPreimage(event, "")}\n`);
  return h.digest("hex");
}

// Derive the current chain-state snapshot from parsed entries ([{ event }] or
// [{ lineNo, event }], in file order). The legacy prefix is the run of hashless events
// BEFORE the first chained event; a hashless event AFTER the chain started is an
// insertion (verifyChain fails on it) and is counted as neither chained nor legacy.
export function deriveChainState(entries) {
  const legacy = [];
  let sawChained = false;
  let chainedCount = 0;
  let tipHash = GENESIS;
  for (const { event } of entries) {
    const isChained = typeof event.hash === "string" && event.hash;
    if (isChained) {
      sawChained = true;
      chainedCount += 1;
      tipHash = event.hash;
    } else if (!sawChained) {
      legacy.push(event);
    }
  }
  return {
    version: STATE_VERSION,
    chainedCount,
    tipHash: chainedCount ? tipHash : GENESIS,
    legacyCount: legacy.length,
    legacyDigest: legacyPrefixDigest(legacy),
  };
}

// Merge a freshly-derived snapshot into the recorded one for the WRITER. The high-water
// mark never decreases and the legacy prefix is frozen at first record: if the on-disk
// log appears to have SHRUNK (a strip/truncate happened before this append), refuse to
// record the regression so a later validation still detects the tamper.
export function advanceChainState(recorded, current) {
  if (!recorded) return current;
  if (current.chainedCount < recorded.chainedCount) return recorded;
  return {
    version: current.version,
    chainedCount: current.chainedCount,
    tipHash: current.tipHash,
    legacyCount: recorded.legacyCount,
    legacyDigest: recorded.legacyDigest,
  };
}

// Verify the current snapshot against the recorded high-water mark (VERIFIER side).
// Returns { ok, failures, enforced }. enforced=false when no sidecar exists yet
// (bootstrap / pre-feature logs are tolerated, exactly like pre-chain events).
export function verifyChainState(current, recorded) {
  const failures = [];
  if (!recorded) return { ok: true, failures, enforced: false };
  if (current.chainedCount < recorded.chainedCount) {
    failures.push(
      `Chain high-water regression: ${recorded.chainedCount} event(s) were recorded as chained, only ${current.chainedCount} now. The log was rewritten (chained events downgraded to legacy, or the chained tip truncated).`,
    );
  } else if (current.legacyCount !== recorded.legacyCount) {
    failures.push(
      `Legacy prefix size changed: ${recorded.legacyCount} pre-chain event(s) were recorded, ${current.legacyCount} now (a pre-chain event was inserted or deleted).`,
    );
  } else if (current.legacyDigest !== recorded.legacyDigest) {
    failures.push("Legacy prefix digest mismatch: a pre-chain (legacy) event was edited after the chain froze it.");
  }
  return { ok: failures.length === 0, failures, enforced: true };
}

// Sidecar I/O. read returns the parsed state, or null when missing/unparseable
// (bootstrap tolerance: a log predating this feature has no sidecar and is not failed).
export function readChainState(logPath) {
  try {
    return JSON.parse(fs.readFileSync(chainStatePath(logPath), "utf8"));
  } catch {
    return null;
  }
}

// Atomic-ish write (temp + rename) so a crash can't leave a half-written sidecar.
export function writeChainState(logPath, state) {
  const dest = chainStatePath(logPath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, dest);
}

// Parse newline-delimited JSON log text into entries ([{ event }]), skipping blank or
// unparseable lines. Shared so the writer derives state exactly as the verifier does.
export function entriesFromText(text) {
  const entries = [];
  for (const line of text.split(/\r?\n/u)) {
    if (!line.trim()) continue;
    try {
      entries.push({ event: JSON.parse(line) });
    } catch {
      /* skip unparseable lines; validate-audit reports them separately */
    }
  }
  return entries;
}
