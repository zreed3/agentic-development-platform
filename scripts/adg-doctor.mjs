#!/usr/bin/env node
// ADG conformance doctor (F-B / v0.9.1 R1).
//
// Runs in an adopter repo (or ADG's own repo) and FAILS when the install has
// drifted from ADG's invariants -- the exact F1 anti-patterns the v0.9.1 field
// report documented when bord.room adopted ADG:
//
//   1. tracked-sqlite        generated *.sqlite databases are git-tracked
//                            (they are generated, never canonical -- must be ignored).
//   2. tracked-ignored       a file that .gitignore says is generated is force-added
//                            to the index anyway (the regenerated mirrors).
//   3. committed-artifact-gate a regenerate-then-`git diff --exit-code` gate over
//                            generated data re-introduces the regenerate-then-amend tax.
//   4. embedded-provenance   generated docs embed a volatile git SHA / timestamp in
//                            tracked files, so they re-churn on every commit.
//   + claude-sync            CLAUDE.md has drifted from AGENTS.md (the single rulebook),
//                            folding in `npm run claude:check`.
//
//   node scripts/adg-doctor.mjs [--target /path/to/repo] [--format json]
//
// Exit 0 = conformant (warnings allowed); exit 1 = drift found. The "SQLite is
// generated, not canonical" rule becomes checkable, not just documented.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// args + helpers
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { flags: new Set(), values: {} };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
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

