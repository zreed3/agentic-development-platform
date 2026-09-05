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

// The shared deterministic enforcement layer. Any client that installs the hook also
// installs the SINGLE policy source (config/agentic/guardrails.json) plus the validator,
// the governed toggle, the audit recorder + chain, so the policy is enforceable and
// tamper-evident in the host, not a tamper surface. guardrails.json is merge-managed on
// update (mergeControls) so a routine adg:update never clobbers a host's governed toggle.
const sharedEnforcementFiles = [
  { source: "plugins/adg-governance/hooks/adg-guardrail-hook.mjs", target: "scripts/adg-guardrail-hook.mjs" },
  // The hook's synthetic-event regression suite ships WITH the hook (v2.1): any host that
  // tunes a pattern must keep `npm run adg:hook:test` ALL PASS -- false-positive fixes and
  // must-still-block cases are both pinned, so a tune cannot silently weaken the floor.
  { source: "plugins/adg-governance/hooks/adg-guardrail-hook.selftest.mjs", target: "scripts/adg-guardrail-hook.selftest.mjs" },
  { source: "config/agentic/guardrails.json", target: "config/agentic/guardrails.json", mergeControls: true },
  { source: "scripts/guardrail-check.mjs", target: "scripts/guardrail-check.mjs" },
  { source: "scripts/adg-toggle-control.mjs", target: "scripts/adg-toggle-control.mjs" },
  { source: "scripts/audit-chain.mjs", target: "scripts/audit-chain.mjs" },
  { source: "scripts/record-audit.mjs", target: "scripts/record-audit.mjs" },
  { source: "scripts/validate-audit.mjs", target: "scripts/validate-audit.mjs" },
  { source: "scripts/adg-doctor.mjs", target: "scripts/adg-doctor.mjs" },
  // assetLint quality gate: the Node orchestrator + the Rust pixel-reader source. The
  // host builds the binary on demand (npm run asset:lint:build); without it the gate
  // skips green (control config.onToolMissing defaults to "skip").
  { source: "scripts/asset-lint.mjs", target: "scripts/asset-lint.mjs" },
  { source: "tools/adg-asset-lint/Cargo.toml", target: "tools/adg-asset-lint/Cargo.toml" },
  { source: "tools/adg-asset-lint/Cargo.lock", target: "tools/adg-asset-lint/Cargo.lock" },
  { source: "tools/adg-asset-lint/src/main.rs", target: "tools/adg-asset-lint/src/main.rs" },
];

// Per-client additions. `--client claude` installs the deterministic Claude Code
// enforcement layer on top of the base lane guard: the shared enforcement files above
// plus a .claude/settings.json (hook registration + deny-by-default permissions), the
// slash commands, and the CLAUDE.md generator. `--client codex` installs the same shared
// enforcement plus the harness-neutral Codex pre-tool adapter, so both harnesses enforce
// the SAME deny-by-default policy from one source. `--client both` installs both adapters.
const clientManagedFiles = {
  claude: [
    ...sharedEnforcementFiles,
    { source: "plugins/adg-governance/assets/templates/claude-settings.template.json", target: ".claude/settings.json", mergeSettings: true },
    { source: "plugins/adg-governance/commands/adg-classify.md", target: ".claude/commands/adg-classify.md" },
    { source: "plugins/adg-governance/commands/adg-context.md", target: ".claude/commands/adg-context.md" },
    { source: "plugins/adg-governance/commands/adg-verify.md", target: ".claude/commands/adg-verify.md" },
    { source: "plugins/adg-governance/commands/adg-completeness-critic.md", target: ".claude/commands/adg-completeness-critic.md" },
    { source: "scripts/adg-claude-md.mjs", target: "scripts/adg-claude-md.mjs" },
  ],
  codex: [
    ...sharedEnforcementFiles,
    { source: "plugins/adg-governance/.codex-plugin/hooks/adg-codex-pretool.mjs", target: "scripts/adg-codex-pretool.mjs" },
  ],
};

const sharedEnforcementScripts = {
  "adg:guardrails": "node scripts/guardrail-check.mjs",
  "adg:hook:test": "node scripts/adg-guardrail-hook.selftest.mjs scripts/adg-guardrail-hook.mjs",
  "adg:toggle": "node scripts/adg-toggle-control.mjs",
  "adg:audit:validate": "node scripts/validate-audit.mjs",
  "adg:doctor": "node scripts/adg-doctor.mjs",
  "asset:lint": "node scripts/asset-lint.mjs",
  "asset:lint:build": "cargo build --release --manifest-path tools/adg-asset-lint/Cargo.toml",
};

