#!/usr/bin/env node
// Maturity as code for ADG domains.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const configPath = "config/agentic/maturity.json";
const sqlitePath = "data/maturity.sqlite";

function abs(file) {
  if (path.isAbsolute(file)) return file;
  return path.isAbsolute(file) ? file : path.join(root, file);
}

function parseArgs(argv) {
  const args = { command: argv[0] ?? "help", flags: new Set(), values: {} };
  for (let i = 1; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--") continue;
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    args.flags.add(key);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      args.values[key] = next;
      i += 1;
    } else {
      args.values[key] = true;
    }
  }
  return args;
}

function value(args, key, fallback = "") {
  const raw = args.values[key];
  if (raw === undefined || raw === true) return fallback;
  return String(raw);
}

function sqlString(input) {
  if (input === null || input === undefined) return "NULL";
  return `'${String(input).replaceAll("'", "''")}'`;
}

function asArray(input) {
  return Array.isArray(input) ? input : [];
}

function loadConfig() {
  return JSON.parse(fs.readFileSync(abs(configPath), "utf8"));
}

function domainScore(domain) {
  const scores = asArray(domain.subdomains).map((row) => Number(row.score)).filter(Number.isFinite);
  if (!scores.length) return Number(domain.score ?? 0);
  return Number(Math.min(...scores).toFixed(2));
}

function validateConfig(config) {
  const failures = [];
  const warnings = [];
  if (config.schemaVersion !== 1) failures.push("schemaVersion must be 1");
  if (!config.modelVersion) failures.push("modelVersion is required");
  const target = Number(config.targetScore ?? 4.5);
  if (!Number.isFinite(target) || target < 1 || target > 5) failures.push("targetScore must be between 1 and 5");
  if (!Array.isArray(config.domains) || !config.domains.length) failures.push("domains array is required");
  const names = new Set();
  for (const domain of asArray(config.domains)) {
    if (!domain.id) failures.push("domain id is required");
    if (names.has(domain.id)) failures.push(`duplicate domain ${domain.id}`);
    names.add(domain.id);
    if (!domain.title) failures.push(`${domain.id}: title is required`);
    if (!asArray(domain.subdomains).length) failures.push(`${domain.id}: at least one subdomain is required`);
    for (const subdomain of asArray(domain.subdomains)) {
      const score = Number(subdomain.score);
      if (!subdomain.id) failures.push(`${domain.id}: subdomain id is required`);
      if (!Number.isFinite(score) || score < 1 || score > 5) failures.push(`${domain.id}.${subdomain.id}: score must be between 1 and 5`);
    }
    if (!asArray(domain.evidence).length) failures.push(`${domain.id}: evidence is required`);
    for (const evidence of asArray(domain.evidence)) {
      if (!["path", "command"].includes(evidence.type)) failures.push(`${domain.id}: evidence type must be path or command`);
      if (!evidence.value) failures.push(`${domain.id}: evidence value is required`);
      if (evidence.type === "path" && !fs.existsSync(abs(evidence.value))) failures.push(`${domain.id}: evidence path does not exist: ${evidence.value}`);
    }
    const score = domainScore(domain);
    if (domain.required && score < target) failures.push(`${domain.id}: score ${score} is below required target ${target}`);
    if (score < 5 && !asArray(domain.gaps).length) warnings.push(`${domain.id}: score is below 5.0 but no 5.0 gap is recorded`);
  }
  return { valid: failures.length === 0, failures, warnings };
}

function scorePayload(config, validation) {
  const domains = asArray(config.domains).map((domain) => ({
    id: domain.id,
    title: domain.title,
    required: Boolean(domain.required),
    score: domainScore(domain),
    target: Number(config.targetScore ?? 4.5),
    status: domainScore(domain) >= Number(config.targetScore ?? 4.5) ? "meets-target" : "below-target",
    subdomains: asArray(domain.subdomains),
    evidence: asArray(domain.evidence),
    gaps: asArray(domain.gaps),
  }));
  return {
    kind: "maturity-scorecard",
    generatedAt: new Date().toISOString(),
    modelVersion: config.modelVersion,
    targetScore: Number(config.targetScore ?? 4.5),
    valid: validation.valid,
    failures: validation.failures,
    warnings: validation.warnings,
    domains,
    summary: {
      domains: domains.length,
      requiredDomains: domains.filter((domain) => domain.required).length,
      belowTarget: domains.filter((domain) => domain.status === "below-target").length,
      minimumScore: domains.length ? Number(Math.min(...domains.map((domain) => domain.score)).toFixed(2)) : null,
    },
  };
}

