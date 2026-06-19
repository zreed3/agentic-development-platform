#!/usr/bin/env node
// ADG backpressure — PostToolUse hook (matcher: Bash). When a verification command
// (test/build/lint/typecheck) just failed, inject the failure back as a first-class
// observation the model must address (P8), and drop a marker in .adg/ so later signoff
// logic can see a check is red. Additive and fail-open: emits context, never blocks.

import fs from "node:fs";
import path from "node:path";
import { backpressureDecision } from "../../../packages/core/backpressure.mjs";

function emitContext(text) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: text },
    }),
  );
  process.exit(0);
}

try {
  let event = {};
  try {
    event = JSON.parse(fs.readFileSync(0, "utf8") || "{}");
  } catch {
    event = {};
  }
  const input = event.tool_input || {};
  const resp = event.tool_response || event.tool_result || {};

  // Normalize the exit status / output across the field names a runtime might use.
  const exitCode = [resp.exit_code, resp.exitCode, resp.returnCode, resp.code].find((v) =>
    Number.isFinite(v),
  );
  const output = [resp.stdout, resp.stderr, resp.output, typeof resp === "string" ? resp : ""]
    .filter(Boolean)
    .join("\n");

  const decision = backpressureDecision({
    toolName: event.tool_name,
    command: input.command,
    exitCode,
    output,
  });

  if (!decision.surface) process.exit(0);

  // Best-effort marker (never fail the hook on a write error).
  try {
    const dir = path.join(process.cwd(), ".adg");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "backpressure.json"),
      JSON.stringify({ command: decision.command, session: event.session_id || "default" }),
    );
  } catch {
    /* ignore */
  }

  emitContext(`[ADG backpressure] ${decision.reason}`);
} catch {
  process.exit(0); // fail open
}