const clientPackageScripts = {
  claude: {
    ...sharedEnforcementScripts,
    "claude:generate": "node scripts/adg-claude-md.mjs",
    "claude:check": "node scripts/adg-claude-md.mjs --check",
  },
  codex: {
    ...sharedEnforcementScripts,
  },
};

// "base" is the lane-guard-only install; "claude"/"codex" add the deterministic
// enforcement layer for that harness; "both" installs both adapters over one shared
// policy. `--client base` is a first-class downgrade: `adg:update --client base` prunes
// the client files (the unmodified ones) and records the host back as base.
const SUPPORTED_CLIENTS = new Set(["base", "claude", "codex", "both"]);

// Resolve a client's managed files, de-duplicating the shared enforcement set for "both".
function clientManagedFor(client) {
  if (client === "both") {
    const seen = new Set();
    return [...clientManagedFiles.claude, ...clientManagedFiles.codex].filter((file) => {
      if (seen.has(file.target)) return false;
      seen.add(file.target);
      return true;
    });
  }
  return clientManagedFiles[client] ?? [];
}

function clientScriptsFor(client) {
  if (client === "both") return { ...clientPackageScripts.claude, ...clientPackageScripts.codex };
  return clientPackageScripts[client] ?? {};
}

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
  "src/routes/controls/+page.server.js",
  "src/routes/controls/+page.svelte",
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
  const clientFiles = client ? clientManagedFor(client) : [];
  const files = [...managedFiles, ...clientFiles];
  return dashboard ? [...files, ...dashboardManagedFiles] : files;
}

function activePackageScripts(client, dashboard) {
  const scripts = client ? { ...packageScripts, ...clientScriptsFor(client) } : { ...packageScripts };
  return dashboard ? { ...scripts, ...dashboardPackageScripts } : scripts;
}

// Merge-aware policy refresh. On update, preserve the host's governed toggle state
// (controls.definitions[*].enabled and toggleHistory) while refreshing the policy
// STRUCTURE from source. An always-on control is forced enabled regardless of the host
// file, so a merge can never carry a relaxed always-on control forward. Returns the
// merged JSON string, or the source verbatim if either side has no controls block.
function mergePolicyControls(sourceContent, targetContent) {
  let source;
  let host;
  try {
    source = JSON.parse(sourceContent);
    host = JSON.parse(targetContent);
  } catch {
    throw new Error("Refusing to replace malformed host guardrails.json");
  }
  // Preserve host extensions and configuration. Source defaults fill missing keys;
  // mandatory controls below always take the complete source definition.
  const mergedPolicy = mergeObjects(source, host);
  // Refresh the safety floor while keeping host-only tools/risk classes and stricter
  // denials. A host cannot override built-in risk classifications or evidence rules.
  mergedPolicy.schemaVersion = source.schemaVersion;
  mergedPolicy.policyVersion = source.policyVersion;
  mergedPolicy.defaultDecision = source.defaultDecision;
  mergedPolicy.riskClasses = { ...(host.riskClasses || {}) };
  for (const [name, def] of Object.entries(source.riskClasses || {})) {
    mergedPolicy.riskClasses[name] = { ...(host.riskClasses?.[name] || {}), ...def,
      requiresConfirmation: def.requiresConfirmation === true || host.riskClasses?.[name]?.requiresConfirmation === true };
  }
  if (host.tools !== undefined && !Array.isArray(host.tools)) throw new Error("Invalid host policy tools");
  const hostTools = new Map((host.tools || []).map(t => {
    if (!t || typeof t.name !== "string") throw new Error("Invalid host policy tool");
    return [t.name, t];
  }));
  mergedPolicy.tools = (source.tools || []).map(t => {
    const old = hostTools.get(t.name) || {};
    hostTools.delete(t.name);
    return { ...old, ...t, allowed: t.allowed === false || old.allowed === false ? false : t.allowed,
      requiredEvidence: [...new Set([...(t.requiredEvidence || []), ...(old.requiredEvidence || [])])] };
  }).concat([...hostTools.values()]);
  mergedPolicy.redactFields = [...new Set([...(source.redactFields || []), ...(host.redactFields || [])])];
  mergedPolicy.evidence = { ...(host.evidence || {}), ...source.evidence,
    sensitiveReleaseClasses: [...new Set([...(source.evidence?.sensitiveReleaseClasses || []), ...(host.evidence?.sensitiveReleaseClasses || [])])] };
  const sourceDefs = source.controls?.definitions;
  const hostDefs = host.controls?.definitions;
  if (!sourceDefs) return JSON.stringify(mergedPolicy, null, 2) + "\n";
  const alwaysOn = new Set(source.controls.mandatoryAlwaysOn ?? []);
  for (const [name, def] of Object.entries(sourceDefs)) {
    const hostDef = hostDefs?.[name];
    if (alwaysOn.has(name) || def.alwaysOn === true) {
      mergedPolicy.controls.definitions[name] = { ...def, enabled: true };
    } else {
      mergedPolicy.controls.definitions[name] = mergeObjects(def, hostDef || {});
    }
  }
  mergedPolicy.controls.mandatoryAlwaysOn = [...new Set([
    ...(source.controls.mandatoryAlwaysOn || []), ...(host.controls?.mandatoryAlwaysOn || []),
  ])];
  return `${JSON.stringify(mergedPolicy, null, 2)}\n`;
}

