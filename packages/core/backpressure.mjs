// ADG backpressure — pure detection for the PostToolUse hook.
//
// P8: errors are signal, not exceptions to swallow. When a verification command (test /
// build / lint / typecheck) FAILS, the loop must feed that failure back as a first-class
// observation the model has to react to, rather than letting a broken result slide into the
// next iteration. This module decides whether a just-finished Bash command was a failing
// verification; the hook turns a positive into an injected observation and a marker file.

const CHECK_RE =
  /\b(npm\s+(run\s+)?(test|build|lint|typecheck|check|ci[:\w-]*)|pnpm\s+(run\s+)?(test|build|lint)|yarn\s+(test|build|lint)|jest|vitest|mocha|playwright\s+test|pytest|tox|nox|cargo\s+(test|build|clippy)|go\s+test|gotest|tsc\b|eslint|biome\s+(check|lint)|ruff\s+check|mvn\s+(test|verify)|gradle\s+(test|check)|make\s+(test|check|lint))\b/i;

export function isVerificationCommand(command) {
  return CHECK_RE.test(String(command || ""));
}

const FAILURE_MARKER =
  /\b(FAIL|FAILED|Tests?\s+failed|Traceback|AssertionError|not ok\s|✗|✖|ERR!|error TS\d+|panic:|BUILD FAILED|compilation failed)\b/i;

/**
 * @param {object} r
 * @param {string} [r.toolName]
 * @param {string} [r.command]
 * @param {number} [r.exitCode]   exit status if the runtime exposed it (preferred signal)
 * @param {string} [r.output]     combined stdout+stderr (fallback signal)
 * @returns {{surface:boolean, reason?:string, command?:string}}
 */
export function backpressureDecision(r = {}) {
  if (r.toolName && r.toolName !== "Bash") return { surface: false };
  if (!isVerificationCommand(r.command)) return { surface: false };

  // Prefer the exit code when the runtime gave us one; only fall back to output markers when
  // the exit status is unknown, so a passing run that merely prints the word "fail" in a test
  // name does not trip an advisory.
  let failed;
  if (Number.isFinite(r.exitCode)) failed = r.exitCode !== 0;
  else failed = FAILURE_MARKER.test(String(r.output || ""));

  if (!failed) return { surface: false };
  const cmd = String(r.command || "").trim();
  const shown = cmd.length > 140 ? `${cmd.slice(0, 140)}…` : cmd;
  return {
    surface: true,
    command: cmd,
    reason:
      `a verification command failed: \`${shown}\`. Treat this as a required observation — ` +
      `diagnose and fix the cause, then re-run it green before recording completion or signing ` +
      `off. Do not record this item as complete/verified while the check is red.`,
  };
}
