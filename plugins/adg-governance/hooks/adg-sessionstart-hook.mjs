#!/usr/bin/env node
// ADG rehydrate — SessionStart hook. On a fresh session, recover the loop's durable state
// from disk (the Ralph fresh-context restart pattern, P5): the active item, the last audit
// event, and whether a fix plan exists. Also resets the governor's per-session turn counter.
// Additive and fail-open.

import fs from "node:fs";
import path from "node:path";
import { buildRehydrateContext } from "../../../packages/core/loop-context.mjs";
import { queryActiveItem, readLastAudit, fixPlanPath } from "./adg-backlog-read.mjs";

try {
  let event = {};
  try {
    event = JSON.parse(fs.readFileSync(0, "utf8") || "{}");
  } catch {
    event = {};
  }
  const cwd = process.cwd();

  // Reset this session's governor turn counter so the failsafe ceiling counts a fresh run.
  try {
    const file = path.join(cwd, ".adg", "governor-state.json");
    const state = JSON.parse(fs.readFileSync(file, "utf8"));
    if (event.session_id && state[event.session_id]) {
      delete state[event.session_id];
      fs.writeFileSync(file, JSON.stringify(state));
    }
  } catch {
    /* no state yet — nothing to reset */
  }

  const text = buildRehydrateContext({
    activeItem: queryActiveItem(cwd),
    lastAudit: readLastAudit(cwd),
    fixPlan: fixPlanPath(cwd),
  });
  if (text) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: text },
      }),
    );
  }
  process.exit(0);
} catch {
  process.exit(0); // fail open
}