function mergeObjects(defaults, host) {
  const result = { ...defaults };
  for (const [key, value] of Object.entries(host)) {
    if (["__proto__", "prototype", "constructor"].includes(key)) throw new Error(`Unsafe JSON key: ${key}`);
    result[key] = value && typeof value === "object" && !Array.isArray(value)
      && defaults[key] && typeof defaults[key] === "object" && !Array.isArray(defaults[key])
      ? mergeObjects(defaults[key], value) : value;
  }
  return result;
}

function mergeClaudeSettings(sourceContent, targetContent) {
  const source = JSON.parse(sourceContent);
  const host = JSON.parse(targetContent);
  if (!host || typeof host !== "object" || Array.isArray(host)) throw new Error("Claude settings must be a JSON object");
  if (host.disableAllHooks === true) throw new Error("Claude disableAllHooks is true; resolve disabled enforcement before installing ADG");
  const result = mergeObjects(source, host);
  result.hooks = { ...(host.hooks || {}) };
  for (const [event, registrations] of Object.entries(source.hooks || {})) {
    const existing = host.hooks?.[event] || [];
    if (!Array.isArray(existing)) throw new Error(`Invalid Claude hook registrations: ${event}`);
    // Replace only our installed command, retaining unrelated hooks even when they
    // share a registration. Do not remove commands merely mentioning ADG in text.
    const managedCommands = new Set(registrations.flatMap(r => r.hooks.map(h => h.command)));
    const retained = existing.map(r => ({ ...r, hooks: r.hooks.filter(h => !managedCommands.has(h.command)) }))
      .filter(r => r.hooks.length);
    result.hooks[event] = [...registrations, ...retained];
  }
  result.permissions = { ...(host.permissions || {}) };
  for (const [key, rules] of Object.entries(source.permissions || {})) {
    if (host.permissions?.[key] !== undefined && !Array.isArray(host.permissions[key])) throw new Error(`Invalid Claude permissions: ${key}`);
    result.permissions[key] = [...new Set([...rules, ...(host.permissions?.[key] || [])])];
  }
  return JSON.stringify(result, null, 2) + "\n";
}

// Validate every destination, including recorded stale entries, before any writes.
// Reject symlink ancestors: a lexical prefix alone does not contain filesystem writes.
function checkedTarget(root, relative) {
  if (typeof relative !== "string" || !relative || path.isAbsolute(relative)
      || relative.split(/[\\/]/u).includes("..")) throw new Error(`Unsafe managed path: ${relative}`);
  const target = path.resolve(root, relative);
  if (!target.startsWith(path.resolve(root) + path.sep)) throw new Error(`Unsafe managed path: ${relative}`);
  let current = target;
  while (current !== path.resolve(root)) {
    if (fs.existsSync(current) || (() => { try { fs.lstatSync(current); return true; } catch { return false; } })()) {
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`Refusing symlink destination: ${relative}`);
    }
    current = path.dirname(current);
  }
  return target;
}

