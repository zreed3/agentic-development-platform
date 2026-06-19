#!/usr/bin/env node
// ADG loop governor — Stop / SubagentStop hook for Claude Code.
//
// Refuses turn-end while a release-class backlog item has been signed off (status
// `verified`) without a `live` evidence event (verifier-as-authority, P12), and holds a
// turn ceiling as a runaway failsafe (P3). See packages/core/governor.mjs for the decision.
//
//   exit 2 + stderr -> BLOCK the stop (the model keeps working; stderr is shown to it)
//   exit 0          -> allow the stop
//
// QUALITY gate, not the security floor: this hook FAILS OPEN (allows the stop) on ANY
// error, a missing database, or a missing/unreadable policy. The deny-by-default
// PreToolUse hook remains the deterministic security floor.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { governorDecision } from "../../../packages/core/governor.mjs";

function allow() {
  process.exit(0);
}

try {
  // -- read the Stop event ---------------------------------------------------
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

  const cwd = process.cwd();

  // -- load the budget policy (fail open: defaults if absent) ----------------
  function loadBudget() {
    const candidates = [];
    if (process.env.ADG_LOOP_BUDGET_PATH) candidates.push(process.env.ADG_LOOP_BUDGET_PATH);
    candidates.push(path.join(cwd, "config/agentic/loop-budget.json"));
    try {
      const here = path.dirname(fileURLToPath(import.meta.url));
      for (const up of ["..", "../..", "../../..", "../../../.."]) {
        candidates.push(path.join(here, up, "config/agentic/loop-budget.json"));
      }
    } catch {
      /* ignore */
    }
    for (const file of candidates) {
      try {
        if (file && fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
      } catch {
        /* next */
      }
    }
    return { caps: { maxTurns: 60 }, releaseGate: { mode: "block" } };
  }
  const budget = loadBudget();
  const mode = budget?.releaseGate?.mode || "block";
  const caps = budget?.caps || {};

  // -- per-session turn counter (failsafe ceiling). State is local + gitignored.
  function bumpTurnCount(sessionId) {
    try {
      const dir = path.join(cwd, ".adg");
      const file = path.join(dir, "governor-state.json");
      let state = {};
      try {
        state = JSON.parse(fs.readFileSync(file, "utf8"));
      } catch {
        state = {};
      }
      const key = sessionId || "default";
      state[key] = (Number(state[key]) || 0) + 1;
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(state));
      return state[key];
    } catch {
      return 0; // counting is best-effort; never block on a state-file error
    }
  }
  const turnCount = bumpTurnCount(event.session_id);

  // -- query the release-gate view (empty/[] on any error or missing DB) -----
  function queryViolations() {
    try {
      const db = path.join(cwd, "data/backlog.sqlite");
      if (!fs.existsSync(db)) return [];
      const out = execFileSync(
        "sqlite3",
        [db, "-json", "select item_id, release_classes from release_gate_violations"],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      );
      const rows = JSON.parse(out || "[]");
      return Array.isArray(rows) ? rows : [];
    } catch {
      return []; // fail open: no DB / no sqlite3 / view absent -> no violations
    }
  }
  const violations = queryViolations();

  // -- decide ----------------------------------------------------------------
  const decision = governorDecision({
    stopHookActive: Boolean(event.stop_hook_active),
    turnCount,
    caps,
    violations,
    mode,
  });

  if (decision.action === "block") {
    process.stderr.write(`[ADG governor] ${decision.reason}\n`);
    process.exit(2);
  }
  if (decision.advisory) {
    process.stderr.write(`[ADG governor] ${decision.reason}\n`);
  }
  allow();
} catch (err) {
  // Quality gate: never trap the agent on our own error.
  process.stderr.write(`[ADG governor] non-fatal error, allowing stop: ${err && err.message}\n`);
  allow();
}
