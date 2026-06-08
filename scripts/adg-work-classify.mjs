#!/usr/bin/env node
// Proofline lane classifier: cheap first-pass risk routing for agent work.

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const configPath = "config/agentic/delivery-lanes.json";

function abs(file) {
  return path.join(root, file);
}

function parseArgs(argv) {
  const args = { command: argv[0] ?? "classify", values: {}, flags: new Set() };
  for (let i = 1; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--") continue;
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
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
  if (pattern.endsWith("/**")) return normalized.startsWith(pattern.slice(0, -3));
  return globToRegex(pattern).test(normalized);
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

function laneById(config, id) {
  return config.lanes.find((lane) => lane.id === id);
}

function classify({ config, intent, files }) {
  const terms = config.classification ?? {};
  const normalizedFiles = files.map(normalizeFile);
  const joined = `${intent} ${normalizedFiles.join(" ")}`;
  const releaseTerm = hasTerm(joined, terms.releaseIntentTerms ?? []);
  const sensitiveTerm = hasTerm(joined, terms.sensitiveIntentTerms ?? []);
  const spikeTerm = hasTerm(joined, terms.spikeIntentTerms ?? []);
  const quickTerm = hasTerm(joined, terms.quickIntentTerms ?? []);
  const sensitiveFile = normalizedFiles.find((file) =>
    (terms.sensitiveFilePatterns ?? []).some((pattern) => matchesPattern(file, pattern)),
  );
  const quickFiles = normalizedFiles.length > 0
    && normalizedFiles.every((file) => (terms.quickFilePatterns ?? []).some((pattern) => matchesPattern(file, pattern)));

  let laneId = "L2";
  const reasons = [];

  if (releaseTerm) {
    laneId = "L4";
    reasons.push(`release intent: ${releaseTerm}`);
  } else if (sensitiveTerm || sensitiveFile) {
    laneId = "L3";
    if (sensitiveTerm) reasons.push(`sensitive intent: ${sensitiveTerm}`);
    if (sensitiveFile) reasons.push(`sensitive file: ${sensitiveFile}`);
  } else if (spikeTerm) {
    laneId = "L0";
    reasons.push(`spike intent: ${spikeTerm}`);
  } else if (quickTerm || quickFiles) {
    laneId = "L1";
    if (quickTerm) reasons.push(`quick intent: ${quickTerm}`);
    if (quickFiles) reasons.push("all named files are quick-lane eligible");
  } else {
    reasons.push("default bounded implementation");
  }

  const lane = laneById(config, laneId);
  return {
    kind: "proofline-work-classification",
    generatedAt: new Date().toISOString(),
    system: config.name,
    mode: value({ values: {} }, "mode", config.defaultMode ?? "caveman"),
    lane: lane?.label ?? laneId,
    laneId,
    laneName: lane?.name ?? "",
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
      "schema, migration, secret, billing, production, guardrail, or audit behavior changes",
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
    `stop: upgrade if sensitive scope or signoff claim appears`,
  ].join("\n") + "\n";
}

function renderMarkdown(result) {
  return `# ${result.system} Classification

- Lane: ${result.lane}
- Reason: ${result.reasons.join("; ")}
- Context workflow: ${result.contextWorkflow}
- Audit required: ${result.auditRequired}
- Full gate required: ${result.fullGateRequired}
- Checks: ${result.requiredChecks.join("; ") || "none"}
- Files: ${result.files.join(", ") || "none named"}
`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.command === "help") {
    console.log("Usage: node scripts/adg-work-classify.mjs classify --intent \"...\" [--file path] [--files a,b] [--format json|toon|markdown]");
    return;
  }
  const config = JSON.parse(fs.readFileSync(abs(configPath), "utf8"));
  const intent = value(args, "intent", value(args, "summary", ""));
  const files = splitFiles([...values(args, "file"), ...values(args, "files")]);
  const result = classify({ config, intent, files });
  result.mode = value(args, "mode", config.defaultMode ?? "caveman");
  const format = value(args, "format", result.mode === "caveman" ? "toon" : "json");
  if (format === "toon") process.stdout.write(renderToon(result));
  else if (format === "markdown") process.stdout.write(renderMarkdown(result));
  else process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main();
