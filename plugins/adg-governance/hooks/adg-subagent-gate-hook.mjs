#!/usr/bin/env node
// ADG subagent budget gate — PreToolUse/Task + SubagentStop hook for Claude Code.
//
// Bounds the cost/blast-radius of multi-agent fan-out (P9): caps simultaneously-active
// subagents (maxConcurrent) and total spawns per session (maxTotal). See
// packages/core/subagent-gate.mjs for the decision.
//
// Two roles, by event:
//   PreToolUse(Task) -> increment active+total, then decide:
//        exit 2 + stderr -> BLOCK the spawn (stderr shown to the model)
//        exit 0          -> allow the spawn
//   SubagentStop     -> decrement active (bookkeeping only); never blocks here.
//
// QUALITY gate, not the security floor: this hook FAILS OPEN (allows) on ANY error, a
// missing/unreadable policy, or an unreadable state file. The deny-by-default PreToolUse
// guardrail hook remains the deterministic security floor. State is local + gitignored
// (.adg/subagent-state.json), mirroring the governor's turn counter.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { subagentGateDecision } from "../../../packages/core/subagent-gate.mjs";

function allow() {
  process.exit(0);
}

try {
  // -- read the hook event ---------------------------------------------------
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
  const eventName = event.hook_event_name || "";
  const toolName = event.tool_name || "";
  const sessionId = event.session_id || "default";

  // -- load the subagent budget (fail open: defaults if absent) --------------
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
    return { subagents: { mode: "warn", caps: { maxConcurrent: 8, maxTotal: 50 } } };
  }
  const budget = loadBudget();
  const sub = budget?.subagents || {};
  const mode = sub.mode || "warn";
  const caps = sub.caps || {};

  // -- per-session counters. Best-effort, local, gitignored. -----------------
  // NOTE: this is a non-atomic read-modify-write, exactly like the governor's turn
  // counter. Under truly simultaneous Task spawns the count can lose an increment
  // (last-writer-wins), so the cap may be exceeded slightly. That is acceptable here:
  // the gate is a fail-open QUALITY gate and an undercount errs toward ALLOW (it never
  // traps the agent). The write is made atomic (temp file + rename) so a concurrent
  // writer can never observe a torn/half-written state file. Hardening the counter to
  // be lost-update-free is tracked as improvement I9.
  const stateFile = path.join(cwd, ".adg", "subagent-state.json");
  function readState() {
    try {
      return JSON.parse(fs.readFileSync(stateFile, "utf8")) || {};
    } catch {
      return {};
    }
  }
  function writeState(state) {
    try {
      const dir = path.dirname(stateFile);
      fs.mkdirSync(dir, { recursive: true });
      const tmp = path.join(dir, `subagent-state.${process.pid}.tmp`);
      fs.writeFileSync(tmp, JSON.stringify(state));
      fs.renameSync(tmp, stateFile); // atomic on POSIX: no torn read for a concurrent process
    } catch {
      /* counting is best-effort; never block on a state-file error */
    }
  }

  // -- SubagentStop: decrement active, then allow ----------------------------
  if (eventName === "SubagentStop" || (!toolName && /subagent/i.test(eventName))) {
    const state = readState();
    const s = state[sessionId] || { active: 0, total: 0 };
    s.active = Math.max(0, (Number(s.active) || 0) - 1);
    state[sessionId] = s;
    writeState(state);
    allow();
  }

  // -- PreToolUse for a non-Task tool: not ours, allow -----------------------
  if (toolName && toolName !== "Task") {
    allow();
  }

  // -- PreToolUse(Task): increment active+total, then decide -----------------
  const state = readState();
  const s = state[sessionId] || { active: 0, total: 0 };
  s.active = (Number(s.active) || 0) + 1;
  s.total = (Number(s.total) || 0) + 1;
  state[sessionId] = s;
  writeState(state);

  const decision = subagentGateDecision({
    activeCount: s.active,
    totalCount: s.total,
    caps,
    mode,
  });

  if (decision.action === "block") {
    // Roll back the increment we just made so a blocked (non-)spawn isn't counted.
    s.active = Math.max(0, s.active - 1);
    s.total = Math.max(0, s.total - 1);
    state[sessionId] = s;
    writeState(state);
    process.stderr.write(`[ADG subagent-gate] ${decision.reason}\n`);
    process.exit(2);
  }
  if (decision.advisory) {
    process.stderr.write(`[ADG subagent-gate] ${decision.reason}\n`);
  }
  allow();
} catch (err) {
  // Quality gate: never trap the agent on our own error.
  process.stderr.write(`[ADG subagent-gate] non-fatal error, allowing: ${err && err.message}\n`);
  allow();
}
