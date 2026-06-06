#!/usr/bin/env node
// Validate the ADG governance plugin package and neutral manifest.

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const pluginRoot = "plugins/adg-codex-plugin";
const pluginManifest = `${pluginRoot}/.codex-plugin/plugin.json`;
const neutralManifest = `${pluginRoot}/agentic-plugin.manifest.json`;
const marketplacePath = `${pluginRoot}/.agents/plugins/marketplace.json`;

const requiredPackageFiles = [
  `${pluginRoot}/README.md`,
  `${pluginRoot}/LICENSE`,
  `${pluginRoot}/NOTICE`,
  `${pluginRoot}/.codex-plugin/plugin.json`,
  neutralManifest,
  marketplacePath,
  `${pluginRoot}/scripts/adg-context.mjs`,
  `${pluginRoot}/scripts/adg-deliverable.mjs`,
  `${pluginRoot}/scripts/adg-elicitation.mjs`,
  `${pluginRoot}/scripts/adg-standards.mjs`,
  `${pluginRoot}/scripts/adg-ux.mjs`,
  `${pluginRoot}/scripts/agent-context.mjs`,
  `${pluginRoot}/config/templates/agentic/context-profiles.yaml`,
  `${pluginRoot}/config/templates/agentic/deliverables.json`,
  `${pluginRoot}/config/templates/agentic/elicitation.json`,
  `${pluginRoot}/config/templates/agentic/standards-map.json`,
  `${pluginRoot}/config/templates/agentic/ux-as-code.json`,
];

function abs(file) {
  return path.join(root, file);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(abs(file), "utf8"));
}

function asArray(input) {
  return Array.isArray(input) ? input : [];
}

function parseFrontmatter(text) {
  if (!text.startsWith("---\n")) return {};
  const end = text.indexOf("\n---", 4);
  if (end === -1) return {};
  const fields = {};
  for (const line of text.slice(4, end).split(/\r?\n/u)) {
    const index = line.indexOf(":");
    if (index !== -1) fields[line.slice(0, index).trim()] = line.slice(index + 1).trim().replace(/^["']|["']$/gu, "");
  }
  return fields;
}

function validate() {
  const failures = [];
  const warnings = [];
  for (const file of requiredPackageFiles) {
    if (!fs.existsSync(abs(file))) failures.push(`missing ${file}`);
  }
  if (failures.length) return { valid: false, failures, warnings };
  const plugin = readJson(pluginManifest);
  const neutral = readJson(neutralManifest);
  const marketplace = readJson(marketplacePath);
  if (plugin.name !== "adg-codex-plugin") failures.push("plugin name must be adg-codex-plugin");
  if (plugin.version !== "0.3.0") failures.push("plugin version must be 0.3.0");
  if (plugin.skills !== "./skills/") failures.push("plugin skills path must be ./skills/");
  if (!plugin.repository || !String(plugin.repository).includes("zreed3/adg-codex-plugin")) failures.push("plugin repository must point to zreed3/adg-codex-plugin");
  if (!String(fs.readFileSync(abs(`${pluginRoot}/LICENSE`), "utf8")).includes("PolyForm Noncommercial License")) failures.push("plugin LICENSE must include PolyForm Noncommercial License");
  if (!String(fs.readFileSync(abs(`${pluginRoot}/NOTICE`), "utf8")).includes("Required Notice:")) failures.push("plugin NOTICE must include Required Notice");
  if (neutral.schemaVersion !== 1) failures.push("neutral manifest schemaVersion must be 1");
  if (neutral.name !== "adg-codex-plugin") failures.push("neutral manifest name must be adg-codex-plugin");
  for (const command of asArray(neutral.commands)) {
    if (!command.name || !command.command || !command.riskClass) failures.push(`${command.name ?? "UNKNOWN"}: command name, command, and riskClass are required`);
    if (command.workingDirectory !== "host-repo") failures.push(`${command.name}: workingDirectory must be host-repo`);
    const script = String(command.command).split(/\s+/u).find((part) => part.startsWith("./scripts/"));
    if (!script) failures.push(`${command.name}: command must reference a plugin-root ./scripts/ path`);
    else if (!fs.existsSync(abs(`${pluginRoot}/${script.slice(2)}`))) failures.push(`${command.name}: missing packaged ${script}`);
  }
  if (marketplace.name !== "adg-codex-plugin-marketplace") failures.push("marketplace name must be adg-codex-plugin-marketplace");
  const marketplaceEntry = asArray(marketplace.plugins).find((entry) => entry.name === "adg-codex-plugin");
  if (!marketplaceEntry) failures.push("marketplace must include adg-codex-plugin entry");
  else {
    if (marketplaceEntry.source?.source !== "url") failures.push("marketplace source must use url for the standalone repo");
    if (marketplaceEntry.source?.url !== "https://github.com/zreed3/adg-codex-plugin.git") failures.push("marketplace source url must point to zreed3/adg-codex-plugin");
    if (marketplaceEntry.policy?.installation !== "AVAILABLE") failures.push("marketplace installation policy must be AVAILABLE");
    if (marketplaceEntry.policy?.authentication !== "ON_INSTALL") failures.push("marketplace authentication policy must be ON_INSTALL");
    if (marketplaceEntry.category !== "Productivity") failures.push("marketplace category must be Productivity");
  }
  const skillFiles = fs.readdirSync(abs(`${pluginRoot}/skills`), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `${pluginRoot}/skills/${entry.name}/SKILL.md`);
  if (!skillFiles.length) failures.push("plugin must include at least one skill");
  for (const skillFile of skillFiles) {
    if (!fs.existsSync(abs(skillFile))) {
      failures.push(`missing ${skillFile}`);
      continue;
    }
    const text = fs.readFileSync(abs(skillFile), "utf8");
    const frontmatter = parseFrontmatter(text);
    if (!frontmatter.name || !frontmatter.description) failures.push(`${skillFile}: name and description frontmatter are required`);
    if (/bord\.room|bordroom|V4\.1|pnpm/u.test(text)) failures.push(`${skillFile}: plugin skills must be product-neutral`);
    if (/node scripts\//u.test(text)) failures.push(`${skillFile}: skill command references must not assume host root scripts`);
  }
  return {
    kind: "plugin-validation",
    generatedAt: new Date().toISOString(),
    valid: failures.length === 0,
    pluginRoot,
    skills: skillFiles.length,
    commands: asArray(neutral.commands).length,
    failures,
    warnings,
  };
}

const command = process.argv[2] ?? "help";
if (command !== "validate") {
  console.log("Usage: node scripts/adg-plugin.mjs validate");
  process.exit(command === "help" ? 0 : 1);
}
const result = validate();
console.log(JSON.stringify(result, null, 2));
if (!result.valid) process.exit(1);
