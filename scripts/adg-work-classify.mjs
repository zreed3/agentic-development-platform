#!/usr/bin/env node
// Proofline lane classifier/guard for ADG-governed work.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const configPath = "config/agentic/delivery-lanes.json";
const laneOrder = ["L0", "L1", "L2", "L3", "L4"];

function abs(file) {
  return path.isAbsolute(file) ? file : path.join(root, file);
}

function parseArgs(argv) {
  const first = argv[0] && !argv[0].startsWith("--") ? argv[0] : "classify";
  const rest = first === argv[0] ? argv.slice(1) : argv;
  const args = { command: first, values: {}, flags: new Set() };
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (token === "--") continue;
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = rest[i + 1];
    if (next && !next.startsWith("--")) {
      if (args.values[key] === undefined) args.values[key] = next;
      else if (Array.isArray(args.values[key])) args.values[key].push(next);
      else args.values[key] = [args.values[key], next];
      i += 1;
    } else {
      args.flags.add(key);
      args.values[key] = true;
    }
  }
  return args;
}

function value(args, key, fallback = "") {
  const raw = args.values[key];
  if (raw === undefined || raw === true) return fallback;
  return Array.isArray(raw) ? String(raw.at(-1)) : String(raw);
}

function values(args, key) {
  const raw = args.values[key];
  if (raw === undefined || raw === true) return [];
  return Array.isArray(raw) ? raw.map(String) : [String(raw)];
}

