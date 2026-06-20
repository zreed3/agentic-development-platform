// ADG policy client — in-process access to the SAME deterministic decisions the harness
// enforces, for callers that drive a vendor agent loop (the SDK adapters).
//
// The action gate DELEGATES to the hardened PreToolUse hook binary via a subprocess: one
// source of truth, zero duplication, byte-for-behaviour identical to what the harness runs.
// This is "build on, not replace" taken literally — the SDK reuses the exact control the
// plugin installs, rather than a re-implementation that could drift from it. The lifecycle
// decisions (governor / backpressure / context) are already pure modules in this package and
// are imported directly by the adapters.

import fs from "node:fs";
import path from "node:path";
import { spawnSync, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

function repoFile(rel, cwd) {
  // Resolve a repo file from the caller cwd first, then up from this module (so it works both
  // in-repo and when @adg/core is colocated with the plugin in an install).
  const candidates = [path.join(cwd || process.cwd(), rel)];
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    for (const up of ["..", "../..", "../../..", "../../../.."]) {
      candidates.push(path.join(here, up, rel));
    }
  } catch {
    /* ignore */
  }
  for (const f of candidates) {
    try {
      if (fs.existsSync(f)) return f;
    } catch {
      /* next */
    }
  }
  return null;
}

const GUARDRAIL_HOOK_REL = "plugins/adg-governance/hooks/adg-guardrail-hook.mjs";

/**
 * Classify a tool call exactly as the deterministic PreToolUse hook would.
 * @param {object} a
 * @param {string} a.tool          tool name (Bash | Edit | Write | Read | ...)
 * @param {object} a.input         tool input ({command}|{file_path}|...)
 * @param {string} [a.cwd]
 * @param {string} [a.writeScope]  sets ADG_WRITE_SCOPE for the classification
 * @param {string} [a.hookPath]    override the hook binary path
 * @returns {{decision:'allow'|'ask'|'deny', reason:string}}
 */
export function classifyToolUse({ tool, input, cwd, writeScope, hookPath } = {}) {
  const hook = hookPath || repoFile(GUARDRAIL_HOOK_REL, cwd);
  if (!hook) {
    // Fail closed for mutating tools when the control is unreachable; open for reads.
    const mutating = ["Bash", "Edit", "Write", "MultiEdit", "NotebookEdit"].includes(tool);
    return mutating
      ? { decision: "deny", reason: "ADG guardrail hook not found; failing closed for a mutating tool" }
      : { decision: "allow", reason: "read tool; guardrail hook not found (open)" };
  }
  const env = { ...process.env };
  if (writeScope) env.ADG_WRITE_SCOPE = writeScope;
  else delete env.ADG_WRITE_SCOPE;
  const res = spawnSync(process.execPath, [hook], {
    input: JSON.stringify({ tool_name: tool, tool_input: input || {} }),
    encoding: "utf8",
    env,
    cwd: cwd || process.cwd(),
  });
  if (res.status === 2) {
    return { decision: "deny", reason: (res.stderr || "").replace(/^\[ADG\]\s*/i, "").trim() || "denied by ADG policy" };
  }
  let json = null;
  try {
    json = res.stdout ? JSON.parse(res.stdout) : null;
  } catch {
    json = null;
  }
  const dec = json?.hookSpecificOutput?.permissionDecision;
  if (dec === "ask") {
    return { decision: "ask", reason: (json.hookSpecificOutput.permissionDecisionReason || "confirmation required").replace(/^\[ADG\]\s*/i, "") };
  }
  return { decision: "allow", reason: "allowed by ADG policy" };
}

/** Current release-gate violations ([] when none / DB or sqlite3 absent). */
export function queryViolations(cwd) {
  try {
    const db = path.join(cwd || process.cwd(), "data/backlog.sqlite");
    if (!fs.existsSync(db)) return [];
    const out = execFileSync("sqlite3", [db, "-json", "select item_id, release_classes from release_gate_violations"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const rows = JSON.parse(out || "[]");
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}
