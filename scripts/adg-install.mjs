#!/usr/bin/env node
// Install or update the portable Proofline/ADG lane guard in a host repo.

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
    source: "docs/adg-v0-4-release-notes.md",
    target: "docs/adg/adg-v0-4-release-notes.md",
  },
];

const packageScripts = {
  "adg:classify": "node scripts/adg-work-classify.mjs classify",
  "adg:guard": "node scripts/adg-work-classify.mjs guard",
  "adg:prepush": "node scripts/adg-work-classify.mjs guard --event github-push --intent \"GitHub update pre-push\"",
};

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
  return path.join(root, file);
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

function installFiles({ targetRoot, command, force, dryRun }) {
  const installed = [];
  const backups = [];
  const existingState = loadState(targetRoot);
  const managedTargets = new Set((existingState?.files ?? []).map((file) => file.target));

  for (const entry of managedFiles) {
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

function updatePackageScripts({ targetRoot, dryRun, forceScripts }) {
  const packagePath = abs(targetRoot, "package.json");
  if (!fs.existsSync(packagePath)) return { changed: false, scripts: {}, skipped: "no package.json" };

  const pkg = readJson(packagePath);
  pkg.scripts ??= {};
  const changes = {};
  for (const [name, command] of Object.entries(packageScripts)) {
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

function writeState({ targetRoot, installed, dryRun }) {
  const state = {
    schemaVersion: 1,
    system: "Proofline",
    version: sourceVersion(),
    installedAt: new Date().toISOString(),
    source: path.relative(targetRoot, sourceRoot) || ".",
    files: installed.map(({ source, target, sha256 }) => ({ source, target, sha256 })),
    packageScripts,
  };
  writeJson(abs(targetRoot, statePath), state, dryRun);
  return state;
}

function status({ targetRoot }) {
  const version = sourceVersion();
  const state = loadState(targetRoot);
  const rows = managedFiles.map((entry) => {
    const sourceFile = abs(sourceRoot, entry.source);
    const targetFile = abs(targetRoot, entry.target);
    const sourceHash = sha256(fs.readFileSync(sourceFile, "utf8"));
    const targetHash = fs.existsSync(targetFile) ? sha256(fs.readFileSync(targetFile, "utf8")) : "";
    return {
      target: entry.target,
      status: !targetHash ? "missing" : targetHash === sourceHash ? "current" : "outdated",
    };
  });
  return {
    system: "Proofline",
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
  for (const file of result.files ?? []) {
    console.log(`${file.status ?? (file.changed ? "updated" : "current")}: ${file.target}`);
  }
  if (result.packageScripts?.changed) console.log("package scripts updated");
  if (result.backups?.length) {
    for (const backup of result.backups) console.log(`backup: ${backup.backup}`);
  }
}

function usage() {
  console.log(`Usage:
node scripts/adg-install.mjs status [--target /repo] [--format json]
node scripts/adg-install.mjs install --target /repo [--force] [--dry-run]
node scripts/adg-install.mjs update --target /repo [--force] [--force-scripts] [--dry-run]

Installs the portable ADG lane guard into any Node-backed repo.`);
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

  if (args.command === "status") {
    printResult(status({ targetRoot }), format);
    return;
  }

  if (!["install", "update"].includes(args.command)) {
    usage();
    process.exit(1);
  }

  const force = args.flags.has("force") || args.command === "update";
  const forceScripts = args.flags.has("force-scripts");
  const { installed, backups } = installFiles({ targetRoot, command: args.command, force, dryRun });
  const packageScriptsResult = updatePackageScripts({ targetRoot, dryRun, forceScripts });
  const state = writeState({ targetRoot, installed, dryRun });

  printResult({
    action: args.command,
    target: targetRoot,
    version: state.version,
    files: installed,
    backups,
    packageScripts: packageScriptsResult,
    dryRun,
  }, format);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
