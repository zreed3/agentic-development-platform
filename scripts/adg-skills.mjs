#!/usr/bin/env node
// Validate generic ADG skill packages.

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const manifestPath = "config/agentic/skill-manifest.json";

function abs(file) {
  if (path.isAbsolute(file)) return file;
  return path.isAbsolute(file) ? file : path.join(root, file);
}

function parseArgs(argv) {
  return { command: argv[0] ?? "help" };
}

function readManifest() {
  return JSON.parse(fs.readFileSync(abs(manifestPath), "utf8"));
}

function parseFrontmatter(text) {
  if (!text.startsWith("---\n")) return {};
  const end = text.indexOf("\n---", 4);
  if (end === -1) return {};
  const frontmatter = text.slice(4, end).split(/\r?\n/u);
  const out = {};
  for (const line of frontmatter) {
    const index = line.indexOf(":");
    if (index === -1) continue;
    out[line.slice(0, index).trim()] = line.slice(index + 1).trim().replace(/^["']|["']$/gu, "");
  }
  return out;
}

function validate() {
  const manifest = readManifest();
  const failures = [];
  const warnings = [];
  if (manifest.schemaVersion !== 1) failures.push("schemaVersion must be 1");
  if (!Array.isArray(manifest.skills) || !manifest.skills.length) failures.push("skills array is required");
  const names = new Set();
  for (const skill of manifest.skills ?? []) {
    if (!skill.name) failures.push("skill name is required");
    if (!skill.path) failures.push(`${skill.name}: path is required`);
    if (names.has(skill.name)) failures.push(`duplicate skill ${skill.name}`);
    names.add(skill.name);
    if (!fs.existsSync(abs(skill.path))) {
      failures.push(`${skill.name}: missing ${skill.path}`);
      continue;
    }
    const text = fs.readFileSync(abs(skill.path), "utf8");
    const frontmatter = parseFrontmatter(text);
    if (frontmatter.name !== skill.name) failures.push(`${skill.name}: frontmatter name must match manifest`);
    if (!frontmatter.description) failures.push(`${skill.name}: description is required`);
    if (text.length > Number(manifest.maxSkillBytes ?? 5000)) failures.push(`${skill.name}: exceeds ${manifest.maxSkillBytes} bytes`);
    for (const term of manifest.forbiddenTerms ?? []) {
      if (text.toLowerCase().includes(String(term).toLowerCase())) failures.push(`${skill.name}: contains forbidden product-specific term "${term}"`);
    }
  }
  for (const retired of manifest.retiredSkills ?? []) {
    if (fs.existsSync(abs(`skills/${retired}/SKILL.md`))) failures.push(`retired skill still exists: skills/${retired}/SKILL.md`);
  }
  return {
    manifestPath,
    valid: failures.length === 0,
    skills: manifest.skills?.length ?? 0,
    retiredSkills: manifest.retiredSkills?.length ?? 0,
    failures,
    warnings,
  };
}

const args = parseArgs(process.argv.slice(2));
if (args.command !== "validate") {
  console.log("Usage: node scripts/adg-skills.mjs validate");
  process.exit(args.command === "help" ? 0 : 1);
}

const result = validate();
console.log(JSON.stringify(result, null, 2));
if (!result.valid) process.exit(1);
