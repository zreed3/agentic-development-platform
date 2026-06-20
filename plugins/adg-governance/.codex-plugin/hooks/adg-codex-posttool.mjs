#!/usr/bin/env node
// Harness-neutral POST-TOOL adapter for ADG backpressure (Codex and beyond).
//
// The Claude Code PostToolUse hook (../../hooks/adg-backpressure-hook.mjs) is the single
// source of the "a verification command failed -> feed it back as an observation" decision
// (P8). This adapter lets any OTHER harness reuse it without depending on Claude Code's
// event/output shapes. Additive and fail-open: it only ever surfaces an observation.
//
//   {"decision":"observe","context":"[ADG backpressure] ..."}   exit 0
//   {"decision":"allow"}                                         exit 0

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function resolveHookPath() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env.ADG_BACKPRESSURE_HOOK,
    path.join(here, "adg-backpressure-hook.mjs"),
    path.join(process.cwd(), "scripts/adg-backpressure-hook.mjs"),
    path.resolve(here, "../../hooks/adg-backpressure-hook.mjs"),
  ].filter(Boolean);
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
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

// Normalize any reasonable post-tool event to the backpressure hook's fields.
export function normalizeEvent(raw) {
  let event = {};
  try {
    event = JSON.parse(raw || "{}");
  } catch {
    event = {};
  }
  if (typeof event !== "object" || event === null || Array.isArray(event)) event = {};
  const toolName = event.tool_name ?? event.toolName ?? event.name ?? event.tool ?? "";
  const toolInput = event.tool_input ?? event.toolInput ?? event.input ?? event.arguments ?? event.args ?? {};
  const toolResponse = event.tool_response ?? event.toolResponse ?? event.tool_result ?? event.result ?? event.output ?? {};
  return {
    tool_name: String(toolName),
    tool_input: toolInput && typeof toolInput === "object" ? toolInput : {},
    tool_response: toolResponse && typeof toolResponse === "object" ? toolResponse : { output: String(toolResponse || "") },
  };
}

export function decide(event, runner = spawnSync) {
  const res = runner(process.execPath, [hookPath], { input: JSON.stringify(event), encoding: "utf8" });
  if (res.status === 0 && res.stdout) {
    try {
      const parsed = JSON.parse(res.stdout);
      const context = parsed?.hookSpecificOutput?.additionalContext;
      if (context) return { decision: "observe", context, exit: 0 };
    } catch {
      /* fall through to allow */
    }
  }
  return { decision: "allow", reason: "", exit: 0 };
}

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
  const payload = result.decision === "observe" ? { decision: "observe", context: result.context } : { decision: "allow" };
  process.stdout.write(`${JSON.stringify(payload)}\n`);
  process.exit(result.exit);
}
