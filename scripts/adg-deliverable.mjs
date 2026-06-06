#!/usr/bin/env node
// Deliverable audit records for agent-produced work.

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const defaultConfig = "config/agentic/deliverables.json";
const defaultLog = "data/deliverables.jsonl";
const elicitationPath = "config/agentic/elicitation.json";

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
    const value = next && !next.startsWith("--") ? next : true;
    if (args.values[key] === undefined) args.values[key] = value;
    else if (Array.isArray(args.values[key])) args.values[key].push(value);
    else args.values[key] = [args.values[key], value];
    if (next && !next.startsWith("--")) i += 1;
  }
  return args;
}

function value(args, key, fallback = "") {
  const raw = args.values[key];
  if (raw === undefined || raw === true) return fallback;
  return Array.isArray(raw) ? String(raw.at(-1)) : String(raw);
}

function multi(args, key) {
  const raw = args.values[key];
  if (raw === undefined || raw === true) return [];
  return Array.isArray(raw) ? raw.map(String) : [String(raw)];
}

function asArray(input) {
  return Array.isArray(input) ? input : [];
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(abs(file), "utf8"));
}

function loadRecords(configPath, logPath) {
  const records = [];
  if (configPath && fs.existsSync(abs(configPath))) records.push(...asArray(readJson(configPath).records));
  if (logPath && fs.existsSync(abs(logPath))) {
    const lines = fs.readFileSync(abs(logPath), "utf8").split(/\r?\n/u).filter(Boolean);
    records.push(...lines.map((line) => JSON.parse(line)));
  }
  return records;
}

function knownIds() {
  const config = readJson(elicitationPath);
  return {
    requirements: new Set(asArray(config.features).flatMap((feature) => asArray(feature.functionalRequirements).map((row) => row.id))),
    contracts: new Set(asArray(config.features).flatMap((feature) => asArray(feature.experienceContracts).map((row) => row.id))),
  };
}

function validateRecord(record, ids) {
  const failures = [];
  for (const field of ["id", "featureId", "summary", "graphSlice"]) {
    if (!record[field]) failures.push(`${record.id ?? "UNKNOWN"}: missing ${field}`);
  }
  for (const field of ["sourceInputs", "filesTouched", "testsRun", "decisions", "evidence"]) {
    if (!asArray(record[field]).length) failures.push(`${record.id ?? "UNKNOWN"}: ${field} must not be empty`);
  }
  for (const reqId of asArray(record.requirements)) {
    if (!ids.requirements.has(reqId)) failures.push(`${record.id}: unknown requirement ${reqId}`);
  }
  for (const contractId of asArray(record.contracts)) {
    if (!ids.contracts.has(contractId)) failures.push(`${record.id}: unknown contract ${contractId}`);
  }
  return failures;
}

function audit(args) {
  const records = loadRecords(value(args, "config", defaultConfig), value(args, "log", ""));
  const ids = knownIds();
  const failures = records.flatMap((record) => validateRecord(record, ids));
  return {
    kind: "deliverable-audit",
    generatedAt: new Date().toISOString(),
    valid: failures.length === 0,
    records: records.length,
    failures,
  };
}

function record(args) {
  const id = value(args, "id", `DEL-${Date.now()}`);
  const entry = {
    id,
    featureId: value(args, "feature"),
    summary: value(args, "summary"),
    graphSlice: {
      featureId: value(args, "feature"),
      nodeIds: multi(args, "node"),
      edgeIds: multi(args, "edge"),
    },
    requirements: multi(args, "requirement"),
    contracts: multi(args, "contract"),
    roles: multi(args, "role"),
    sourceInputs: multi(args, "input"),
    filesTouched: multi(args, "file"),
    testsRun: multi(args, "test"),
    failures: multi(args, "failure"),
    decisions: multi(args, "decision"),
    evidence: multi(args, "evidence"),
    recordedAt: new Date().toISOString(),
  };
  const failures = validateRecord(entry, knownIds());
  if (failures.length) return { kind: "deliverable-record", valid: false, entry, failures };
  const logPath = value(args, "log", defaultLog);
  fs.mkdirSync(path.dirname(abs(logPath)), { recursive: true });
  fs.appendFileSync(abs(logPath), `${JSON.stringify(entry)}\n`, "utf8");
  return { kind: "deliverable-record", valid: true, entry, failures: [] };
}

function render(payload) {
  return `${JSON.stringify(payload, null, 2)}\n`;
}

const args = parseArgs(process.argv.slice(2));
try {
  if (args.command === "audit") {
    const result = audit(args);
    process.stdout.write(render(result));
    if (!result.valid) process.exitCode = 1;
  } else if (args.command === "record") {
    const result = record(args);
    process.stdout.write(render(result));
    if (!result.valid) process.exitCode = 1;
  } else {
    console.log("Usage: node scripts/adg-deliverable.mjs audit [--config path] [--log path] | record --feature S07 --summary ... --input ... --file ... --test ... --decision ... --evidence ...");
    process.exit(args.command === "help" ? 0 : 1);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