function preflight({ targetRoot, files, force, forcePolicy }) {
  checkedTarget(targetRoot, statePath);
  const state = loadState(targetRoot);
  if (state && (!Array.isArray(state.files) || !state.files.every(f => f && typeof f.target === "string"))) {
    throw new Error("Malformed ADG install state");
  }
  const previous = new Map((state?.files || []).map(f => [f.target, f]));
  for (const rel of ["package.json", "CLAUDE.md", "AGENTS.md", "docs/adg-preserved", ...(state?.files || []).map(f => f.target)]) checkedTarget(targetRoot, rel);
  if (fs.existsSync(abs(targetRoot, "package.json"))) {
    const pkg = readJson(abs(targetRoot, "package.json"));
    if (!pkg || typeof pkg !== "object" || Array.isArray(pkg)
        || (pkg.scripts !== undefined && (!pkg.scripts || typeof pkg.scripts !== "object" || Array.isArray(pkg.scripts)))) {
      throw new Error("package.json must be an object with an object-valued scripts field");
    }
  }
  if (previous.has(".claude/settings.json") && fs.existsSync(abs(targetRoot, ".claude/settings.json"))) {
    mergeClaudeSettings(fs.readFileSync(abs(sourceRoot, "plugins/adg-governance/assets/templates/claude-settings.template.json"), "utf8"), fs.readFileSync(abs(targetRoot, ".claude/settings.json"), "utf8"));
  }
  const conflicts = [];
  for (const entry of files) {
    const destination = checkedTarget(targetRoot, entry.target);
    const source = fs.readFileSync(abs(sourceRoot, entry.source), "utf8");
    if (!fs.existsSync(destination)) continue;
    const host = fs.readFileSync(destination, "utf8");
    if (entry.mergeControls) { if (!forcePolicy) mergePolicyControls(source, host); continue; }
    if (entry.mergeSettings) { mergeClaudeSettings(source, host); continue; }
    if (host !== source && !force && (!previous.get(entry.target)?.sha256 || sha256(host) !== previous.get(entry.target).sha256)) conflicts.push(entry.target);
  }
  if (conflicts.length) throw new Error(`Customized or unmanaged files require review; no files changed: ${conflicts.join(", ")}. Preserve/merge them first, or explicitly use --force for backed-up replacement.`);
}

function preserveClaudeNotes({ targetRoot, dryRun }) {
  const claude = abs(targetRoot, "CLAUDE.md");
  if (!fs.existsSync(claude)) return null;
  const text = fs.readFileSync(claude, "utf8");
  const old = loadState(targetRoot)?.files?.find(f => f.target === "CLAUDE.md");
  // Unchanged generated output needs no archival copy. Everything else is retained
  // verbatim, including customized generated documents and unmanaged rulebooks.
  if (old?.sha256 === sha256(text)) return null;
  const rel = `docs/adg-preserved/CLAUDE-${sha256(text).slice(0, 16)}.md`;
  const dest = checkedTarget(targetRoot, rel);
  if (fs.existsSync(dest) && fs.readFileSync(dest, "utf8") !== text) throw new Error(`Preservation collision: ${rel}`);
  if (!dryRun) {
    writeFile(dest, text, false);
  }
  return rel;
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
  const backup = `${file}.adg-backup-${Date.now()}-${process.pid}-${Math.random().toString(16).slice(2)}`;
  fs.copyFileSync(file, backup, fs.constants.COPYFILE_EXCL);
  return backup;
}

function sourceVersion() {
  const config = readJson(abs(sourceRoot, "package.json"));
  return String(config.version ?? "unknown");
}

function loadState(targetRoot) {
  const file = abs(targetRoot, statePath);
  if (!fs.existsSync(file)) return null;
  return readJson(file);
}

