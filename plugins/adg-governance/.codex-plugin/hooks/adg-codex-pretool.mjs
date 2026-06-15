#!/usr/bin/env node
// Harness-neutral pre-tool adapter for the ADG guardrail hook (Codex and beyond).
//
// The Claude Code PreToolUse hook (../../hooks/adg-guardrail-hook.mjs) is the single
// source of deny-by-default policy. This adapter lets any OTHER harness reuse that
// exact policy without depending on Claude Code's specific event/output shapes:
//
//   1. It reads a pre-tool event from stdin, tolerating field-name variants
//      (tool_name / toolName / name / tool; tool_input / toolInput / input /
//      arguments / args).
//   2. It runs the shared hook with the normalised event.
//   3. It emits a uniform decision on stdout and mirrors it in the exit code:
//
//        {"decision":"deny","reason":"..."}    exit 2  (block)
//        {"decision":"ask","reason":"..."}     exit 0  (confirm)
//        {"decision":"allow"}                  exit 0
//
// When Codex (or any harness) exposes a pre-tool hook surface, wiring it to this
// adapter gives it the SAME gate Claude Code enforces -- one policy, two harnesses.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Resolve the shared hook in a way that survives installation into a host repo,
// where this adapter and the hook both land in scripts/. The source-tree-relative
// path (../../hooks/) is only correct in the ADG repo, so try the host layouts first.
// ADG_GUARDRAILS_HOOK is an explicit override (mirrors ADG_GUARDRAILS_PATH).
function resolveHookPath() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env.ADG_GUARDRAILS_HOOK,
    path.join(here, "adg-guardrail-hook.mjs"), // host: adapter + hook both in scripts/
    path.join(process.cwd(), "scripts/adg-guardrail-hook.mjs"), // host cwd layout
    path.resolve(here, "../../hooks/adg-guardrail-hook.mjs"), // ADG source tree
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  // None found: return the host-default path so the spawn fails closed for mutating
  // tools (a missing hook is a hook error, which this adapter blocks).
  return candidates[candidates.length - 1];
}

const hookPath = resolveHookPath();

function readStdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

// Normalise any reasonable pre-tool event shape to the hook's {tool_name, tool_input}.
export function normalizeEvent(raw) {
  let event = {};
  try {
    event = JSON.parse(raw || "{}");
  } catch {
    event = {};
  }
  // JSON.parse can yield a non-object (null, number, string, array); coerce to {}.
  if (typeof event !== "object" || event === null || Array.isArray(event)) event = {};
  const toolName = event.tool_name ?? event.toolName ?? event.name ?? event.tool ?? "";
  const toolInput = event.tool_input ?? event.toolInput ?? event.input ?? event.arguments ?? event.args ?? {};
  return { tool_name: String(toolName), tool_input: toolInput && typeof toolInput === "object" ? toolInput : {} };
}

function stripPrefix(text) {
  return String(text || "").replace(/^\[ADG\]\s*(BLOCKED\s*[—-]\s*)?/u, "").trim();
}

// The shared hook fails CLOSED for these (its own contract); the adapter mirrors it.
const MUTATING_TOOLS = new Set(["Bash", "Edit", "Write", "MultiEdit", "NotebookEdit"]);

// Run the shared hook and translate its exit code / output to a uniform decision.
export function decide(event, runner = spawnSync) {
  const res = runner(process.execPath, [hookPath], { input: JSON.stringify(event), encoding: "utf8" });
  if (res.status === 2) {
    return { decision: "deny", reason: stripPrefix(res.stderr) || "denied by ADG deny-by-default policy", exit: 2 };
  }
  if (res.status === 0) {
    let parsed = null;
    try {
      parsed = JSON.parse(res.stdout || "null");
    } catch {
      parsed = null;
    }
    const decision = parsed?.hookSpecificOutput?.permissionDecision;
    const reason = stripPrefix(parsed?.hookSpecificOutput?.permissionDecisionReason);
    if (decision === "ask") return { decision: "ask", reason: reason || "confirmation required", exit: 0 };
    if (decision === "deny") return { decision: "deny", reason: reason || "denied", exit: 2 };
    return { decision: "allow", reason: "", exit: 0 };
  }
  // The hook did not run cleanly (spawn failure, missing file, or an unexpected exit
  // code). Mirror the hook's contract: fail CLOSED for mutating tools, OPEN for reads.
  // A missing or broken gate must never silently allow a destructive action.
  if (MUTATING_TOOLS.has(event.tool_name)) {
    return { decision: "deny", reason: `ADG guardrail hook could not classify this mutating action (failing closed): ${res.error?.message || `hook exit ${res.status}`}`, exit: 2 };
  }
  return { decision: "allow", reason: "", exit: 0 };
}

// CLI entry (skip when imported by the test). Resolve symlinks on both sides:
// path.resolve does not canonicalize symlinks, so on a symlinked install path (e.g.
// macOS /var -> /private/var, or a symlinked host dir) argv[1] and import.meta.url
// would differ and the CLI would silently no-op. realpathSync makes it robust.
function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
  }
}
if (isMainModule()) {
  const result = decide(normalizeEvent(readStdin()));
  const payload = result.decision === "allow" ? { decision: "allow" } : { decision: result.decision, reason: result.reason };
  process.stdout.write(`${JSON.stringify(payload)}\n`);
  process.exit(result.exit);
}
