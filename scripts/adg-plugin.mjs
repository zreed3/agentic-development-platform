#!/usr/bin/env node
// Validate the ADG governance plugin package and neutral manifest.

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const pluginRoot = "plugins/adg-governance";
const pluginManifest = `${pluginRoot}/.codex-plugin/plugin.json`;
const neutralManifest = `${pluginRoot}/agentic-plugin.manifest.json`;

function abs(file) {
  return path.isAbsolute(file) ? file : path.join(root, file);
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
  for (const file of [pluginManifest, neutralManifest]) {
    if (!fs.existsSync(abs(file))) failures.push(`missing ${file}`);
  }
  if (failures.length) return { valid: false, failures, warnings };
  const plugin = readJson(pluginManifest);
  const neutral = readJson(neutralManifest);
  if (plugin.name !== "adg-governance") failures.push("plugin name must be adg-governance");
  if (plugin.skills !== "./skills/") failures.push("plugin skills path must be ./skills/");
  if (neutral.schemaVersion !== 1) failures.push("neutral manifest schemaVersion must be 1");
  for (const command of asArray(neutral.commands)) {
    if (!command.name || !command.command || !command.riskClass) failures.push(`${command.name ?? "UNKNOWN"}: command name, command, and riskClass are required`);
    const script = String(command.command).split(/\s+/u).find((part) => part.startsWith("scripts/"));
    if (script && !fs.existsSync(abs(script))) failures.push(`${command.name}: missing ${script}`);
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