function installFiles({ targetRoot, command, force, forcePolicy, dryRun, files }) {
  const installed = [];
  const backups = [];
  const existingState = loadState(targetRoot);
  const managedTargets = new Set((existingState?.files ?? []).map((file) => file.target));

  for (const entry of files) {
    const sourceFile = abs(sourceRoot, entry.source);
    const targetFile = abs(targetRoot, entry.target);
    const sourceContent = fs.readFileSync(sourceFile, "utf8");
    const targetExists = fs.existsSync(targetFile);
    const targetContent = targetExists ? fs.readFileSync(targetFile, "utf8") : "";
    // Merge-managed policy: when the host already has a policy, preserve its governed
    // toggle state instead of clobbering it. --force-policy re-baselines to source.
    // An always-on control can never be carried forward relaxed (mergePolicyControls
    // pins it enabled), so the merge cannot weaken the floor.
    const merged = Boolean(entry.mergeControls) && targetExists && !forcePolicy;
    const contentToWrite = merged ? mergePolicyControls(sourceContent, targetContent) : entry.mergeSettings && targetExists ? mergeClaudeSettings(sourceContent, targetContent) : sourceContent;
    const writeHash = sha256(contentToWrite);
    const changed = targetContent !== contentToWrite;
    const knownManaged = managedTargets.has(entry.target) || entry.target === statePath;

    // Merge-managed files never trip the refuse-overwrite guard: the merge preserves
    // the host's state by construction, so there is nothing to lose.
    if (targetExists && changed && command === "install" && !force && !knownManaged && !entry.mergeControls && !entry.mergeSettings) {
      throw new Error(`Refusing to overwrite existing unmanaged file ${entry.target}. Re-run with --force or use update after reviewing.`);
    }

    if (changed) {
      const backup = targetExists ? backupFile(targetFile, dryRun) : "";
      if (backup) backups.push({ target: entry.target, backup: path.relative(targetRoot, backup) });
      writeFile(targetFile, contentToWrite, dryRun);
    }

    installed.push({ source: entry.source, target: entry.target, sha256: writeHash, changed, ...(entry.mergeControls ? { mergeControls: true } : {}), ...(merged ? { merged: true } : {}) });
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
    if (entry.target === ".claude/settings.json") {
      const settings = JSON.parse(targetContent);
      const owned = 'node "${CLAUDE_PROJECT_DIR}/scripts/adg-guardrail-hook.mjs"';
      const registrations = settings.hooks?.PreToolUse;
      if (registrations) {
        settings.hooks.PreToolUse = registrations.map(r => ({ ...r, hooks: r.hooks.filter(h => h.command !== owned) })).filter(r => r.hooks.length);
        if (!settings.hooks.PreToolUse.length) delete settings.hooks.PreToolUse;
      }
      // Keep permissions conservatively: an identical host rule has no ownership
      // marker. Removing the ADG command is enough to prevent a dangling hook.
      writeJson(targetFile, settings, dryRun);
      pruned.push({ target: entry.target, status: "host-settings-preserved" });
      continue;
    }
    const targetHash = sha256(targetContent);
    if (typeof entry.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(entry.sha256)) {
      pruned.push({ target: entry.target, status: "stale-unverified" });
      continue;
    }
    if (targetHash !== entry.sha256) {
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
    sourceCommit: spawnSync("git", ["rev-parse", "HEAD"], { cwd: sourceRoot, encoding: "utf8" }).stdout?.trim() || null,
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
    // Merge-managed files (the policy) are expected to diverge from source once the host
    // applies a governed toggle, so present divergence as "managed", not "outdated".
    let fileStatus = !targetHash ? "missing" : !sourceExists ? "present" : targetHash === sourceHash ? "current" : "outdated";
    if ((entry.mergeControls || entry.mergeSettings) && targetHash) fileStatus = targetHash === sourceHash ? "current" : "managed";
    return { target: entry.target, status: fileStatus };
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
node scripts/adg-install.mjs status [--target /repo] [--client claude|codex|both] [--dashboard on|off] [--format json]
node scripts/adg-install.mjs install --target /repo [--client claude|codex|both] [--dashboard on|off] [--force] [--dry-run]
node scripts/adg-install.mjs update --target /repo [--client claude|codex|both] [--dashboard on|off] [--force] [--force-scripts] [--force-policy] [--dry-run]

Installs the portable ADG lane guard into any Node-backed repo. With --client claude,
codex, or both it also installs the deterministic enforcement layer for that harness:
the shared PreToolUse hook, the SINGLE policy source (config/agentic/guardrails.json),
the guardrail validator, the governed toggle, and the append-only audit recorder + hash
chain, so both harnesses enforce the same deny-by-default policy from one source. claude
also gets .claude/settings.json, the slash commands, and a CLAUDE.md generated from the
host's AGENTS.md; codex gets the harness-neutral pre-tool adapter.

Updates preflight all destinations and refuse customized managed code before writing.
Review conflicts first; --force explicitly replaces customized code with unique backups.
Claude settings merge with host hooks and permissions. Unique CLAUDE.md notes are
preserved verbatim under docs/adg-preserved before regenerating the rulebook.
The policy preserves host extensions, custom tools and governed toggle state while
refreshing built-in deny/evidence rules and mandatory controls. --force-policy explicitly
re-baselines the complete policy to source. Install versions follow package.json;
sourceCommit records the Git revision when available.

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

  const force = args.flags.has("force");
  const forceScripts = args.flags.has("force-scripts");
  const forcePolicy = args.flags.has("force-policy");
  preflight({ targetRoot, files, force, forcePolicy });
  const preservedClaudeNotes = (client === "claude" || client === "both")
    ? preserveClaudeNotes({ targetRoot, dryRun }) : null;
  const pruned = args.command === "update" ? pruneStaleManagedFiles({ targetRoot, dryRun, files }) : [];
  const { installed, backups } = installFiles({ targetRoot, command: args.command, force, forcePolicy, dryRun, files });
  const packageScriptsResult = updatePackageScripts({ targetRoot, dryRun, forceScripts, scripts });

  // For the Claude client, generate CLAUDE.md from the host AGENTS.md (single source
  // of truth) and track it in the install state so adg:update keeps it fresh.
  let claudeMd = null;
  if (client === "claude" || client === "both") {
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
    preservedClaudeNotes,
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
