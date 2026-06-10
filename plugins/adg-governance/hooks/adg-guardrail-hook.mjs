#!/usr/bin/env node
// ADG deterministic PreToolUse hook for Claude Code.
//
// Claude Code's reasoning is stochastic; its tool *gate* is not. This hook runs
// before Bash/Edit/Write/Read and enforces ADG's deny-by-default policy at that
// gate — the one deterministic control surface the harness offers.
//
//   exit 2                      -> HARD BLOCK (stderr shown to the user)
//   exit 0 + permissionDecision -> allow / ask / deny with a reason
//   exit 0 (no output)          -> defer to normal permission flow (allow)
//
// Hooks fail OPEN in Claude Code (timeout/crash/exit-1 = allowed), so for
// mutating tools this hook fails CLOSED on its own errors: if it cannot classify
// a Bash/Edit/Write action, it blocks rather than letting it through.
//
// Mirrors the risk classes in config/agentic/guardrails.json:
//   destructive            -> hard block (re-request explicitly if intended)
//   secrets/production/migration -> ask (confirmation)
//   generated context hazards    -> hard block (use the context broker)
//   everything else        -> allow

import fs from "node:fs";

// ── read the PreToolUse event from stdin ────────────────────────────────────
let raw = "";
try {
  raw = fs.readFileSync(0, "utf8");
} catch {
  raw = "";
}
let event = {};
try {
  event = JSON.parse(raw || "{}");
} catch {
  event = {};
}
const tool = String(event.tool_name || "");
const input = event.tool_input || {};

const MUTATING = ["Bash", "Edit", "Write", "MultiEdit", "NotebookEdit"];

// ── ADG policy patterns ─────────────────────────────────────────────────────
// Generated bulk artifacts are context hazards: query them through the ADG
// context broker, never read the raw mirror/DB.
const FORBIDDEN_BULK = [
  /\.sqlite(-(wal|shm))?\b/i,
  /\bdata\/backlog\.sql\b/i,
  /\bdevelopment-tracker\.(json|sql|sqlite)\b/i,
  /-mirror\.(json|sql)\b/i,
];
// Deny-by-default "destructive" risk class.
const DESTRUCTIVE = [
  /\brm\s+-[a-z]*r[a-z]*f|\brm\s+-[a-z]*f[a-z]*r/i,
  /\bgit\s+push\b[^\n]*\s(--force\b|-f\b)/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\s+-[a-z]*f/i,
  /\bDROP\s+(TABLE|DATABASE|SCHEMA)\b/i,
  /\bTRUNCATE\b/i,
  /\b(mkfs|shred)\b/i,
  /\bdd\s+if=/i,
  />\s*\/dev\/sd/i,
];
// "secrets" / "production" / "migration" risk classes -> confirmation (ask).
const SECRETS = [/\.env\b/i, /\bsecrets?\//i, /\.pem\b/i, /\bid_rsa\b/i, /\bcredentials?\b/i];
const PRODUCTION = [
  /\b(vercel|fly|flyctl|railway)\s+(deploy|apply|scale|secrets)\b/i,
  /\bterraform\s+(apply|destroy)\b/i,
  /\bnpm\s+publish\b/i,
  /\bgit\s+push\b/i,
];
const MIGRATION = [/(^|\/)migrations?\//i, /(^|\/)drizzle\//i, /\bschema\.sql$/i, /\bdb\s*:\s*migrate\b/i];

function anyMatch(value, list) {
  return Boolean(value) && list.some((re) => re.test(value));
}

function block(reason) {
  process.stderr.write(`[ADG] BLOCKED — ${reason}\n`);
  process.exit(2);
}

function ask(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason: `[ADG] ${reason}`,
      },
    }),
  );
  process.exit(0);
}

function allow() {
  process.exit(0);
}

// ── decide ──────────────────────────────────────────────────────────────────
try {
  if (["Read", "Grep", "Glob"].includes(tool)) {
    const target = String(input.file_path || input.path || input.pattern || "");
    if (anyMatch(target, FORBIDDEN_BULK)) {
      block(
        `'${target}' is a generated context hazard. Use the ADG context broker ` +
          `(npm run context:feature / context:item) instead of reading the raw mirror.`,
      );
    }
    allow();
  }

  if (tool === "Bash") {
    const cmd = String(input.command || "");
    if (anyMatch(cmd, DESTRUCTIVE)) {
      block(
        `destructive command (deny-by-default). If this is genuinely intended, ` +
          `re-issue it as an explicit, narrowed request: ${cmd}`,
      );
    }
    if (/\b(cat|head|tail|less|more|bat)\b/.test(cmd) && anyMatch(cmd, FORBIDDEN_BULK)) {
      block(`reading a generated context hazard via the shell — use the ADG context broker.`);
    }
    if (anyMatch(cmd, PRODUCTION)) ask(`production / deploy command — confirm before running: ${cmd}`);
    if (anyMatch(cmd, SECRETS)) ask(`secret material referenced — confirm: ${cmd}`);
    if (anyMatch(cmd, MIGRATION)) ask(`migration / schema command — confirm: ${cmd}`);
    allow();
  }

  if (["Edit", "Write", "MultiEdit", "NotebookEdit"].includes(tool)) {
    const target = String(input.file_path || input.path || "");
    if (anyMatch(target, FORBIDDEN_BULK)) {
      ask(`editing a generated artifact directly — regenerate it instead if possible: ${target}`);
    }
    if (anyMatch(target, SECRETS)) ask(`writing a secret-like path — confirm: ${target}`);
    if (anyMatch(target, MIGRATION)) ask(`writing a migration / schema file — confirm: ${target}`);
    allow();
  }

  allow();
} catch (err) {
  // Fail closed for mutating tools we could not classify; fail open for reads.
  if (MUTATING.includes(tool)) {
    block(`hook error while classifying a mutating action; failing closed: ${err && err.message}`);
  }
  allow();
}
