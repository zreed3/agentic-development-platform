#!/usr/bin/env node
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const failures = [];

function fail(message) {
  failures.push(message);
}

function mustExist(relativePath) {
  const fullPath = path.join(root, relativePath);
  if (!existsSync(fullPath)) {
    fail(`Missing ${relativePath}`);
  }
}

const manifestPath = path.join(root, "methodology-manifest.json");
if (!existsSync(manifestPath)) {
  fail("Missing methodology-manifest.json");
} else {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest.schema !== "bordroom.methodology.bundle.v1") {
    fail("methodology-manifest.json schema must be bordroom.methodology.bundle.v1");
  }
  for (const entry of manifest.copied_sources ?? []) {
    mustExist(entry.target);
  }
}

for (const required of [
  "MANIFEST.md",
  "dev-system/index.html",
  "dev-system/system.json",
  "dev-system/validate-system.mjs",
  "repo-lite-skills/bordroom-lite-build-runner/SKILL.md",
  "repo-lite-skills/bordroom-lite-traceability/SKILL.md",
  "docs/agentic-application-development-pipeline.md",
  "documents-for-review/v4-1-agentic-development-strategy-lite.md",
  "config/agentic/context-profiles.yaml",
  "config/agentic/guardrails.json",
  "root/AGENTS.md"
]) {
  mustExist(required);
}

const skillFiles = execSync("find dev-system/skills -name SKILL.md | wc -l", {
  cwd: root,
  encoding: "utf8"
}).trim();
if (skillFiles !== "14") {
  fail(`Expected 14 dev-system skills, found ${skillFiles}`);
}

try {
  execSync(`${JSON.stringify(process.execPath)} dev-system/validate-system.mjs`, {
    cwd: root,
    stdio: "inherit"
  });
} catch {
  fail("Copied dev-system validator failed");
}

if (failures.length > 0) {
  console.error(failures.map((message) => `FAIL ${message}`).join("\n"));
  process.exit(1);
}

console.log("methodology bundle validated");
