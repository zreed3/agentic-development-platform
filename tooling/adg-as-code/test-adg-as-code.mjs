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

function runResult(command) {
  try {
    return { status: 0, stdout: run(command), stderr: "" };
  } catch (error) {
    return {
      status: error.status ?? 1,
      stdout: String(error.stdout ?? ""),
      stderr: String(error.stderr ?? ""),
    };
  }
}

run("node scripts/adg-test-fixture.mjs demo-backlog");

const elicitationValidation = JSON.parse(run("node scripts/adg-elicitation.mjs validate --format json"));
assert.equal(elicitationValidation.valid, true);
assert.equal(elicitationValidation.features, 1);
assert.equal(elicitationValidation.hardGaps.length, 0);
assert.equal(elicitationValidation.sqlProjection.checked, false);

const elicitationCheck = JSON.parse(run("node scripts/adg-elicitation.mjs validate --format json --check"));
assert.equal(elicitationCheck.valid, true);
assert.equal(elicitationCheck.readOnly, true);
assert.equal(elicitationCheck.sqlProjection.valid, true);

const elicitationToon = run("node scripts/adg-elicitation.mjs packet --feature S07 --format toon");
assert.match(elicitationToon, /experienceContracts\[/u);
assert.match(elicitationToon, /journeyMatrix\[/u);
assert.match(elicitationToon, /S07-SCEN-HAPPY-01/u);
assert.match(elicitationToon, /S07-SCEN-SAD-01/u);
assert.match(elicitationToon, /primaryAction/u);
assert.match(elicitationToon, /fallbackAction/u);

const elicitationGraph = JSON.parse(run("node scripts/adg-elicitation.mjs graph --feature S07 --format json"));
assert.equal(elicitationGraph.valid, true);
assert.equal(elicitationGraph.summary.danglingEdges, 0);
assert.ok(elicitationGraph.nodes.some((node) => node.type === "requirement"));
assert.ok(elicitationGraph.edges.some((edge) => edge.type === "requirement_to_contract"));

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
assert.match(maturityToon, /requirements_to_ux_lineage/u);

const skillValidation = JSON.parse(run("node scripts/adg-skills.mjs validate"));
assert.equal(skillValidation.valid, true);
assert.ok(skillValidation.skills >= 10);

const contextPacket = JSON.parse(run("node scripts/agent-context.mjs feature --feature S07 --workflow agentic-tooling --format json --no-manifest"));
assert.equal(contextPacket.elicitation.status, "ready");
assert.ok(contextPacket.elicitation.experienceContracts.length > 0);
assert.ok(contextPacket.elicitation.journeyMatrix.some((row) => row.outcome === "recovery"));

const contextSlice = JSON.parse(run("node scripts/adg-context.mjs slice --feature S07 --workflow agentic-tooling --format json"));
assert.equal(contextSlice.valid, true);
assert.equal(contextSlice.efficiency.forbiddenNamed.length, 0);
assert.ok(contextSlice.efficiency.nextFileCount < contextSlice.efficiency.repoFileCount);

const uxValidation = JSON.parse(run("node scripts/adg-ux.mjs validate --feature S07 --format json"));
assert.equal(uxValidation.valid, true);
assert.equal(uxValidation.summary.contracts, 1);
assert.equal(uxValidation.readOnly, true);
assert.equal(uxValidation.validationClasses.structural.valid, true);
assert.equal(uxValidation.validationClasses.substantive.valid, true);

const truthPass = JSON.parse(run("node scripts/adg-ux.mjs truth-pass --feature S07 --format json --check"));
assert.equal(truthPass.valid, true);
assert.equal(truthPass.kind, "adg-truth-pass-report");
assert.ok(truthPass.featureResults[0].journeyMatrix.every((row) => row.primaryAction && row.fallbackAction));

const truthPassMarkdown = run("node scripts/adg-ux.mjs truth-pass --feature S07 --format markdown --check");
assert.match(truthPassMarkdown, /Route \/ Persona Journey Matrix/u);

const downgradeReport = JSON.parse(run("node scripts/adg-ux.mjs downgrade --feature S07 --format json"));
assert.equal(downgradeReport.kind, "adg-truth-pass-report");
assert.ok(Array.isArray(downgradeReport.downgradeRecommendations));

const genericConfig = structuredClone(config);
genericConfig.features[0].experienceContracts = [
  {
    ...genericConfig.features[0].experienceContracts[0],
    id: "S07-XC-GENERIC-ROUTE",
    surface: "route:/dashboard",
    scenarioIds: ["S07-SCEN-HAPPY-01", "S07-SCEN-SAD-01", "S07-SCEN-DENY-01", "S07-SCEN-RECOVERY-01"],
  },
];
genericConfig.features[0].scenarios = genericConfig.features[0].scenarios.map((scenario) => ({
  ...scenario,
  contractId: "S07-XC-GENERIC-ROUTE",
}));
genericConfig.features[0].journeyMatrix = [
  {
    id: "S07-JM-LIVE-OWNER",
    contractId: "S07-XC-GENERIC-ROUTE",
    routePattern: "/dashboard",
    persona: "owner",
    role: "owner",
    expectedState: "live",
    outcome: "happy",
    primaryAction: "Open dashboard",
    fallbackAction: "Show support action",
    expectedExperience: "Owner can use the live dashboard.",
    testEvidence: "npm run smoke:dashboard -- --persona owner --route /dashboard",
  },
  {
    id: "S07-JM-LIVE-STAFF",
    contractId: "S07-XC-GENERIC-ROUTE",
    routePattern: "/dashboard",
    persona: "staff",
    role: "staff",
    expectedState: "live",
    outcome: "happy",
    primaryAction: "Open dashboard",
    fallbackAction: "Show support action",
    expectedExperience: "Staff can use the live dashboard.",
    testEvidence: "npm run smoke:dashboard -- --persona staff --route /dashboard",
  },
  {
    id: "S07-JM-DENIED",
    contractId: "S07-XC-GENERIC-ROUTE",
    routePattern: "/dashboard",
    persona: "anonymous",
    role: "anonymous",
    expectedState: "forbidden",
    outcome: "denial",
    primaryAction: "Open dashboard",
    fallbackAction: "Show sign-in action",
    expectedExperience: "Anonymous visitors are denied.",
    testEvidence: "npm run smoke:dashboard -- --persona anonymous --route /dashboard",
  },
  {
    id: "S07-JM-RECOVERY",
    contractId: "S07-XC-GENERIC-ROUTE",
    routePattern: "/dashboard",
    persona: "owner",
    role: "owner",
    expectedState: "error",
    outcome: "recovery",
    primaryAction: "Retry dashboard",
    fallbackAction: "Show support action",
    expectedExperience: "Owner can recover from an error.",
    testEvidence: "npm run smoke:dashboard -- --persona owner --route /dashboard --state error",
  },
  {
    id: "S07-JM-EMPTY",
    contractId: "S07-XC-GENERIC-ROUTE",
    routePattern: "/dashboard",
    persona: "manager",
    role: "manager",
    expectedState: "empty",
    outcome: "sad",
    primaryAction: "Open dashboard",
    fallbackAction: "Create first record",
    expectedExperience: "Manager sees an empty state.",
    testEvidence: "npm run smoke:dashboard -- --persona manager --route /dashboard --state empty",
  },
];
const genericConfigPath = path.join(tempDir, "generic-route.json");
fs.writeFileSync(genericConfigPath, `${JSON.stringify(genericConfig, null, 2)}\n`);
const genericValidation = runResult(`node scripts/adg-ux.mjs validate --config ${JSON.stringify(genericConfigPath)} --feature S07 --format json`);
assert.notEqual(genericValidation.status, 0);
assert.match(genericValidation.stdout, /one generic route contract covers/u);

const standardsValidation = JSON.parse(run("node scripts/adg-standards.mjs validate --format json"));
assert.equal(standardsValidation.valid, true);
assert.ok(standardsValidation.summary.controls >= 6);

const deliverableAudit = JSON.parse(run("node scripts/adg-deliverable.mjs audit --format json"));
assert.equal(deliverableAudit.valid, true);
assert.ok(deliverableAudit.records >= 1);

const tempDeliverableLog = path.join(tempDir, "deliverables.jsonl");
const deliverableRecord = JSON.parse(run(`node scripts/adg-deliverable.mjs record --log ${JSON.stringify(tempDeliverableLog)} --id DEL-TEST-S07 --feature S07 --summary ${JSON.stringify("Test deliverable")} --node feature:S07 --edge ${JSON.stringify("feature_to_story:feature:S07->user_story:S07-STORY-01")} --requirement S07-FR-H-01 --contract S07-XC-01 --role agent:owner --input config/agentic/elicitation.json --file scripts/adg-elicitation.mjs --test ${JSON.stringify("npm run test:adg-as-code")} --decision ${JSON.stringify("Keep deterministic governance outside runtime")} --evidence config/agentic/deliverables.json`));
assert.equal(deliverableRecord.valid, true);
const deliverableTempAudit = JSON.parse(run(`node scripts/adg-deliverable.mjs audit --config ${JSON.stringify("config/agentic/deliverables.json")} --log ${JSON.stringify(tempDeliverableLog)}`));
assert.equal(deliverableTempAudit.valid, true);

const pluginValidation = JSON.parse(run("node scripts/adg-plugin.mjs validate"));
assert.equal(pluginValidation.valid, true);
assert.ok(pluginValidation.skills >= 3);

console.log("ADG as-code checks passed");
