#!/usr/bin/env node
// Deterministic context slice wrapper around the ADG context broker.

import { execFileSync, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

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

function abs(file) {
  return path.isAbsolute(file) ? file : path.join(root, file);
}

function repoFileCount() {
  try {
    return execSync("git ls-files | wc -l", { cwd: root, encoding: "utf8", shell: "/bin/zsh" }).trim();
  } catch {
    return "0";
  }
}

function fileSize(file) {
  try {
    return fs.statSync(abs(file)).size;
  } catch {
    return 0;
  }
}

function slice(args) {
  const feature = value(args, "feature");
  const workflow = value(args, "workflow", "agentic-tooling");
  if (!feature) throw new Error("slice requires --feature");
  const raw = execFileSync(process.execPath, ["scripts/agent-context.mjs", "feature", "--feature", feature, "--workflow", workflow, "--format", "json", "--no-manifest"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const packet = JSON.parse(raw);
  const forbidden = new Set(asArray(packet.forbiddenBulkFiles));
  const nextFiles = asArray(packet.nextFiles).map((row) => row.path);
  const forbiddenNamed = nextFiles.filter((file) => forbidden.has(file));
  const stopConditions = [];
  if (!packet.feature?.id) stopConditions.push("missing-feature");
  if (forbiddenNamed.length) stopConditions.push("forbidden-bulk-file");
  if (packet.elicitation?.status === "missing") stopConditions.push("missing-elicitation");
  if (packet.elicitation?.hardGaps?.length) stopConditions.push("hard-elicitation-gaps");
  return {
    kind: "adg-context-slice",
    generatedAt: new Date().toISOString(),
    valid: stopConditions.length === 0,
    stopConditions,
    packet,
    efficiency: {
      packetBytes: Buffer.byteLength(raw, "utf8"),
      nextFileCount: nextFiles.length,
      repoFileCount: Number(repoFileCount()),
      forbiddenBulkFileCount: forbidden.size,
      forbiddenBulkBytes: asArray(packet.forbiddenBulkFiles).reduce((total, file) => total + fileSize(file), 0),
      forbiddenNamed,
    },
  };
}

function render(payload, format) {
  if (format === "json") return `${JSON.stringify(payload, null, 2)}\n`;
  if (format === "toon") {
    return `${[
      "contextSlice:",
      `  valid: ${payload.valid}`,
      `  feature: ${payload.packet.feature.id}`,
      `  workflow: ${payload.packet.workflow}`,
      `  packetBytes: ${payload.efficiency.packetBytes}`,
      `  nextFileCount: ${payload.efficiency.nextFileCount}`,
      `  repoFileCount: ${payload.efficiency.repoFileCount}`,
      `stopConditions[${payload.stopConditions.length}]{condition}:`,
      ...payload.stopConditions,
    ].join("\n")}\n`;
  }
  throw new Error(`Unsupported format ${format}`);
}

const args = parseArgs(process.argv.slice(2));
if (args.command !== "slice") {
  console.log("Usage: node scripts/adg-context.mjs slice --feature S07 [--workflow agentic-tooling] [--format json|toon]");
  process.exit(args.command === "help" ? 0 : 1);
}

try {
  const payload = slice(args);
  process.stdout.write(render(payload, value(args, "format", "json")));
  if (!payload.valid) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
