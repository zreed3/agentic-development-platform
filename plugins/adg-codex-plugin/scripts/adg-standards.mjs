#!/usr/bin/env node
// Validate and render ADG standards-control evidence maps.

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const standardsPath = "config/agentic/standards-map.json";

function abs(file) {
  return path.isAbsolute(file) ? file : path.join(root, file);
}

function parseArgs(argv) {
  const args = { command: argv[0] ?? "help", values: {} };
  for (let i = 1; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    args.values[key] = next && !next.startsWith("--") ? next : true;
    if (next && !next.startsWith("--")) i += 1;
  }
  return args;
}

function value(args, key, fallback = "") {
  const raw = args.values[key];
  if (raw === undefined || raw === true) return fallback;
  return String(raw);
}

function asArray(input) {
  return Array.isArray(input) ? input : [];
}

function loadConfig() {
  return JSON.parse(fs.readFileSync(abs(standardsPath), "utf8"));
}

function evidenceExists(evidence) {
  if (String(evidence).startsWith("npm run ")) return true;
  if (/^https?:\/\//u.test(String(evidence))) return true;
  return fs.existsSync(abs(evidence));
}

function validate(config) {
  const failures = [];
  const warnings = [];
  if (config.schemaVersion !== 1) failures.push("schemaVersion must be 1");
  const standardIds = new Set(asArray(config.standards).map((standard) => standard.id));
  for (const standard of asArray(config.standards)) {
    if (!standard.id || !standard.name || !standard.sourceUrl) failures.push(`${standard.id ?? "UNKNOWN"}: id, name, and sourceUrl are required`);
    if (!/^https:\/\//u.test(String(standard.sourceUrl))) failures.push(`${standard.id}: sourceUrl must be https`);
  }
  for (const id of [...asArray(config.policy?.baseline), ...asArray(config.policy?.advisory)]) {
    if (!standardIds.has(id)) failures.push(`policy references unknown standard ${id}`);
  }
  for (const control of asArray(config.controls)) {
    if (!control.id || !control.domain || !control.localControl) failures.push(`${control.id ?? "UNKNOWN"}: id, domain, and localControl are required`);
    if ("standardText" in control) failures.push(`${control.id}: standardText is not allowed; reference identifiers only`);
    for (const standardId of asArray(control.standardRefs)) {
      if (!standardIds.has(standardId)) failures.push(`${control.id}: unknown standard ${standardId}`);
    }
    for (const evidence of asArray(control.evidence)) {
      if (!evidenceExists(evidence)) failures.push(`${control.id}: missing evidence ${evidence}`);
    }
    if (!control.maturityDomain) warnings.push(`${control.id}: maturityDomain is recommended`);
  }
  return {
    kind: "standards-validation",
    generatedAt: new Date().toISOString(),
    modelVersion: config.modelVersion,
    valid: failures.length === 0,
    summary: {
      standards: asArray(config.standards).length,
      controls: asArray(config.controls).length,
      baseline: asArray(config.policy?.baseline).length,
      advisory: asArray(config.policy?.advisory).length,
      failures: failures.length,
      warnings: warnings.length,
    },
    failures,
    warnings,
  };
}

function matrix(config, validation) {
  return {
    kind: "standards-matrix",
    generatedAt: new Date().toISOString(),
    modelVersion: config.modelVersion,
    valid: validation.valid,
    standards: asArray(config.standards),
    controls: asArray(config.controls).map((control) => ({
      id: control.id,
      domain: control.domain,
      standardRefs: asArray(control.standardRefs),
      localControl: control.localControl,
      evidence: asArray(control.evidence),
      maturityDomain: control.maturityDomain,
    })),
    failures: validation.failures,
    warnings: validation.warnings,
  };
}

function render(payload, format) {
  if (format === "json") return `${JSON.stringify(payload, null, 2)}\n`;
  if (format === "toon") {
    const controls = payload.controls ?? [];
    return `${[
      `${payload.kind}:`,
      `  valid: ${payload.valid}`,
      `  controls: ${controls.length || payload.summary?.controls || 0}`,
      `controls[${controls.length}]{id,domain,standards,maturityDomain}:`,
      ...controls.map((control) => [control.id, control.domain, asArray(control.standardRefs).join(";"), control.maturityDomain].join("\t")),
      `failures[${payload.failures.length}]{message}:`,
      ...payload.failures,
    ].join("\n")}\n`;
  }
  if (format === "markdown") {
    const controls = payload.controls ?? [];
    return `# Standards Matrix

Valid: ${payload.valid}
Controls: ${controls.length || payload.summary?.controls || 0}

${controls.map((control) => `- ${control.id}: ${control.domain} -> ${asArray(control.standardRefs).join(", ")}`).join("\n")}
`;
  }
  throw new Error(`Unsupported format ${format}`);
}

const args = parseArgs(process.argv.slice(2));
if (!["validate", "matrix", "packet"].includes(args.command)) {
  console.log("Usage: node <adg-standards.mjs> validate|matrix|packet [--format json|toon|markdown]");
  process.exit(args.command === "help" ? 0 : 1);
}

try {
  const config = loadConfig();
  const validation = validate(config);
  const payload = args.command === "validate" ? validation : matrix(config, validation);
  process.stdout.write(render(payload, value(args, "format", args.command === "packet" ? "toon" : "json")));
  if (!validation.valid) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
