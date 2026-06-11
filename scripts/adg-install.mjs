#!/usr/bin/env node
// Install or update the portable Proofline/ADG lane guard in a host repo.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { doctor } from "./adg-doctor.mjs";

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultTargetRoot = process.cwd();
const statePath = "config/agentic/adg-install-state.json";

const managedFiles = [
  {
    source: "config/agentic/delivery-lanes.json",
    target: "config/agentic/delivery-lanes.json",
  },
  {
    source: "scripts/adg-work-classify.mjs",
    target: "scripts/adg-work-classify.mjs",
  },
  {
    source: "docs/proofline-delivery-lanes.md",
    target: "docs/adg/proofline-delivery-lanes.md",
  },
  {
    source: "docs/proofline-v0-9-release-notes.md",
    target: "docs/adg/proofline-v0-9-release-notes.md",
  },
];

const packageScripts = {
  "adg:classify": "node scripts/adg-work-classify.mjs classify",
  "adg:guard": "node scripts/adg-work-classify.mjs guard",
  "adg:prepush": "node scripts/adg-work-classify.mjs guard --event github-push --intent \"GitHub update pre-push\"",
};

// Per-client additions. `--client claude` installs the deterministic Claude Code
// enforcement layer on top of the base lane guard: the PreToolUse guardrail hook, a
// .claude/settings.json (hook registration + deny-by-default permissions), the slash
// commands, the conformance doctor, and the CLAUDE.md generator. CLAUDE.md itself is
// generated from the host's AGENTS.md during install (see generateClaudeMd).
const clientManagedFiles = {
  claude: [
    { source: "plugins/adg-governance/hooks/adg-guardrail-hook.mjs", target: "scripts/adg-guardrail-hook.mjs" },
    { source: "plugins/adg-governance/assets/templates/claude-settings.template.json", target: ".claude/settings.json" },
    { source: "plugins/adg-governance/commands/adg-classify.md", target: ".claude/commands/adg-classify.md" },
    { source: "plugins/adg-governance/commands/adg-context.md", target: ".claude/commands/adg-context.md" },
    { source: "plugins/adg-governance/commands/adg-verify.md", target: ".claude/commands/adg-verify.md" },
    { source: "scripts/adg-claude-md.mjs", target: "scripts/adg-claude-md.mjs" },
    { source: "scripts/adg-doctor.mjs", target: "scripts/adg-doctor.mjs" },
  ],
};

const clientPackageScripts = {
  claude: {
    "claude:generate": "node scripts/adg-claude-md.mjs",
    "claude:check": "node scripts/adg-claude-md.mjs --check",
    "adg:doctor": "node scripts/adg-doctor.mjs",
  },
};

// "base" is the lane-guard-only install; "claude" adds the deterministic Claude Code
// layer. `--client base` is a first-class downgrade: `adg:update --client base` prunes
// the claude files (the unmodified ones) and records the host back as base.
const SUPPORTED_CLIENTS = new Set(["base", "claude"]);

// Optional read-only governance dashboard (`--dashboard on`). Installed into the host
// at apps/adg-dashboard/ so operators can watch what the agent is doing: backlog,
// append-only audit log, guardrail policy, evals, delivery proxies. It reads the
// host's data/ and config/agentic/ artifacts directly and renders empty states for
// artifacts the host has not adopted yet. `--dashboard off` prunes it on update.
const dashboardSourceDir = "apps/dashboard";
const dashboardTargetDir = "apps/adg-dashboard";
const dashboardManagedFiles = [
  "package.json",
  "svelte.config.js",
  "vite.config.js",
  ".gitignore",
  "README.md",
  "Dockerfile",
  ".dockerignore",
  "src/app.html",
  "src/app.css",
  "src/lib/server/data.js",
  "src/routes/+layout.svelte",
  "src/routes/+page.server.js",
  "src/routes/+page.svelte",
  "src/routes/backlog/+page.server.js",
  "src/routes/backlog/+page.svelte",
  "src/routes/audit/+page.server.js",
  "src/routes/audit/+page.svelte",
  "src/routes/guardrails/+page.server.js",
  "src/routes/guardrails/+page.svelte",
  "src/routes/evals/+page.server.js",
  "src/routes/evals/+page.svelte",
].map((file) => ({
  source: `${dashboardSourceDir}/${file}`,
  target: `${dashboardTargetDir}/${file}`,
}));

