#!/usr/bin/env node
// The `adg` CLI — one entrypoint over the deterministic ADG scripts. A thin dispatcher: it
// resolves the ADG repo root and shells the right script, passing through your arguments and
// inheriting stdio. This is the terminal surface of ADG (alongside the Claude Code / Codex
// plugins and the @adg/sdk programmatic surface).

import path from "node:path";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Resolve the ADG repo root: up from packages/cli, or an env override for an unusual layout.
function resolveRoot() {
  const fromHere = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const candidates = [process.env.ADG_ROOT, fromHere, process.cwd()].filter(Boolean);
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, "scripts/adg-work-classify.mjs"))) return c;
  }
  return fromHere;
}
const ROOT = resolveRoot();

// subcommand -> [script, ...fixed leading args]
const ROUTES = {
  init: ["scripts/adg-init.mjs"],
  install: ["scripts/adg-install.mjs", "install"],
  update: ["scripts/adg-install.mjs", "update"],
  status: ["scripts/adg-install.mjs", "status"],
  classify: ["scripts/adg-work-classify.mjs", "classify"],
  guard: ["scripts/adg-work-classify.mjs", "guard"],
  models: ["scripts/adg-models.mjs", "select"],
  tiers: ["scripts/adg-models.mjs", "tiers"],
  context: ["scripts/agent-context.mjs"],
  doctor: ["scripts/adg-doctor.mjs"],
  guardrails: ["scripts/guardrail-check.mjs"],
  toggle: ["scripts/adg-toggle-control.mjs"],
  "audit-record": ["scripts/record-audit.mjs"],
  "audit-validate": ["scripts/validate-audit.mjs"],
};

const USAGE = `adg — Agentic Development Governance

Usage: adg <command> [options]

Setup
  init [--target DIR] [--client claude|codex|both]   zero-onboarding install + value proof
  install | update | status                          manage the install in a host repo

Work
  classify --intent "..." [--changed]                pick a Proofline lane (effort/risk)
  guard --event <e> --intent "..."                   fail if the lane is below the required floor
  models --lane L3 --risk secrets [--provider ...]   choose a model tier + effort
  tiers                                              show the tier -> model table
  context feature|item|next|loop -- ...              bounded context packet

Govern
  doctor                                             check the install hasn't drifted
  guardrails [--tool NAME]                           inspect the deny-by-default policy
  toggle --control NAME --set off --reason "..."     governed control toggle (audited)
  audit-record ... | audit-validate                  append-only audit log

Run \`adg <command> --help\` for a command's own options.`;

const cmd = process.argv[2];
if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
  process.stdout.write(`${USAGE}\n`);
  process.exit(0);
}
const route = ROUTES[cmd];
if (!route) {
  process.stderr.write(`adg: unknown command '${cmd}'. Run \`adg help\`.\n`);
  process.exit(2);
}
const [script, ...lead] = route;
const res = spawnSync(process.execPath, [path.join(ROOT, script), ...lead, ...process.argv.slice(3)], {
  stdio: "inherit",
});
process.exit(res.status == null ? 1 : res.status);
