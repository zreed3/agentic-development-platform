#!/usr/bin/env node
// Harness-neutral STOP adapter for the ADG loop governor (Codex and beyond).
//
// The Claude Code Stop/SubagentStop hook (../../hooks/adg-governor-hook.mjs) is the single
// source of the termination + verifier-as-authority decision (P3/P12). This adapter lets any
// OTHER harness reuse that exact decision without depending on Claude Code's event/output
// shapes. It mirrors the pre-tool adapter's design: normalize -> spawn the shared hook ->
// emit a uniform decision in stdout and the exit code.
//
//   {"decision":"block","reason":"..."}   exit 2  (refuse turn-end; model continues)
//   {"decision":"allow"}                  exit 0
//
// The governor is a QUALITY gate, not a security floor: this adapter FAILS OPEN (allow) on a
// spawn failure or any non-2 exit, exactly like the underlying hook.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function resolveHookPath() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env.ADG_GOVERNOR_HOOK,
    path.join(here, "adg-governor-hook.mjs"), // host: adapter + hook both in scripts/
    path.join(process.cwd(), "scripts/adg-governor-hook.mjs"), // host cwd layout
    path.resolve(here, "../../hooks/adg-governor-hook.mjs"), // ADG source tree
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

// Normalize any reasonable stop-event shape to the governor hook's fields.
export function normalizeEvent(raw) {
  let event = {};
  try {
    event = JSON.parse(raw || "{}");
  } catch {
    event = {};
  }
  if (typeof event !== "object" || event === null || Array.isArray(event)) event = {};
  return {
    stop_hook_active: Boolean(event.stop_hook_active ?? event.stopHookActive ?? false),
    session_id: String(event.session_id ?? event.sessionId ?? ""),
  };
}

function stripPrefix(text) {
  return String(text || "").replace(/^\[ADG governor\]\s*/u, "").trim();
}

export function decide(event, runner = spawnSync) {
  const res = runner(process.execPath, [hookPath], { input: JSON.stringify(event), encoding: "utf8" });
  if (res.status === 2) {
    return { decision: "block", reason: stripPrefix(res.stderr) || "release-gate violation; record a 'live' event before ending", exit: 2 };
  }
  // exit 0 OR any error: the governor is a quality gate -> fail open (allow).
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
  const payload = result.decision === "allow" ? { decision: "allow" } : { decision: result.decision, reason: result.reason };
  process.stdout.write(`${JSON.stringify(payload)}\n`);
  process.exit(result.exit);
}
