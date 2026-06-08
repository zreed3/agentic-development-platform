import assert from "node:assert/strict";
import { execSync } from "node:child_process";

function run(command) {
  return execSync(command, {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
    shell: "/bin/zsh",
  });
}

function classify(args) {
  return JSON.parse(run(`node scripts/adg-work-classify.mjs classify --format json ${args}`));
}

assert.equal(classify('--intent "explore why the dashboard spacing is odd"').laneId, "L0");
assert.equal(classify('--intent "quick css spacing fix" --file docs/setup.html').laneId, "L1");
assert.equal(classify('--intent "add normal feature behavior" --file scripts/agent-context.mjs').laneId, "L2");
assert.equal(classify('--intent "change auth tenant permission" --file src/auth.ts').laneId, "L3");
assert.equal(classify('--intent "release signoff for RC"').laneId, "L4");

const toon = run('node scripts/adg-work-classify.mjs classify --intent "tiny docs typo" --file README.md');
assert.match(toon, /lane: L1 quick-fix/u);
assert.match(toon, /checks\[/u);

console.log("delivery lane classifier checks passed");
