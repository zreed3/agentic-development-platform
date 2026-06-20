#!/usr/bin/env node
// Negative tests for the append-only audit-log rolling hash chain.
// Proves: a clean chain passes; an edited, deleted, reordered, or inserted event in
// the chained region is a HARD FAIL; legacy pre-chain events are tolerated; the first
// chained event chains from the GENESIS sentinel; and -- via the chain-state sidecar
// (high-water mark) -- that a strip-all-hashes content forgery (A), a chained-tip
// truncation (B), and a frozen-legacy-prefix edit (C) are HARD FAILs that the chain
// alone could not catch.
//
// Hermetic: uses ADG_AUDIT_LOG_PATH (temp log) for both record and validate; never
// touches the real audit log. writeLines() rewrites ONLY the log, leaving the sidecar
// intact, which is the whole point: the sidecar is the out-of-band high-water mark a
// log-only rewrite cannot reach. reset() clears both for a genuine fresh start.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GENESIS, chainStatePath } from "../../scripts/audit-chain.mjs";

const root = process.cwd();
const REC = path.join(root, "scripts/record-audit.mjs");
const VAL = path.join(root, "scripts/validate-audit.mjs");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "adg-chain-"));
const log = path.join(tmp, "audit-log.jsonl");
const state = chainStatePath(log);

function record(summary) {
  spawnSync(process.execPath, [REC, "--type", "comment", "--summary", summary], { encoding: "utf8", env: { ...process.env, ADG_AUDIT_LOG_PATH: log } });
}
function validate() {
  const res = spawnSync(process.execPath, [VAL], { encoding: "utf8", env: { ...process.env, ADG_AUDIT_LOG_PATH: log } });
  let json = {};
  try { json = JSON.parse(res.stdout); } catch { /* leave empty */ }
  return { code: res.status, json };
}
function lines() { return fs.readFileSync(log, "utf8").trim().split("\n"); }
function writeLines(ls) { fs.writeFileSync(log, ls.join("\n") + "\n"); } // log only -- never the sidecar
function reset() { fs.rmSync(state, { force: true }); fs.writeFileSync(log, ""); } // genuine fresh start: clears the high-water mark too
function freshThree() { reset(); record("event 1"); record("event 2"); record("event 3"); }

let passed = 0;
function check(label, cond) { assert.ok(cond, label); passed += 1; }

// 1. clean chain passes, first prevHash is GENESIS
freshThree();
const first = JSON.parse(lines()[0]);
check("first chained event chains from the GENESIS sentinel", first.prevHash === GENESIS);
const clean = validate();
check("clean 3-event chain validates (exit 0)", clean.code === 0 && clean.json.valid === true && clean.json.chained === 3);

// 2. edit a middle event -> hard FAIL (hash mismatch)
freshThree();
let ls = lines();
const e = JSON.parse(ls[1]); e.summary = "TAMPERED"; ls[1] = JSON.stringify(e); writeLines(ls);
let r = validate();
check("editing a chained event is a hard FAIL", r.code === 1 && r.json.valid === false);

// 3. delete a middle event -> hard FAIL
freshThree();
ls = lines(); ls.splice(1, 1); writeLines(ls);
r = validate();
check("deleting a chained event is a hard FAIL", r.code === 1 && r.json.valid === false);

// 4. reorder two events -> hard FAIL
freshThree();
ls = lines(); [ls[1], ls[2]] = [ls[2], ls[1]]; writeLines(ls);
r = validate();
check("reordering chained events is a hard FAIL", r.code === 1 && r.json.valid === false);

// 5. insert a foreign chainless event into the chained region -> hard FAIL
freshThree();
ls = lines();
ls.splice(2, 0, JSON.stringify({ id: "AUD-FORGED", occurredAt: "2026-06-15T00:00:00.000Z", eventType: "comment", summary: "forged" }));
writeLines(ls);
r = validate();
check("inserting a chainless event into the chained region is a hard FAIL", r.code === 1 && r.json.valid === false);

// 6. legacy pre-chain events are tolerated, chain validates from the first chained event
reset();
fs.appendFileSync(log, JSON.stringify({ id: "AUD-LEGACY-1", occurredAt: "2026-06-01T00:00:00.000Z", eventType: "comment", summary: "legacy 1" }) + "\n");
fs.appendFileSync(log, JSON.stringify({ id: "AUD-LEGACY-2", occurredAt: "2026-06-02T00:00:00.000Z", eventType: "comment", summary: "legacy 2" }) + "\n");
record("first chained after legacy");
record("second chained after legacy");
const mixed = validate();
check("legacy pre-chain events are tolerated and the chain validates", mixed.code === 0 && mixed.json.valid === true && mixed.json.chained === 2);
const firstChained = lines().map((l) => JSON.parse(l)).find((ev) => ev.hash);
check("first chained event after legacy still starts from GENESIS", firstChained.prevHash === GENESIS);

// 7. (A) strip-all-hashes content forgery -> hard FAIL via the high-water mark.
//    This is the laundering path the chain alone misses: edit a chained event's content
//    AND delete hash/prevHash on every line, so verifyChain reclassifies them as
//    tolerated legacy events. The sidecar still records 3 chained events, so the drop
//    to 0 is a hard FAIL.
freshThree();
ls = lines().map((l) => { const e = JSON.parse(l); e.summary = "FORGED"; delete e.hash; delete e.prevHash; return JSON.stringify(e); });
writeLines(ls);
r = validate();
check("(A) strip-all-hashes content forgery is a hard FAIL (high-water mark)", r.code === 1 && r.json.valid === false);
check("(A) the forged log would have passed verifyChain alone (0 chained survive)", r.json.chained === 0);
// Honesty check: deleting the sidecar too drops to bootstrap tolerance (the documented
// trust boundary -- the sidecar is git-tracked precisely so a reviewer/git is the anchor).
fs.rmSync(state, { force: true });
check("(A) without the sidecar the stripped log bootstraps (documented trust boundary)", validate().code === 0);

// 8. (B) truncate the chained tip -> hard FAIL via the high-water mark.
//    Dropping the last chained line leaves a shorter but internally-consistent chain,
//    which verifyChain accepts; the sidecar (still 3) catches the regression to 2.
freshThree();
ls = lines(); ls.pop(); writeLines(ls);
r = validate();
check("(B) truncating the chained tip is a hard FAIL (high-water mark)", r.code === 1 && r.json.valid === false && r.json.chained === 2);

// 9. (C) edit a frozen legacy (pre-chain) event -> hard FAIL via the legacy digest.
//    Once the chain starts, the legacy prefix is frozen into the sidecar's digest; an
//    edit that leaves the chain itself intact is still caught.
reset();
fs.appendFileSync(log, JSON.stringify({ id: "AUD-LEG-A", occurredAt: "2026-06-01T00:00:00.000Z", eventType: "comment", summary: "legacy A" }) + "\n");
record("chained after legacy A");
ls = lines(); const leg = JSON.parse(ls[0]); leg.summary = "LEGACY-TAMPERED"; ls[0] = JSON.stringify(leg); writeLines(ls);
r = validate();
check("(C) editing a frozen legacy pre-chain event is a hard FAIL (legacy digest)", r.code === 1 && r.json.valid === false);

// 10. re-validating a clean chain with the sidecar present is idempotent (no false fail).
freshThree();
check("clean chain validates twice with the sidecar present (idempotent)", validate().code === 0 && validate().code === 0);
const enforced = validate();
check("validation reports the high-water mark is enforced once a sidecar exists", enforced.json.chainStateEnforced === true);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`adg-audit-chain: ${passed}/${passed} tamper-evidence checks OK`);
