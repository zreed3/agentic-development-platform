import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "adg-install-"));

function run(args, cwd = root) {
  return execFileSync(process.execPath, ["scripts/adg-install.mjs", ...args], {
    cwd,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
}

fs.writeFileSync(path.join(tempRoot, "package.json"), `${JSON.stringify({ name: "host", scripts: {} }, null, 2)}\n`);

const install = JSON.parse(run(["install", "--target", tempRoot, "--format", "json"]));
assert.equal(install.version, "0.4.0");
assert.ok(fs.existsSync(path.join(tempRoot, "config/agentic/delivery-lanes.json")));
assert.ok(fs.existsSync(path.join(tempRoot, "scripts/adg-work-classify.mjs")));
assert.ok(fs.existsSync(path.join(tempRoot, "docs/adg/proofline-delivery-lanes.md")));
assert.ok(fs.existsSync(path.join(tempRoot, "config/agentic/adg-install-state.json")));

const pkg = JSON.parse(fs.readFileSync(path.join(tempRoot, "package.json"), "utf8"));
assert.equal(pkg.scripts["adg:classify"], "node scripts/adg-work-classify.mjs classify");
assert.equal(pkg.scripts["adg:guard"], "node scripts/adg-work-classify.mjs guard");

const classify = execFileSync(process.execPath, [
  "scripts/adg-work-classify.mjs",
  "classify",
  "--format",
  "json",
  "--intent",
  "quick docs typo",
  "--file",
  "README.md",
], { cwd: tempRoot, encoding: "utf8" });
assert.equal(JSON.parse(classify).laneId, "L1");

fs.writeFileSync(path.join(tempRoot, "scripts/adg-work-classify.mjs"), "changed\n");
const update = JSON.parse(run(["update", "--target", tempRoot, "--format", "json"]));
assert.ok(update.backups.some((backup) => backup.target === "scripts/adg-work-classify.mjs"));

const status = JSON.parse(run(["status", "--target", tempRoot, "--format", "json"]));
assert.equal(status.files.every((file) => file.status === "current"), true);

fs.rmSync(tempRoot, { recursive: true, force: true });
console.log("ADG install/update checks passed");
