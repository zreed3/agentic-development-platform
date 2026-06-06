#!/usr/bin/env node
// Vendor the canonical ADG core snapshot into the standalone Codex plugin.

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const pluginRoot = "plugins/adg-codex-plugin";

const scriptFiles = [
  "agent-context.mjs",
  "adg-context.mjs",
  "adg-deliverable.mjs",
  "adg-elicitation.mjs",
  "adg-standards.mjs",
  "adg-ux.mjs",
];

const configTemplates = [
  "context-profiles.yaml",
  "deliverables.json",
  "elicitation.json",
  "standards-map.json",
  "ux-as-code.json",
];

function abs(file) {
  return path.join(root, file);
}

function copyFile(source, target) {
  fs.mkdirSync(path.dirname(abs(target)), { recursive: true });
  fs.copyFileSync(abs(source), abs(target));
}

function writeNotice() {
  fs.writeFileSync(abs(`${pluginRoot}/NOTICE`), [
    "ADG Codex Plugin",
    "",
    "Required Notice: Copyright (c) 2026 Otterblock Pty Ltd (ABN 91 614 672 794)",
    "",
    "This package vendors a snapshot of the Agentic Development Governance core scripts",
    "for standalone Codex plugin distribution. Commercial rights are reserved by",
    "Otterblock Pty Ltd under the included license.",
    "",
  ].join("\n"), "utf8");
}

function main() {
  if (!fs.existsSync(abs(`${pluginRoot}/.codex-plugin/plugin.json`))) {
    throw new Error(`Missing plugin manifest at ${pluginRoot}/.codex-plugin/plugin.json`);
  }

  for (const file of scriptFiles) {
    copyFile(`scripts/${file}`, `${pluginRoot}/scripts/${file}`);
  }
  for (const file of configTemplates) {
    copyFile(`config/agentic/${file}`, `${pluginRoot}/config/templates/agentic/${file}`);
  }
  copyFile("LICENSE", `${pluginRoot}/LICENSE`);
  writeNotice();

  console.log(JSON.stringify({
    kind: "codex-plugin-package",
    valid: true,
    pluginRoot,
    scripts: scriptFiles.length,
    configTemplates: configTemplates.length,
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