function writeSqlite(payload) {
  fs.mkdirSync(path.dirname(abs(sqlitePath)), { recursive: true });
  const statements = [
    "DROP TABLE IF EXISTS maturity_domains;",
    "DROP TABLE IF EXISTS maturity_subdomains;",
    "DROP TABLE IF EXISTS maturity_evidence;",
    "DROP TABLE IF EXISTS maturity_gaps;",
    "CREATE TABLE maturity_domains (id TEXT PRIMARY KEY, title TEXT NOT NULL, required INTEGER NOT NULL, score REAL NOT NULL, target REAL NOT NULL, status TEXT NOT NULL);",
    "CREATE TABLE maturity_subdomains (id TEXT PRIMARY KEY, domain_id TEXT NOT NULL, score REAL NOT NULL);",
    "CREATE TABLE maturity_evidence (id TEXT PRIMARY KEY, domain_id TEXT NOT NULL, type TEXT NOT NULL, value TEXT NOT NULL);",
    "CREATE TABLE maturity_gaps (id TEXT PRIMARY KEY, domain_id TEXT NOT NULL, severity TEXT NOT NULL, summary TEXT NOT NULL, remediation TEXT NOT NULL);",
  ];
  for (const domain of payload.domains) {
    statements.push(`INSERT INTO maturity_domains VALUES (${sqlString(domain.id)}, ${sqlString(domain.title)}, ${domain.required ? 1 : 0}, ${domain.score}, ${domain.target}, ${sqlString(domain.status)});`);
    for (const subdomain of domain.subdomains) statements.push(`INSERT INTO maturity_subdomains VALUES (${sqlString(`${domain.id}:${subdomain.id}`)}, ${sqlString(domain.id)}, ${Number(subdomain.score)});`);
    domain.evidence.forEach((evidence, index) => statements.push(`INSERT INTO maturity_evidence VALUES (${sqlString(`${domain.id}:E${index + 1}`)}, ${sqlString(domain.id)}, ${sqlString(evidence.type)}, ${sqlString(evidence.value)});`));
    for (const gap of domain.gaps) statements.push(`INSERT INTO maturity_gaps VALUES (${sqlString(gap.id)}, ${sqlString(domain.id)}, ${sqlString(gap.severity)}, ${sqlString(gap.summary)}, ${sqlString(gap.remediation)});`);
  }
  if (fs.existsSync(abs(sqlitePath))) fs.rmSync(abs(sqlitePath));
  execFileSync("sqlite3", [abs(sqlitePath)], { cwd: root, input: `${statements.join("\n")}\n`, encoding: "utf8" });
}

function renderToon(payload) {
  const rows = payload.domains.map((domain) => [domain.id, domain.required, domain.score, domain.target, domain.status, domain.gaps.length].join("\t")).join("\n");
  const gaps = payload.domains.flatMap((domain) => domain.gaps.map((gap) => ({ domain: domain.id, ...gap })));
  return [
    "maturity:",
    `  modelVersion: ${payload.modelVersion}`,
    `  targetScore: ${payload.targetScore}`,
    `  minimumScore: ${payload.summary.minimumScore}`,
    `domains[${payload.domains.length}]{id,required,score,target,status,gaps}:`,
    rows,
    gaps.length
      ? `gaps[${gaps.length}]{id,domain,severity,summary,remediation}:\n${gaps.map((gap) => [gap.id, gap.domain, gap.severity, gap.summary, gap.remediation].map((valueToRender) => String(valueToRender ?? "").replaceAll("\t", " ").replaceAll("\n", " ")).join("\t")).join("\n")}`
      : "gaps[0]{id,domain,severity,summary,remediation}:",
  ].join("\n");
}

function renderMarkdown(payload) {
  const rows = payload.domains.map((domain) => `| ${domain.id} | ${domain.score} | ${domain.target} | ${domain.status} | ${domain.gaps.length} |`).join("\n");
  return `# ADG Maturity Scorecard

Generated: ${payload.generatedAt}
Target score: ${payload.targetScore}
Minimum score: ${payload.summary.minimumScore}

| Domain | Score | Target | Status | Gaps |
|---|---:|---:|---|---:|
${rows}
`;
}

function render(payload, format) {
  if (format === "json") return `${JSON.stringify(payload, null, 2)}\n`;
  if (format === "toon") return `${renderToon(payload)}\n`;
  if (format === "markdown") return renderMarkdown(payload);
  throw new Error(`Unsupported format ${format}`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const format = value(args, "format", args.command === "report" ? "markdown" : "json");
  if (args.command === "help") {
    console.log("Usage: node scripts/adg-maturity.mjs validate|score|report [--format json|toon|markdown] [--no-sqlite]");
    return;
  }
  const config = loadConfig();
  const validation = validateConfig(config);
  const payload = scorePayload(config, validation);
  if (!args.flags.has("no-sqlite")) writeSqlite(payload);
  if (args.command === "validate") {
    process.stdout.write(render({ ...payload, kind: "maturity-validation", sqlite: args.flags.has("no-sqlite") ? null : sqlitePath }, format));
  } else if (args.command === "score" || args.command === "report") {
    process.stdout.write(render(payload, format));
  } else {
    console.log("Usage: node scripts/adg-maturity.mjs validate|score|report [--format json|toon|markdown] [--no-sqlite]");
    process.exitCode = 1;
    return;
  }
  if (!validation.valid) process.exitCode = 1;
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
