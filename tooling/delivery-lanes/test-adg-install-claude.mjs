#!/usr/bin/env node
// F-E test: `adg:install --client claude`.
//
// Verifies the installer lays down the deterministic Claude Code enforcement layer
// into a host repo: the PreToolUse guardrail hook, a valid .claude/settings.json
// (hook registration + deny-by-default permissions), the slash commands, the
// conformance doctor, the CLAUDE.md generator, and a CLAUDE.md generated from the
// host's AGENTS.md -- all tracked in adg-install-state.json, idempotent, with
// backups on overwrite.
//
// Run: npm run test:adg-install-claude

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const installer = path.join(root, "scripts/adg-install.mjs");

function git(args, cwd) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr || r.stdout}`);
}

function install(host, extraArgs = []) {
  return execFileSync(process.execPath, [installer, "install", "--target", host, "--client", "claude", ...extraArgs], {
    cwd: root,
    encoding: "utf8",
  });
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function makeHost() {
  const host = fs.mkdtempSync(path.join(os.tmpdir(), "adg-install-claude-"));
  git(["init", "-q"], host);
  git(["config", "user.email", "test@example.com"], host);
  git(["config", "user.name", "ADG Test"], host);
  fs.writeFileSync(path.join(host, "AGENTS.md"), "# Host rulebook\n\nFollow ADG governance.\n", "utf8");
  fs.writeFileSync(path.join(host, "package.json"), `${JSON.stringify({ name: "host", scripts: {} }, null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(host, ".gitignore"), "node_modules/\n", "utf8");
  return host;
}

const hosts = [];
let passed = 0;
const ok = (label) => {
  passed += 1;
  console.log(`  ok ${label}`);
};

try {
  const host = makeHost();
  hosts.push(host);
  install(host);

  // 1. The Claude enforcement layer is laid down.
  const expectedFiles = [
    "scripts/adg-guardrail-hook.mjs",
    ".claude/settings.json",
    ".claude/commands/adg-classify.md",
    ".claude/commands/adg-context.md",
    ".claude/commands/adg-verify.md",
    "scripts/adg-claude-md.mjs",
    "scripts/adg-doctor.mjs",
    "CLAUDE.md",
  ];
  for (const rel of expectedFiles) {
    assert.ok(fs.existsSync(path.join(host, rel)), `expected ${rel} to be installed`);
  }
  ok("installs hook, settings, commands, doctor, generator, and CLAUDE.md");

  // 2. .claude/settings.json is valid and registers the hook + deny-by-default permissions.
  const settings = readJson(path.join(host, ".claude/settings.json"));
  const hookCmd = settings.hooks?.PreToolUse?.[0]?.hooks?.[0]?.command ?? "";
  assert.match(hookCmd, /CLAUDE_PROJECT_DIR.*scripts\/adg-guardrail-hook\.mjs/, "hook must run the installed guardrail hook via CLAUDE_PROJECT_DIR");
  assert.ok(Array.isArray(settings.permissions?.deny) && settings.permissions.deny.length > 0, "permissions.deny must be present");
  assert.ok(settings.permissions.deny.some((r) => /rm -rf/.test(r)), "deny must cover rm -rf");
  assert.ok(settings.permissions.ask.some((r) => /git push/.test(r)), "ask must cover git push");
  ok(".claude/settings.json registers the hook and deny-by-default permissions");

  // 3. CLAUDE.md is a generated mirror of the host AGENTS.md (the sync check passes).
  const check = spawnSync(process.execPath, [path.join(host, "scripts/adg-claude-md.mjs"), "--check"], { cwd: host, encoding: "utf8" });
  assert.equal(check.status, 0, `generated CLAUDE.md must be in sync with AGENTS.md (${check.stderr || check.stdout})`);
  ok("CLAUDE.md is a generated, in-sync mirror of the host AGENTS.md");

  // 4. State records the client and tracks the installed files; package scripts added.
  const state = readJson(path.join(host, "config/agentic/adg-install-state.json"));
  assert.equal(state.client, "claude", "state must record client=claude");
  const tracked = new Set(state.files.map((f) => f.target));
  for (const rel of expectedFiles) assert.ok(tracked.has(rel), `state must track ${rel}`);
  const hostPkg = readJson(path.join(host, "package.json"));
  assert.ok(hostPkg.scripts["claude:generate"] && hostPkg.scripts["claude:check"] && hostPkg.scripts["adg:doctor"], "host package scripts must include claude:generate/check and adg:doctor");
  ok("install state records client=claude with tracked files and package scripts");

  // 5. Re-install (update) is idempotent and backs up an existing settings.json.
  fs.writeFileSync(path.join(host, ".claude/settings.json"), `${JSON.stringify({ permissions: { allow: ["Bash(echo *)"] } }, null, 2)}\n`, "utf8");
  const updateOut = execFileSync(process.execPath, [installer, "update", "--target", host, "--format", "json"], { cwd: root, encoding: "utf8" });
  const updateResult = JSON.parse(updateOut);
  assert.equal(updateResult.client, "claude", "update must reuse the recorded client");
  assert.ok((updateResult.backups ?? []).some((b) => b.target === ".claude/settings.json"), "update must back up an overwritten settings.json");
  const restored = readJson(path.join(host, ".claude/settings.json"));
  assert.ok(restored.hooks?.PreToolUse, "update restores the governed settings.json");
  ok("update reuses the client, restores settings, and backs up the overwrite");

  // 6. An unsupported client is rejected.
  const bogus = spawnSync(process.execPath, [installer, "install", "--target", host, "--client", "emacs"], { cwd: root, encoding: "utf8" });
  assert.notEqual(bogus.status, 0, "an unsupported --client must be rejected");
  assert.match(`${bogus.stdout}${bogus.stderr}`, /Unsupported --client/, "the error must name the unsupported client");
  ok("an unsupported --client is rejected");

  // 7. --client base is a first-class downgrade: update prunes the unmodified claude layer.
  const down = makeHost();
  hosts.push(down);
  install(down);
  assert.ok(fs.existsSync(path.join(down, ".claude/commands/adg-verify.md")), "claude layer present before downgrade");
  const downResult = JSON.parse(execFileSync(process.execPath, [installer, "update", "--target", down, "--client", "base", "--format", "json"], { cwd: root, encoding: "utf8" }));
  assert.equal(downResult.client, "base", "downgrade records client=base in the result");
  assert.equal(readJson(path.join(down, "config/agentic/adg-install-state.json")).client, "base", "state records client=base after downgrade");
  assert.ok(!fs.existsSync(path.join(down, ".claude/commands/adg-verify.md")), "the unmodified claude layer is pruned on downgrade");
  assert.ok(!fs.existsSync(path.join(down, "scripts/adg-guardrail-hook.mjs")), "the installed hook is pruned on downgrade");
  assert.ok(fs.existsSync(path.join(down, "scripts/adg-work-classify.mjs")), "the base lane guard remains after downgrade");
  ok("--client base downgrades and prunes the claude layer");

  console.log(`\nadg:install --client claude: ${passed} checks passed`);
} finally {
  for (const host of hosts) fs.rmSync(host, { recursive: true, force: true });
}
