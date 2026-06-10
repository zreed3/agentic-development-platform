#!/usr/bin/env node
// F-A evidence-tier release gate test.
//
// Proves the v0.9.1 F2 fix end to end: a claim in a declared-sensitive release
// class (a feature labelled `release-class:*`) cannot be signed off on
// config/test evidence alone -- it requires a `live` evidence_tier event. This is
// the exact false-confidence failure the field report documents (a deploy task
// marked "verified" on Terraform config while production told a different story).
//
// The test drives the real CLIs against a throwaway fixture seed, then restores
// the demo database so the working tree is left as the worked example.
//
// Run: npm run test:backlog-evidence-gate

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const backlog = "scripts/backlog-db.mjs";

function run(args, { expectOk = true } = {}) {
  const result = spawnSync(process.execPath, [backlog, ...args], {
    cwd: root,
    encoding: "utf8",
    shell: false,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (expectOk && result.status !== 0) {
    throw new Error(`Expected \`${backlog} ${args.join(" ")}\` to succeed but it exited ${result.status}.\n${result.stdout}\n${result.stderr}`);
  }
  return result;
}

function validate() {
  const result = run(["validate"], { expectOk: false });
  let payload = {};
  try {
    payload = JSON.parse(result.stdout);
  } catch {
    throw new Error(`backlog validate did not emit JSON.\n${result.stdout}\n${result.stderr}`);
  }
  return { status: result.status, payload };
}

function violationItems(payload) {
  return (payload.releaseGate?.violations ?? []).map((row) => row.item_id);
}

// A two-feature fixture: one declared-sensitive (data-residency), one plain control.
const fixture = {
  metadata: { initiative: "F-A evidence-tier gate test", source: "test-fixture" },
  labels: ["release-class:data-residency", "docs"],
  epics: [{ id: "EPIC-TEST", name: "Evidence Gate Test", summary: "Fixture for the release gate.", labels: [] }],
  features: [
    {
      id: "SENS",
      epicId: "EPIC-TEST",
      title: "Pin serverless functions to the Sydney region (data residency)",
      releaseBand: "P0",
      labels: ["release-class:data-residency"],
      tasks: ["Pin serverless functions to syd1, co-located with the database"],
      testCases: ["Functions are observed executing in syd1"],
    },
    {
      id: "CTRL",
      epicId: "EPIC-TEST",
      title: "Plain documentation page (control, not sensitive)",
      releaseBand: "P2",
      labels: ["docs"],
      tasks: ["Write the setup page"],
      testCases: ["Page renders"],
    },
  ],
};

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "adg-evidence-gate-"));
const seedPath = path.join(tmpDir, "evidence-gate.seed.json");
fs.writeFileSync(seedPath, JSON.stringify(fixture, null, 2), "utf8");
// Pass the absolute tmp path straight to --seed. This doubles as a regression
// guard for abs() in backlog-db.mjs, which must honour an absolute --seed rather
// than re-rooting it under the repo (the resolution bug this test once worked around).
const seedArg = seedPath;

// A second fixture: a feature declaring a non-canonical release class. validate must
// flag it as a misconfiguration rather than silently accept it.
const unknownFixture = {
  metadata: { initiative: "F-A unknown release-class test", source: "test-fixture" },
  labels: ["release-class:made-up"],
  epics: [{ id: "EPIC-UNK", name: "Unknown class", summary: "Fixture.", labels: [] }],
  features: [
    {
      id: "UNK",
      epicId: "EPIC-UNK",
      title: "Feature declaring a non-canonical release class",
      releaseBand: "P2",
      labels: ["release-class:made-up"],
      tasks: ["Do the thing"],
      testCases: ["It works"],
    },
  ],
};
const unknownSeedPath = path.join(tmpDir, "unknown-class.seed.json");
fs.writeFileSync(unknownSeedPath, JSON.stringify(unknownFixture, null, 2), "utf8");
// Absolute path again, exercising abs()'s absolute-path handling.
const unknownSeedArg = unknownSeedPath;

let passed = 0;
function ok(label) {
  passed += 1;
  console.log(`  ok ${label}`);
}

try {
  run(["setup", "--seed", seedArg]);
  ok("fixture database builds from the seed");

  // 1. Sign off the sensitive item on config evidence only -> gate must block.
  run(["verify", "--item", "SENS-TASK-01", "--summary", "Terraform declares syd1", "--evidence", "infra/main.tf", "--tier", "config"]);
  // A control item signed off on test evidence -- must NOT be gated (not sensitive).
  run(["verify", "--item", "CTRL-TASK-01", "--summary", "Setup page renders", "--evidence", "npm run docs:render", "--tier", "test"]);

  const blocked = validate();
  assert.equal(blocked.status, 1, "backlog:validate must fail while a sensitive item is verified on config evidence");
  assert.equal(blocked.payload.valid, false, "validate payload must report valid:false");
  const blockedItems = violationItems(blocked.payload);
  assert.ok(blockedItems.includes("SENS-TASK-01"), `expected SENS-TASK-01 in violations, got ${JSON.stringify(blockedItems)}`);
  assert.ok(!blockedItems.includes("CTRL-TASK-01"), "the non-sensitive control item must never be a release-gate violation");
  ok("config-tier sign-off on a sensitive class is blocked; control item is not flagged");

  // 2. Record a live-tier event for the sensitive item -> gate must clear.
  run(["verify", "--item", "SENS-TASK-01", "--summary", "Production HAR shows syd1 execution region", "--evidence", "har/prod-syd1.har", "--tier", "live"]);

  const cleared = validate();
  assert.equal(cleared.status, 0, "backlog:validate must pass once a live evidence event exists for the sensitive item");
  assert.equal(cleared.payload.valid, true, "validate payload must report valid:true after live evidence");
  assert.deepEqual(violationItems(cleared.payload), [], "there must be no release-gate violations after live evidence");
  ok("a live-tier event clears the release gate");

  // 3. An invalid tier is rejected outright (enum guard).
  const badTier = run(["verify", "--item", "SENS-TASK-01", "--summary", "bogus", "--tier", "guess"], { expectOk: false });
  assert.notEqual(badTier.status, 0, "an invalid --tier must be rejected");
  assert.match(`${badTier.stdout}${badTier.stderr}`, /Invalid --tier/, "the error must explain the invalid tier");
  ok("an unknown evidence tier is rejected");

  // 4. A non-canonical release-class label is reported by validate as a misconfiguration.
  run(["setup", "--seed", unknownSeedArg]);
  const unknown = validate();
  assert.equal(unknown.status, 1, "validate must fail when a feature declares a non-canonical release class");
  assert.ok(
    (unknown.payload.releaseGate?.unknownReleaseClasses ?? []).includes("made-up"),
    `validate must name the unknown release class, got ${JSON.stringify(unknown.payload.releaseGate?.unknownReleaseClasses)}`,
  );
  ok("a non-canonical release-class label is flagged by validate");

  console.log(`\nevidence-tier gate: ${passed} checks passed`);
} finally {
  // Restore the demo database so the working tree is left as the worked example,
  // and clean up the fixture seed.
  spawnSync(process.execPath, [backlog, "setup", "--seed", "data/seed/backlog.demo.seed.json", "--with-audit"], {
    cwd: root,
    encoding: "utf8",
    shell: false,
    maxBuffer: 16 * 1024 * 1024,
  });
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
