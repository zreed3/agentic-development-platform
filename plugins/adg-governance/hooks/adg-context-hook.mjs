#!/usr/bin/env node
// ADG context-inject — UserPromptSubmit hook. Prepends a one-line steering header naming the
// active backlog item, its write scope, and the signoff gate, so context discipline (P2/P4)
// is structural rather than a remembered step. Additive and fail-open: injects nothing when
// there is no active item or on any error.

import fs from "node:fs";
import { buildSteeringHeader } from "../../../packages/core/loop-context.mjs";
import { queryActiveItem } from "./adg-backlog-read.mjs";

try {
  try {
    JSON.parse(fs.readFileSync(0, "utf8") || "{}");
  } catch {
    /* prompt body not needed for the header */
  }
  const activeItem = queryActiveItem(process.cwd());
  const header = buildSteeringHeader({ activeItem });
  if (header) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: header },
      }),
    );
  }
  process.exit(0);
} catch {
  process.exit(0); // fail open
}
