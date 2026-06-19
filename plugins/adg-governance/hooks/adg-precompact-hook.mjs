#!/usr/bin/env node
// ADG pin — PreCompact hook. Before the window is compacted, re-state the durable state that
// MUST survive the reset: the active item, its acceptance criterion, and the tamper-evident
// audit-chain tip (P4/P5). Additive and fail-open.

import fs from "node:fs";
import { buildPinContext } from "../../../packages/core/loop-context.mjs";
import { queryActiveItem, readAuditTip } from "./adg-backlog-read.mjs";

try {
  try {
    JSON.parse(fs.readFileSync(0, "utf8") || "{}");
  } catch {
    /* no fields needed */
  }
  const cwd = process.cwd();
  const text = buildPinContext({
    activeItem: queryActiveItem(cwd),
    auditHead: readAuditTip(cwd),
    criterion: null,
  });
  if (text) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: { hookEventName: "PreCompact", additionalContext: text },
      }),
    );
  }
  process.exit(0);
} catch {
  process.exit(0); // fail open
}