function splitFiles(items) {
  return items
    .flatMap((item) => item.split(/[,\n]/u))
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeFile(file) {
  return file.replaceAll("\\", "/").replace(/^\.\//u, "");
}

function globToRegex(pattern) {
  const normalized = normalizeFile(pattern);
  let out = "";
  for (let i = 0; i < normalized.length; i += 1) {
    const char = normalized[i];
    const next = normalized[i + 1];
    if (char === "*" && next === "*") {
      out += ".*";
      i += 1;
    } else if (char === "*") {
      out += "[^/]*";
    } else if ("\\^$+?.()|{}[]".includes(char)) {
      out += `\\${char}`;
    } else {
      out += char;
    }
  }
  return new RegExp(`^${out}$`, "u");
}

function matchesPattern(file, pattern) {
  const normalized = normalizeFile(file);
  const normalizedPattern = normalizeFile(pattern);
  if (normalizedPattern.endsWith("/**")) {
    return normalized.startsWith(normalizedPattern.slice(0, -3));
  }
  return globToRegex(normalizedPattern).test(normalized);
}

function hasTerm(text, terms) {
  const haystack = text.toLowerCase();
  return terms.find((term) => {
    const needle = String(term).toLowerCase();
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const pattern = /[a-z0-9]/u.test(needle)
      ? new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "u")
      : new RegExp(escaped, "u");
    return pattern.test(haystack);
  }) ?? "";
}

function git(args) {
  try {
    return execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function changedFiles() {
  const files = new Set();
  for (const command of [
    ["diff", "--name-only", "--diff-filter=ACMRTUXB", "HEAD"],
    ["diff", "--cached", "--name-only", "--diff-filter=ACMRTUXB"],
    ["ls-files", "--others", "--exclude-standard"],
  ]) {
    for (const line of git(command).split(/\r?\n/u).filter(Boolean)) {
      files.add(normalizeFile(line));
    }
  }
  return [...files].sort();
}

function laneById(config, id) {
  return config.lanes.find((lane) => lane.id === id);
}

function higherLane(a, b) {
  return laneOrder.indexOf(a) >= laneOrder.indexOf(b) ? a : b;
}

function classify({ config, intent, event, files }) {
  const terms = config.classification ?? {};
  const normalizedFiles = files.map(normalizeFile);
  const joined = `${event} ${intent} ${normalizedFiles.join(" ")}`;
  const githubEvent = (terms.githubEvents ?? []).includes(event);
  const releaseTerm = hasTerm(joined, terms.releaseIntentTerms ?? []);
  const sensitiveTerm = hasTerm(joined, terms.sensitiveIntentTerms ?? []);
  const spikeTerm = hasTerm(joined, terms.spikeIntentTerms ?? []);
  const quickTerm = hasTerm(joined, terms.quickIntentTerms ?? []);
  const releaseFile = normalizedFiles.find((file) =>
    (terms.releaseFilePatterns ?? []).some((pattern) => matchesPattern(file, pattern)),
  );
  const sensitiveFile = normalizedFiles.find((file) =>
    (terms.sensitiveFilePatterns ?? []).some((pattern) => matchesPattern(file, pattern)),
  );
  const quickFiles = normalizedFiles.length > 0
    && normalizedFiles.every((file) => (terms.quickFilePatterns ?? []).some((pattern) => matchesPattern(file, pattern)));

  let laneId = "L2";
  const reasons = [];

  if (spikeTerm) {
    laneId = "L0";
    reasons.push(`spike intent: ${spikeTerm}`);
  } else if (quickTerm || quickFiles) {
    laneId = "L1";
    if (quickTerm) reasons.push(`quick intent: ${quickTerm}`);
    if (quickFiles) reasons.push("all named files are quick-lane eligible");
  } else {
    reasons.push("default bounded implementation");
  }

  if (sensitiveTerm || sensitiveFile) {
    laneId = higherLane(laneId, "L3");
    if (sensitiveTerm) reasons.push(`sensitive intent: ${sensitiveTerm}`);
    if (sensitiveFile) reasons.push(`sensitive file: ${sensitiveFile}`);
  }

  if (githubEvent || releaseTerm || releaseFile) {
    laneId = "L4";
    if (githubEvent) reasons.push(`GitHub event: ${event}`);
    if (releaseTerm) reasons.push(`release intent: ${releaseTerm}`);
    if (releaseFile) reasons.push(`release file: ${releaseFile}`);
  }

  const lane = laneById(config, laneId);
  return {
    kind: "adg-work-classification",
    generatedAt: new Date().toISOString(),
    system: config.name,
    version: config.version,
    mode: config.defaultMode ?? "caveman",
    lane: lane?.label ?? laneId,
    laneId,
    laneName: lane?.name ?? "",
    event,
    intent,
    files: normalizedFiles,
    reasons,
    auditRequired: lane?.auditRequired ?? false,
    fullGateRequired: lane?.fullGateRequired ?? false,
    contextWorkflow: lane?.contextWorkflow ?? "delivery-slice",
    requiredChecks: lane?.requiredChecks ?? [],
    allowedClaims: lane?.allowedClaims ?? [],
    forbiddenClaims: lane?.forbiddenClaims ?? [],
    upgradeTriggers: [
      "auth, RBAC, permission, tenant, business-scope, or entitlement behavior appears",
      "schema, migration, secret, billing, production, guardrail, audit, CI, or GitHub behavior changes",
      "the work changes from exploration to implementation or signoff",
      "the agent wants to claim verified, release-ready, or signed-off",
    ],
  };
}

function renderToon(result) {
  return [
    `lane: ${result.lane}`,
    `risk: ${result.reasons.join("; ")}`,
    `workflow: ${result.contextWorkflow}`,
    `audit: ${result.auditRequired}`,
    `fullGate: ${result.fullGateRequired}`,
    `files[${result.files.length}]: ${result.files.join(", ")}`,
    `checks[${result.requiredChecks.length}]: ${result.requiredChecks.join("; ")}`,
    "stop: upgrade if sensitive scope or signoff claim appears",
  ].join("\n") + "\n";
}

function renderMarkdown(result) {
  return `# ${result.system} ${result.version} Classification

- Lane: ${result.lane}
- Reason: ${result.reasons.join("; ")}
- Context workflow: ${result.contextWorkflow}
- Audit required: ${result.auditRequired}
- Full gate required: ${result.fullGateRequired}
- Checks: ${result.requiredChecks.join("; ") || "none"}
- Files: ${result.files.join(", ") || "none named"}
`;
}

function assertMinimumLane(result, minimumLane) {
  const actual = laneOrder.indexOf(result.laneId);
  const required = laneOrder.indexOf(minimumLane);
  if (required < 0) throw new Error(`Unknown required lane ${minimumLane}`);
  if (actual < required) {
    throw new Error(`Lane guard failed: ${result.laneId} is below required ${minimumLane}.`);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.command === "help" || args.flags.has("help")) {
    console.log("Usage: node scripts/adg-work-classify.mjs classify|guard --intent \"...\" [--event github-push] [--file path] [--files a,b] [--changed] [--format json|toon|markdown]");
    return;
  }

  const config = JSON.parse(fs.readFileSync(abs(configPath), "utf8"));
  const event = value(args, "event", "");
  const intent = value(args, "intent", value(args, "summary", event));
  const explicitFiles = splitFiles([...values(args, "file"), ...values(args, "files")]);
  const files = args.command === "guard" || args.flags.has("changed")
    ? [...new Set([...explicitFiles.map(normalizeFile), ...changedFiles()])].sort()
    : explicitFiles;
  const result = classify({ config, intent, event, files });
  result.mode = value(args, "mode", config.defaultMode ?? "caveman");

  if (args.command === "guard") {
    const minimumLane = value(args, "require-lane", "");
    if (minimumLane) assertMinimumLane(result, minimumLane);
  }

  const format = value(args, "format", result.mode === "caveman" ? "toon" : "json");
  if (format === "toon") process.stdout.write(renderToon(result));
  else if (format === "markdown") process.stdout.write(renderMarkdown(result));
  else process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
