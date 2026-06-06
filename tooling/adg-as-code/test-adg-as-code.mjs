import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function run(command) {
  return execSync(command, {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    shell: "/bin/zsh",
  });
}

const elicitationValidation = JSON.parse(run("node scripts/adg-elicitation.mjs validate --format json"));
assert.equal(elicitationValidation.valid, true);
assert.equal(elicitationValidation.features, 1);
assert.equal(elicitationValidation.hardGaps.length, 0);

const elicitationToon = run("node scripts/adg-elicitation.mjs packet --feature S07 --format toon");
assert.match(elicitationToon, /experienceContracts\[/u);
assert.match(elicitationToon, /journeyMatrix\[/u);
assert.match(elicitationToon, /S07-SCEN-HAPPY-01/u);
assert.match(elicitationToon, /S07-SCEN-SAD-01/u);

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "adg-elicitation-"));
const partialConfigPath = path.join(tempDir, "partial.json");
const config = JSON.parse(fs.readFileSync("config/agentic/elicitation.json", "utf8"));
const partial = structuredClone(config);
partial.features[0].functionalRequirements = partial.features[0].functionalRequirements.filter((row) => row.level !== "low");
partial.features[0].antiSuccessCriteria = [];
partial.features[0].scenarios = partial.features[0].scenarios.filter((row) => row.outcome !== "sad");
const remainingRequirementIds = new Set(partial.features[0].functionalRequirements.map((row) => row.id));
const remainingScenarioIds = new Set(partial.features[0].scenarios.map((row) => row.id));
partial.features[0].successCriteria = partial.features[0].successCriteria.map((row) => ({
  ...row,
  requirementIds: row.requirementIds.filter((id) => remainingRequirementIds.has(id)),
}));
partial.features[0].experienceContracts = partial.features[0].experienceContracts.map((row) => ({
  ...row,
  requirementIds: row.requirementIds.filter((id) => remainingRequirementIds.has(id)),
  scenarioIds: row.scenarioIds.filter((id) => remainingScenarioIds.has(id)),
}));
fs.writeFileSync(partialConfigPath, `${JSON.stringify(partial, null, 2)}\n`);
const partialValidation = JSON.parse(run(`node scripts/adg-elicitation.mjs validate --config ${JSON.stringify(partialConfigPath)} --format json --no-sqlite`));
assert.equal(partialValidation.valid, true, "advisory elicitation gaps should not hard-fail validation");
assert.ok(partialValidation.advisoryGaps.some((gap) => /low-level functional requirements/u.test(gap.summary)));
assert.ok(partialValidation.advisoryGaps.some((gap) => /anti-success/u.test(gap.summary)));
assert.ok(partialValidation.advisoryGaps.some((gap) => /sad scenario/u.test(gap.summary)));

const maturityValidation = JSON.parse(run("node scripts/adg-maturity.mjs validate --format json"));
assert.equal(maturityValidation.valid, true);
assert.equal(maturityValidation.summary.belowTarget, 0);
assert.ok(maturityValidation.summary.minimumScore >= 4.5);

const maturityToon = run("node scripts/adg-maturity.mjs score --format toon");
assert.match(maturityToon, /feature_elicitation/u);
assert.match(maturityToon, /runtime_autonomy_readiness/u);

const skillValidation = JSON.parse(run("node scripts/adg-skills.mjs validate"));
assert.equal(skillValidation.valid, true);
assert.ok(skillValidation.skills >= 10);

const contextPacket = JSON.parse(run("node scripts/agent-context.mjs feature --feature S07 --workflow agentic-tooling --format json --no-manifest"));
assert.equal(contextPacket.elicitation.status, "ready");
assert.ok(contextPacket.elicitation.experienceContracts.length > 0);
assert.ok(contextPacket.elicitation.journeyMatrix.some((row) => row.outcome === "recovery"));

console.log("ADG as-code checks passed");