// Run git in the target repo. Never throws; returns { ok, stdout, stderr }.
function git(targetRoot, gitArgs, input) {
  const result = spawnSync("git", ["-C", targetRoot, ...gitArgs], {
    encoding: "utf8",
    input,
    maxBuffer: 32 * 1024 * 1024,
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: (result.stdout ?? "").trim(),
    stderr: (result.stderr ?? "").trim(),
  };
}

function lines(text) {
  return text ? text.split(/\r?\n/u).filter(Boolean) : [];
}

function isGitRepo(targetRoot) {
  return git(targetRoot, ["rev-parse", "--is-inside-work-tree"]).stdout === "true";
}

function result(id, severity, status, summary, offenders = []) {
  return { id, severity, status, summary, offenders };
}

// ---------------------------------------------------------------------------
// checks
// ---------------------------------------------------------------------------

// 1. Generated *.sqlite databases must never be tracked. This is the field
//    report's headline: bord.room committed three .sqlite files at 13-23 MB each.
function checkTrackedSqlite(targetRoot) {
  const tracked = lines(git(targetRoot, ["ls-files", "*.sqlite", "*.sqlite3", "*.db"]).stdout);
  if (tracked.length === 0) {
    return result("tracked-sqlite", "critical", "pass", "No generated SQLite databases are tracked.");
  }
  return result(
    "tracked-sqlite",
    "critical",
    "fail",
    `${tracked.length} generated SQLite database(s) are git-tracked. SQLite is generated, not canonical -- gitignore them and rebuild from text sources.`,
    tracked,
  );
}

// 2. Any file that is tracked yet ALSO matches a .gitignore rule is the
//    regenerated-mirror anti-pattern -- committed despite policy saying it is
//    generated (force-added, or tracked before the ignore rule was added). Either
//    way it is suspect. `git check-ignore --no-index` reports paths matching an
//    ignore rule regardless of tracked status, so its intersection with the tracked
//    set is exactly these files. The intentionally-tracked reviewable mirrors
//    (data/schema.sql, data/backlog-source.sql) are NOT gitignored, so never appear.
function checkTrackedIgnored(targetRoot) {
  const tracked = lines(git(targetRoot, ["ls-files"]).stdout);
  if (tracked.length === 0) {
    return result("tracked-ignored", "high", "pass", "No tracked files match .gitignore.");
  }
  const ignored = lines(git(targetRoot, ["check-ignore", "--no-index", "--stdin"], `${tracked.join("\n")}\n`).stdout);
  // .sqlite offenders are already reported by check 1; don't double-count them.
  const offenders = ignored.filter((file) => !/\.(sqlite|sqlite3|db)$/u.test(file));
  if (offenders.length === 0) {
    return result("tracked-ignored", "high", "pass", "No gitignored generated artifacts are force-tracked.");
  }
  return result(
    "tracked-ignored",
    "high",
    "fail",
    `${offenders.length} file(s) that .gitignore marks as generated are git-tracked anyway. Untrack them (git rm --cached) so they are regenerated, not committed.`,
    offenders,
  );
}

// A line/command is a committed-artifact diff gate when it runs `git diff` over
// generated data. The data token keeps it precise: claude:check (a doc-mirror sync
// gate over AGENTS.md/CLAUDE.md) carries no `git diff` of data/, so it is not flagged.
const GENERATED_DATA_TOKEN = /(\bdata\/|\.sqlite\b|backlog-source|agent-evals|delivery-metrics|schema\.sql)/u;

function looksLikeDataDiffGate(text) {
  return /git\s+diff/u.test(text) && GENERATED_DATA_TOKEN.test(text);
}

function listWorkflowFiles(targetRoot) {
  const dir = path.join(targetRoot, ".github/workflows");
  try {
    return fs.readdirSync(dir).filter((f) => /\.ya?ml$/u.test(f)).map((f) => `.github/workflows/${f}`);
  } catch {
    return [];
  }
}

// 3. A committed-artifact diff gate regenerates generated data then runs
//    `git diff --exit-code` over it -- the regenerate-then-amend tax. It can hide in
//    a package.json script OR in CI config (.github/workflows, GitLab/CircleCI/etc.),
//    so both are scanned.
function checkCommittedArtifactGate(targetRoot) {
  const offenders = [];
  let inspectedSomething = false;

  const pkgPath = path.join(targetRoot, "package.json");
  if (fs.existsSync(pkgPath)) {
    inspectedSomething = true;
    let scripts = {};
    try {
      scripts = JSON.parse(fs.readFileSync(pkgPath, "utf8")).scripts ?? {};
    } catch {
      return result("committed-artifact-gate", "high", "warn", "package.json could not be parsed.");
    }
    for (const [name, command] of Object.entries(scripts)) {
      const cmd = String(command);
      const driftOverData = /drift/iu.test(name) && /\b(data\/|sqlite|backlog|metrics|evals)\b/iu.test(cmd);
      if (looksLikeDataDiffGate(cmd) || driftOverData) offenders.push(`package.json:${name}: ${cmd}`);
    }
  }

  // CI configs: scan per-line so an unrelated `git diff` and an unrelated data path
  // elsewhere in the file do not combine into a false positive.
  const ciFiles = [".gitlab-ci.yml", ".gitlab-ci.yaml", "azure-pipelines.yml", "bitbucket-pipelines.yml", ".circleci/config.yml", ...listWorkflowFiles(targetRoot)];
  for (const rel of ciFiles) {
    const file = path.join(targetRoot, rel);
    if (!fs.existsSync(file)) continue;
    inspectedSomething = true;
    let text = "";
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const line of text.split(/\r?\n/u)) {
      if (looksLikeDataDiffGate(line)) {
        offenders.push(`${rel}: ${line.trim()}`);
        break;
      }
    }
  }

  if (!inspectedSomething) {
    return result("committed-artifact-gate", "high", "skip", "No package.json or CI config to inspect.");
  }
  if (offenders.length === 0) {
    return result("committed-artifact-gate", "high", "pass", "No committed-artifact diff gate over generated data.");
  }
  return result(
    "committed-artifact-gate",
    "high",
    "fail",
    "A committed-artifact diff gate re-introduces the regenerate-then-amend tax. Gitignore the generated data and drop the gate; the reviewable .sql/.schema mirrors are enough.",
    offenders,
  );
}

