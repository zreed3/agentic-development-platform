import assert from "node:assert/strict";
import { execSync } from "node:child_process";

function run(command) {
  return execSync(command, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    shell: "/bin/zsh",
  });
}

run("node scripts/adg-test-fixture.mjs demo-backlog");

const jsonOutput = run("node scripts/agent-context.mjs feature --feature S07 --workflow route --format json --no-manifest");
const packet = JSON.parse(jsonOutput);

assert.equal(packet.kind, "context-packet");
assert.equal(packet.feature.id, "S07");
assert.equal(packet.workflow, "route");
assert.ok(Array.isArray(packet.nextFiles));
assert.ok(packet.forbiddenBulkFiles.includes("data/backlog-source.sql"));
assert.ok(!packet.nextFiles.some((file) => file.path === "data/backlog-source.sql"));
assert.ok(packet.nextFiles.length <= packet.profile.maxFiles, "packet must stay within the file cap");
assert.ok(packet.profile.deliveryFlow.some((step) => step.startsWith("Plan:")), "packet should carry the delivery flow");
assert.ok(packet.profile.verificationPolicy.some((policy) => policy.includes("backlog:fail")), "packet should carry failed-result policy");

const toonOutput = run("node scripts/agent-context.mjs item --item S07-TASK-01 --workflow route --format toon --no-manifest");
assert.match(toonOutput, /context:/u);
assert.match(toonOutput, /backlogItems\[/u);
assert.match(toonOutput, /routes\[/u);
assert.match(toonOutput, /deliveryFlow\[/u);

const sliceOutput = run("node scripts/agent-context.mjs feature --feature S07 --workflow delivery-slice --format json --no-manifest");
const slicePacket = JSON.parse(sliceOutput);
assert.equal(slicePacket.workflow, "delivery-slice");
assert.ok(slicePacket.profile.maxFiles <= 6, "delivery-slice should keep a tighter file cap");

run("node scripts/agent-context.mjs feature --feature S07 --workflow route --format json > /dev/null");
const auditOutput = run("node scripts/agent-context.mjs audit");
const audit = JSON.parse(auditOutput);
assert.equal(audit.valid, true);

console.log("agent context tooling checks passed");
