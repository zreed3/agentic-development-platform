#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const failures = [];
const warnings = [];

function fail(message) {
  failures.push(message);
}

function warn(message) {
  warnings.push(message);
}

function readJson(relativePath) {
  const fullPath = path.join(root, relativePath);
  if (!existsSync(fullPath)) {
    fail(`Missing ${relativePath}`);
    return null;
  }
  try {
    return JSON.parse(readFileSync(fullPath, "utf8"));
  } catch (error) {
    fail(`Invalid JSON in ${relativePath}: ${error.message}`);
    return null;
  }
}

const system = readJson("system.json");

if (system) {
  if (system.schema !== "bordroom.system.v1") {
    fail("system.json schema must be bordroom.system.v1");
  }

  if (!Array.isArray(system.functions) || system.functions.length === 0) {
    fail("system.json must declare at least one function");
  }

  const skillNames = new Set();

  for (const fn of system.functions ?? []) {
    if (!fn.id || !fn.skill || !fn.purpose) {
      fail(`Function is missing id, skill, or purpose: ${JSON.stringify(fn)}`);
      continue;
    }

    if (skillNames.has(fn.skill)) {
      fail(`Duplicate skill name ${fn.skill}`);
    }
    skillNames.add(fn.skill);

    const skillPath = path.join(root, "skills", fn.skill, "SKILL.md");
    if (!existsSync(skillPath)) {
      fail(`Missing skill file for ${fn.id}: skills/${fn.skill}/SKILL.md`);
      continue;
    }

    const skillText = readFileSync(skillPath, "utf8");
    if (!skillText.startsWith("---\n")) {
      fail(`${fn.skill} must start with YAML frontmatter`);
    }
    if (!new RegExp(`name:\\s*${fn.skill}\\b`).test(skillText)) {
      fail(`${fn.skill} frontmatter name must match system.json`);
    }
    if (!/description:\s*\S/.test(skillText)) {
      fail(`${fn.skill} must include a trigger-ready description`);
    }
    if (skillText.length > 5000) {
      fail(`${fn.skill} is too large for the token-optimized system`);
    }
    if (skillText.length > 3000) {
      warn(`${fn.skill} is over 3000 characters; consider moving details to references`);
    }
  }

  for (const area of system.areas ?? []) {
    for (const requiredFunction of area.required_functions ?? []) {
      if (!system.functions.some((fn) => fn.id === requiredFunction)) {
        fail(`Area ${area.id} references missing function ${requiredFunction}`);
      }
    }
  }
}

const wikiPath = path.join(root, "index.html");
if (!existsSync(wikiPath)) {
  fail("Missing index.html wiki");
} else if (system) {
  const wikiText = readFileSync(wikiPath, "utf8");
  for (const anchor of ["quick-start", "rule", "assessment", "functions", "skills", "workflow", "files", "verify"]) {
    if (!wikiText.includes(`id="${anchor}"`)) {
      fail(`index.html is missing #${anchor}`);
    }
  }
  for (const fn of system.functions ?? []) {
    if (!wikiText.includes(fn.skill)) {
      fail(`index.html does not reference ${fn.skill}`);
    }
  }
}

if (warnings.length > 0) {
  console.warn(warnings.map((message) => `WARN ${message}`).join("\n"));
}

if (failures.length > 0) {
  console.error(failures.map((message) => `FAIL ${message}`).join("\n"));
  process.exit(1);
}

console.log(`development/_system validated: ${system.functions.length} functions, ${system.areas.length} areas, ${system.functions.length} skills.`);
