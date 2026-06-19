// ADG loop governor — pure decision for the Stop / SubagentStop hook.
//
// Two loop-design first principles, enforced outside the model:
//   P3  termination: a loop needs a hard ceiling AND an external authority for "done".
//   P12 verification: "done" is decided by an external verifier (the release gate / the
//        required evidence tier), not the model's self-report.
//
// The governor is a QUALITY gate, not a security floor. The deny-by-default PreToolUse hook
// is the security floor; this only refuses to let a turn END while a release-class item has
// been signed off (status `verified`) without a `live` evidence event. Callers MUST fail
// OPEN (allow the stop) on any error — a quality gate that traps the agent on its own bug is
// worse than one that yields. It also yields whenever the stop is already a stop-hook
// continuation, so it nudges at most once per genuine stop and can never trap the loop.

export const GOVERNOR_MODES = new Set(["block", "warn", "off"]);

/**
 * Decide whether to allow turn-end.
 * @param {object} s
 * @param {boolean} [s.stopHookActive]  the stop is already a stop-hook continuation
 * @param {number}  [s.turnCount]       stops seen this session (drives the failsafe ceiling)
 * @param {object}  [s.caps]            { maxTurns }
 * @param {Array}   [s.violations]      release_gate_violations rows ([{item_id,...}])
 * @param {string}  [s.mode]            block | warn | off
 * @returns {{action:'block'|'allow', reason:string, advisory?:boolean}}
 */
export function governorDecision(s = {}) {
  const mode = GOVERNOR_MODES.has(s.mode) ? s.mode : "block";
  const violations = Array.isArray(s.violations) ? s.violations : [];
  const turnCount = Number.isFinite(s.turnCount) ? s.turnCount : 0;
  const maxTurns = s.caps && Number.isFinite(s.caps.maxTurns) ? s.caps.maxTurns : 0;

  // Never trap the agent: once already continued by a stop hook, or past the ceiling, yield.
  if (s.stopHookActive) {
    return { action: "allow", reason: "stop_hook_active: governor yields to avoid a trap loop" };
  }
  if (maxTurns && turnCount >= maxTurns) {
    return { action: "allow", reason: `turn ceiling ${maxTurns} reached (failsafe); governor yields` };
  }
  if (mode === "off" || violations.length === 0) {
    return { action: "allow", reason: "no release-gate violations within caps" };
  }

  const ids = violations.map((v) => v.item_id || v.id).filter(Boolean).join(", ");
  const detail = `${violations.length} release-class item(s) signed off without a 'live' event: ${ids}`;
  if (mode === "warn") {
    return { action: "allow", advisory: true, reason: `advisory (release gate): ${detail}` };
  }
  return {
    action: "block",
    reason:
      `release gate: ${detail}. Record a 'live' event ` +
      `(npm run backlog:verify -- --item <id> --tier live, or npm run audit:record ... --tier live) ` +
      `or revert the verified status before ending the turn.`,
  };
}