// 4. Generated docs that embed a volatile git SHA or build timestamp in tracked
//    files re-churn on every commit. The strong signal is a 40-hex git SHA in a
//    tracked .md/.html/.markdown (fail); an ISO datetime in YAML frontmatter is a
//    softer warning. Scope is documentation formats only -- a 40-hex scan over
//    generated .json/.txt risks false positives against legitimate hashes, so those
//    formats are left to manual review.
function checkEmbeddedProvenance(targetRoot) {
  const docs = lines(git(targetRoot, ["ls-files", "*.md", "*.html", "*.markdown"]).stdout);
  const shaOffenders = [];
  const tsWarnings = [];
  const shaPattern = /(?<![0-9a-f])[0-9a-f]{40}(?![0-9a-f])/u;
  const isoPattern = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/u;
  for (const rel of docs) {
    let text = "";
    try {
      text = fs.readFileSync(path.join(targetRoot, rel), "utf8");
    } catch {
      continue;
    }
    if (shaPattern.test(text)) shaOffenders.push(rel);
    const fm = text.match(/^---\n([\s\S]*?)\n---/u);
    if (fm && isoPattern.test(fm[1])) tsWarnings.push(rel);
  }
  if (shaOffenders.length > 0) {
    return result(
      "embedded-provenance",
      "high",
      "fail",
      `${shaOffenders.length} tracked doc(s) embed a 40-char git SHA. Generated docs must not carry volatile provenance in tracked files -- it re-churns every commit.`,
      shaOffenders,
    );
  }
  if (tsWarnings.length > 0) {
    return result(
      "embedded-provenance",
      "high",
      "warn",
      `${tsWarnings.length} tracked doc(s) carry an ISO timestamp in frontmatter. Confirm it is authored, not machine-injected provenance.`,
      tsWarnings,
    );
  }
  return result("embedded-provenance", "high", "pass", "No volatile provenance embedded in tracked docs.");
}

// 5. Fold in the rulebook sync gate: CLAUDE.md must be generated from AGENTS.md.
//    Skipped in hosts that do not use the generator.
function checkClaudeSync(targetRoot) {
  const generator = path.join(targetRoot, "scripts/adg-claude-md.mjs");
  if (!fs.existsSync(generator) || !fs.existsSync(path.join(targetRoot, "AGENTS.md"))) {
    return result("claude-sync", "critical", "skip", "No AGENTS.md -> CLAUDE.md generator in this repo.");
  }
  const check = spawnSync(process.execPath, [generator, "--check"], {
    cwd: targetRoot,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  if (check.status === 0) {
    return result("claude-sync", "critical", "pass", "CLAUDE.md is in sync with AGENTS.md.");
  }
  return result(
    "claude-sync",
    "critical",
    "fail",
    `CLAUDE.md has drifted from AGENTS.md. Run: npm run claude:generate. (${(check.stderr || check.stdout || "").trim()})`,
  );
}

// ---------------------------------------------------------------------------
// run
// ---------------------------------------------------------------------------

export function doctor({ targetRoot = process.cwd() } = {}) {
  const absTarget = path.resolve(targetRoot);
  if (!isGitRepo(absTarget)) {
    return {
      target: absTarget,
      ok: true,
      gitRepo: false,
      checks: [result("git-repo", "medium", "warn", "Target is not a git work tree; git-based conformance checks were skipped.")],
    };
  }
  const checks = [
    checkTrackedSqlite(absTarget),
    checkTrackedIgnored(absTarget),
    checkCommittedArtifactGate(absTarget),
    checkEmbeddedProvenance(absTarget),
    checkClaudeSync(absTarget),
  ];
  const ok = checks.every((c) => c.status !== "fail");
  return { target: absTarget, ok, gitRepo: true, checks };
}

function render(report) {
  const icon = { pass: "ok  ", fail: "FAIL", warn: "warn", skip: "skip" };
  const out = [`ADG conformance doctor -- ${report.target}`];
  for (const c of report.checks) {
    out.push(`  [${icon[c.status] ?? c.status}] ${c.id} (${c.severity}): ${c.summary}`);
    for (const offender of c.offenders ?? []) out.push(`         - ${offender}`);
  }
  out.push("");
  out.push(report.ok ? "conformant: no drift from ADG invariants." : "DRIFT: fix the FAIL items above. SQLite is generated, not canonical.");
  return out.join("\n");
}

// CLI entry (only when run directly, not when imported by adg-install.mjs).
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  const targetRoot = typeof args.values.target === "string" ? args.values.target : process.cwd();
  const report = doctor({ targetRoot });
  if (args.values.format === "json") {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(render(report));
  }
  process.exit(report.ok ? 0 : 1);
}
