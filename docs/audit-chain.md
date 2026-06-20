# Audit log rolling hash chain

The append-only audit log (`data/audit/audit-log.jsonl`) carries a rolling hash chain
so that an edit, deletion, reorder, or insertion inside the chained region is a hard
failure at validation, not a silent change. Style rule: no em dashes.

## How it works

`scripts/audit-chain.mjs` is the single shared module imported by both the writer
(`scripts/record-audit.mjs`) and the verifier (`scripts/validate-audit.mjs`), so the
canonicalization can never drift between write and verify.

- Each chained event carries two top-level fields: `prevHash` (the prior chained
  event's `hash`, or the GENESIS sentinel of 64 zeros for the first chained event) and
  `hash` (SHA-256 over a canonical, fixed-order projection of the event's identity and
  claim fields plus `prevHash`, explicitly excluding `hash` itself).
- The canonical projection is a JSON array in a fixed field order, tagged with a chain
  version. It is NOT the raw JSON line, because the SQL mirror rebuilds events
  column-by-column and could never reproduce a raw-line hash.
- The write stays a single `fs.appendFileSync`. No earlier line is ever read, modified,
  or rewritten. Repairing a broken chain by rewriting history is forbidden; the
  corrective path is the existing discipline of appending a corrective event.

## What it detects

`npm run audit:validate` recomputes the chain and HARD FAILS on:

- an edited event (the recomputed `hash` no longer matches the stored `hash`);
- a deleted, reordered, or inserted event (a `prevHash` no longer matches the prior
  chained event's `hash`);
- a chainless event appearing inside the chained region (insertion or tampering).

The chain alone has one blind spot: it TOLERATES a hashless event as a pre-chain
(legacy) event. A rewrite that edits a chained event AND strips its `hash`/`prevHash`
would be reclassified as legacy and slip past the checks above. The same blind spot
hides a truncation of the chained tip and any edit or deletion in the pre-chain region.
Those holes are closed by the high-water-mark sidecar below, not by chain
recomputation.

Timestamp out-of-order remains a warning, because the chain is the authoritative
reorder detector within the chained region.

## High-water-mark sidecar

A git-tracked sidecar (`data/audit/audit-log.chain-state.json`, named as a sibling of
the log) records what the chain looked like the last time the trusted writer ran:

- `chainedCount`: how many events were chained (the high-water mark);
- `tipHash`: the last chained event's `hash`;
- `legacyCount` / `legacyDigest`: a domain-separated digest that freezes the pre-chain
  prefix.

`record-audit` advances the sidecar after every append (monotonically: the count never
decreases and the legacy prefix stays frozen). `validate-audit` only reads it and HARD
FAILS when the current log has FEWER chained events than recorded (a strip-all-hashes
forgery or a truncated tip), or when the frozen legacy prefix has changed (a pre-chain
edit, insert, or delete). Validation never writes the sidecar, so running the verifier
cannot launder a tamper.

When no sidecar exists yet (a log predating this feature, or a fresh install before its
first `record-audit`), validation falls back to bootstrap tolerance and does not fail.
The first recorded event creates the sidecar and activates enforcement.

## Pre-chain events

Events written before the chain existed carry no `hash`. They are tolerated, not
retroactively chained, because backfilling a hash into a historical line would be a
rewrite and would violate the append-only property. The chain is verified from the
first event that carries a `hash` forward. Once the chain starts, the pre-chain prefix
is frozen into the sidecar's `legacyDigest`, so a later edit to a legacy event is a hard
failure even though that event itself is not chained.

## Trust boundary (stated honestly)

The chain plus sidecar prove the log is internally consistent and has not SHRUNK since
the trusted writer last ran. They do not, by themselves, stop an attacker who can
rewrite BOTH the log AND the sidecar from re-chaining a forged history, nor does the
fallback bootstrap tolerance survive an attacker who simply deletes the sidecar. The
real prevention layer is the deterministic hook, which blocks truncating, overwriting,
redirecting over, or editing `audit-log.jsonl` in place (the `auditAppendOnly`
always-on control). The sidecar is git-tracked precisely so that the anchor of last
resort is git history and code review: a forged rewrite must also rewrite a tracked file
and survive review.

## Tests

`npm run test:adg-audit-chain` (in `tooling/adg-as-code/test-adg-audit-chain.mjs`,
wired into `ci:governance`) proves a clean chain passes and that edit, delete, reorder,
and insert each hard-fail, plus the sidecar-only cases: (A) a strip-all-hashes content
forgery, (B) a chained-tip truncation, and (C) an edit to a frozen legacy event. All run
hermetically, without touching the real audit log.