// First run installs the dashboard's own dev dependencies; nothing is added to the
// host's root dependency tree.
const dashboardPackageScripts = {
  "adg:dashboard": `npm --prefix ${dashboardTargetDir} install && npm --prefix ${dashboardTargetDir} run dev`,
};

function activeManagedFiles(client, dashboard) {
  const files = client && clientManagedFiles[client] ? [...managedFiles, ...clientManagedFiles[client]] : [...managedFiles];
  return dashboard ? [...files, ...dashboardManagedFiles] : files;
}

function activePackageScripts(client, dashboard) {
  const scripts = client && clientPackageScripts[client] ? { ...packageScripts, ...clientPackageScripts[client] } : { ...packageScripts };
  return dashboard ? { ...scripts, ...dashboardPackageScripts } : scripts;
}

function parseArgs(argv) {
  const command = argv[0] && !argv[0].startsWith("--") ? argv[0] : "status";
  const rest = command === argv[0] ? argv.slice(1) : argv;
  const values = {};
  const flags = new Set();
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = rest[i + 1];
    if (next && !next.startsWith("--")) {
      values[key] = next;
      i += 1;
    } else {
      flags.add(key);
      values[key] = true;
    }
  }
  return { command, values, flags };
}

function value(args, key, fallback = "") {
  const raw = args.values[key];
  if (raw === undefined || raw === true) return fallback;
  return String(raw);
}

function abs(root, file) {
  return path.isAbsolute(file) ? file : path.join(root, file);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, payload, dryRun) {
  writeFile(file, `${JSON.stringify(payload, null, 2)}\n`, dryRun);
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function writeFile(file, content, dryRun) {
  if (dryRun) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
}

function backupFile(file, dryRun) {
  if (!fs.existsSync(file) || dryRun) return "";
  const backup = `${file}.adg-backup-${new Date().toISOString().replace(/[-:.TZ]/gu, "").slice(0, 14)}`;
  fs.copyFileSync(file, backup);
  return backup;
}

function sourceVersion() {
  const config = readJson(abs(sourceRoot, "config/agentic/delivery-lanes.json"));
  return String(config.version ?? "unknown");
}

function loadState(targetRoot) {
  const file = abs(targetRoot, statePath);
  if (!fs.existsSync(file)) return null;
  return readJson(file);
}

function installFiles({ targetRoot, command, force, dryRun, files }) {
  const installed = [];
  const backups = [];
  const existingState = loadState(targetRoot);
  const managedTargets = new Set((existingState?.files ?? []).map((file) => file.target));

  for (const entry of files) {
    const sourceFile = abs(sourceRoot, entry.source);
    const targetFile = abs(targetRoot, entry.target);
    const sourceContent = fs.readFileSync(sourceFile, "utf8");
    const sourceHash = sha256(sourceContent);
    const targetExists = fs.existsSync(targetFile);
    const targetContent = targetExists ? fs.readFileSync(targetFile, "utf8") : "";
    const changed = targetContent !== sourceContent;
    const knownManaged = managedTargets.has(entry.target) || entry.target === statePath;

    if (targetExists && changed && command === "install" && !force && !knownManaged) {
      throw new Error(`Refusing to overwrite existing unmanaged file ${entry.target}. Re-run with --force or use update after reviewing.`);
    }

    if (changed) {
      const backup = targetExists ? backupFile(targetFile, dryRun) : "";
      if (backup) backups.push({ target: entry.target, backup: path.relative(targetRoot, backup) });
      writeFile(targetFile, sourceContent, dryRun);
    }

    installed.push({ ...entry, sha256: sourceHash, changed });
  }

  return { installed, backups };
}

function pruneStaleManagedFiles({ targetRoot, dryRun, files }) {
  const existingState = loadState(targetRoot);
  if (!existingState?.files?.length) return [];

  const currentTargets = new Set(files.map((entry) => entry.target));
  const pruned = [];

  for (const entry of existingState.files) {
    if (currentTargets.has(entry.target)) continue;

    const targetFile = abs(targetRoot, entry.target);
    if (!fs.existsSync(targetFile)) continue;

    const targetContent = fs.readFileSync(targetFile, "utf8");
    const targetHash = sha256(targetContent);
    if (entry.sha256 && targetHash !== entry.sha256) {
      pruned.push({ target: entry.target, status: "stale-modified" });
      continue;
    }

    if (!dryRun) fs.rmSync(targetFile);
    pruned.push({ target: entry.target, status: "pruned" });
  }

  return pruned;
}

function updatePackageScripts({ targetRoot, dryRun, forceScripts, scripts }) {
  const packagePath = abs(targetRoot, "package.json");
  if (!fs.existsSync(packagePath)) return { changed: false, scripts: {}, skipped: "no package.json" };

  const pkg = readJson(packagePath);
  pkg.scripts ??= {};
  const changes = {};

  // Prune previously managed scripts that fell out of scope (e.g. --dashboard off),
  // but only when the host still has the exact command we wrote — never a hand edit.
  const previousScripts = loadState(targetRoot)?.packageScripts ?? {};
  for (const [name, command] of Object.entries(previousScripts)) {
    if (scripts[name] !== undefined) continue;
    if (pkg.scripts[name] === command) {
      changes[name] = { from: command, to: null };
      delete pkg.scripts[name];
    }
  }

  for (const [name, command] of Object.entries(scripts)) {
    const current = pkg.scripts[name];
    if (current === undefined || current === command || forceScripts) {
      if (current !== command) {
        changes[name] = { from: current ?? null, to: command };
        pkg.scripts[name] = command;
      }
    }
  }

  if (Object.keys(changes).length > 0) {
    writeJson(packagePath, pkg, dryRun);
  }

  return { changed: Object.keys(changes).length > 0, scripts: changes };
}

function writeState({ targetRoot, installed, dryRun, client, dashboard, scripts }) {
  const state = {
    schemaVersion: 1,
    system: "Proofline",
    version: sourceVersion(),
    client: client || "base",
    dashboard: Boolean(dashboard),
    installedAt: new Date().toISOString(),
    source: path.relative(targetRoot, sourceRoot) || ".",
    files: installed.map(({ source, target, sha256 }) => ({ source, target, sha256 })),
    packageScripts: scripts ?? packageScripts,
  };
  writeJson(abs(targetRoot, statePath), state, dryRun);
  return state;
}

// Generate CLAUDE.md from the host's AGENTS.md (single source of truth), using the
// generator just installed into the host. Only possible when the host has an
// AGENTS.md; otherwise the operator runs `npm run claude:generate` after adding one.
function generateClaudeMd({ targetRoot, dryRun }) {
  const generator = abs(targetRoot, "scripts/adg-claude-md.mjs");
  if (!fs.existsSync(abs(targetRoot, "AGENTS.md"))) return { generated: false, reason: "no AGENTS.md in host" };
  if (!fs.existsSync(generator)) return { generated: false, reason: "generator not installed" };
  if (dryRun) return { generated: false, reason: "dry-run" };
  const existed = fs.existsSync(abs(targetRoot, "CLAUDE.md"));
  const res = spawnSync(process.execPath, [generator], { cwd: targetRoot, encoding: "utf8" });
  if (res.status !== 0) return { generated: false, reason: (res.stderr || res.stdout || "generator failed").trim() };
  const content = fs.readFileSync(abs(targetRoot, "CLAUDE.md"), "utf8");
  return { generated: true, target: "CLAUDE.md", sha256: sha256(content), created: !existed };
}

function status({ targetRoot, files }) {
  const version = sourceVersion();
  const state = loadState(targetRoot);
  const rows = files.map((entry) => {
    const sourceFile = abs(sourceRoot, entry.source);
    const targetFile = abs(targetRoot, entry.target);
    // Generated targets (e.g. CLAUDE.md) have no source mirror to diff against.
    const sourceExists = fs.existsSync(sourceFile);
    const sourceHash = sourceExists ? sha256(fs.readFileSync(sourceFile, "utf8")) : "";
    const targetHash = fs.existsSync(targetFile) ? sha256(fs.readFileSync(targetFile, "utf8")) : "";
    return {
      target: entry.target,
      status: !targetHash ? "missing" : !sourceExists ? "present" : targetHash === sourceHash ? "current" : "outdated",
    };
  });
  return {
    system: "Proofline",
    client: state?.client ?? "base",
    dashboard: Boolean(state?.dashboard),
    sourceVersion: version,
    installedVersion: state?.version ?? null,
    stateFile: fs.existsSync(abs(targetRoot, statePath)) ? statePath : null,
    files: rows,
  };
}

function printResult(result, format) {
  if (format === "json") {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`Proofline ${result.action ?? "status"}: ${result.version ?? result.sourceVersion}`);
  if (result.target) console.log(`target: ${result.target}`);
  if (result.client && result.client !== "base") console.log(`client: ${result.client}`);
  if (result.dashboard) console.log("dashboard: on");
  for (const file of result.files ?? []) {
    console.log(`${file.status ?? (file.changed ? "updated" : "current")}: ${file.target}`);
  }
  if (result.claudeMd?.generated) console.log("generated: CLAUDE.md (from AGENTS.md)");
  else if (result.claudeMd && !result.claudeMd.generated) console.log(`CLAUDE.md: not generated (${result.claudeMd.reason})`);
  if (result.packageScripts?.changed) console.log("package scripts updated");
  if (result.pruned?.length) {
    for (const file of result.pruned) console.log(`${file.status}: ${file.target}`);
  }
  if (result.backups?.length) {
    for (const backup of result.backups) console.log(`backup: ${backup.backup}`);
  }
}

function printConformance(report) {
  if (report.ok) {
    const passed = report.checks.filter((c) => c.status === "pass").length;
    console.log(`conformance: ok (${passed} check${passed === 1 ? "" : "s"} passed; SQLite stays generated, not canonical)`);
    return;
  }
  console.log("conformance: DRIFT from ADG invariants");
  for (const check of report.checks.filter((c) => c.status === "fail")) {
    console.log(`  FAIL ${check.id}: ${check.summary}`);
    for (const offender of check.offenders ?? []) console.log(`    - ${offender}`);
  }
}

function usage() {
  console.log(`Usage:
node scripts/adg-install.mjs status [--target /repo] [--client claude] [--dashboard on|off] [--format json]
node scripts/adg-install.mjs install --target /repo [--client claude] [--dashboard on|off] [--force] [--dry-run]
node scripts/adg-install.mjs update --target /repo [--client claude] [--dashboard on|off] [--force] [--force-scripts] [--dry-run]

Installs the portable ADG lane guard into any Node-backed repo. With --client claude
it also installs the deterministic Claude Code layer: the PreToolUse guardrail hook,
.claude/settings.json (hook + deny-by-default permissions), the slash commands, the
conformance doctor, and a CLAUDE.md generated from the host's AGENTS.md.

With --dashboard on it also installs the read-only governance dashboard (SvelteKit)
at apps/adg-dashboard/ plus an "adg:dashboard" package script, so operators can watch
the backlog, audit log, guardrails, and evals in a browser. --dashboard off on update
prunes it. The choice is recorded in adg-install-state.json and reused by update.`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.command === "help" || args.flags.has("help")) {
    usage();
    return;
  }

  const targetRoot = path.resolve(value(args, "target", defaultTargetRoot));
  const dryRun = args.flags.has("dry-run");
  const format = value(args, "format", "text");

  // Resolve the client: explicit --client wins; otherwise reuse what the install
  // state recorded, so update/status operate on whatever was installed.
  const recordedState = loadState(targetRoot);
  const recordedClient = recordedState?.client;
  const client = value(args, "client", "") || (recordedClient && recordedClient !== "base" ? recordedClient : "");
  if (client && !SUPPORTED_CLIENTS.has(client)) {
    console.error(`Unsupported --client "${client}". Supported: ${[...SUPPORTED_CLIENTS].join(", ")}.`);
    process.exit(1);
  }

  // Resolve the dashboard component the same way: explicit --dashboard on/off wins;
  // otherwise reuse what the install state recorded. Bare --dashboard means on.
  const dashboardRaw = args.values.dashboard;
  let dashboard = Boolean(recordedState?.dashboard);
  if (dashboardRaw !== undefined) {
    const normalized = dashboardRaw === true ? "on" : String(dashboardRaw).toLowerCase();
    if (!["on", "off"].includes(normalized)) {
      console.error(`Unsupported --dashboard "${dashboardRaw}". Use on or off.`);
      process.exit(1);
    }
    dashboard = normalized === "on";
  }

  const files = activeManagedFiles(client, dashboard);
  const scripts = activePackageScripts(client, dashboard);

  if (args.command === "status") {
    // Status doubles as the adopter conformance report (F-B): it runs the doctor
    // and exits non-zero on drift so "SQLite is generated, not canonical" is checked.
    const conformance = doctor({ targetRoot });
    if (format === "json") {
      printResult({ ...status({ targetRoot, files }), conformance }, format);
    } else {
      printResult(status({ targetRoot, files }), format);
      console.log("");
      printConformance(conformance);
    }
    if (!conformance.ok) process.exit(1);
    return;
  }

  if (!["install", "update"].includes(args.command)) {
    usage();
    process.exit(1);
  }

  const force = args.flags.has("force") || args.command === "update";
  const forceScripts = args.flags.has("force-scripts");
  const pruned = args.command === "update" ? pruneStaleManagedFiles({ targetRoot, dryRun, files }) : [];
  const { installed, backups } = installFiles({ targetRoot, command: args.command, force, dryRun, files });
  const packageScriptsResult = updatePackageScripts({ targetRoot, dryRun, forceScripts, scripts });

  // For the Claude client, generate CLAUDE.md from the host AGENTS.md (single source
  // of truth) and track it in the install state so adg:update keeps it fresh.
  let claudeMd = null;
  if (client === "claude") {
    claudeMd = generateClaudeMd({ targetRoot, dryRun });
    if (claudeMd.generated) installed.push({ source: "(generated from AGENTS.md)", target: claudeMd.target, sha256: claudeMd.sha256, changed: claudeMd.created });
  }

  const state = writeState({ targetRoot, installed, dryRun, client, dashboard, scripts });
  // After install/update, warn (don't fail) on conformance drift so the operator
  // sees regenerate-then-amend hazards without blocking the install (F-B / R1).
  const conformance = doctor({ targetRoot });

  printResult({
    action: args.command,
    target: targetRoot,
    client: client || "base",
    dashboard,
    version: state.version,
    files: installed,
    pruned,
    backups,
    packageScripts: packageScriptsResult,
    claudeMd,
    conformance,
    dryRun,
  }, format);

  if (!conformance.ok && format !== "json") {
    console.warn("");
    console.warn("warning: target repo has conformance drift -- run `npm run adg:doctor` for details.");
    printConformance(conformance);
  }
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
