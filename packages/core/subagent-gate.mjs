// ADG subagent budget gate — pure decision for the PreToolUse/Task spawn hook.
//
// Loop-design first principle, enforced outside the model:
//   P9  multi-agent: reach for sub-agents only when isolation/parallelism pays for the
//       token and coordination cost. The structural failure mode is token blowup and
//       coordination overhead from unbounded fan-out.
//
// The gate is a QUALITY gate, not a security floor. It does NOT decide WHETHER a given
// task should be a subagent (a judgment the model makes) — it bounds the COST/blast
// radius of fan-out: how many subagents run at once (maxConcurrent) and how many are
// spawned per session (maxTotal). It deliberately takes no side in the single-vs-multi
// -agent debate; it caps runaway fan-out and leaves topology to the operator.
//
// Callers MUST fail OPEN (allow the spawn) on any error — a quality gate that traps the
// agent on its own bug is worse than one that yields. Default mode is `warn`: advise
// before blocking, because a brand-new fan-out cap has cross-adapter blast radius.

export const SUBAGENT_GATE_MODES = new Set(["block", "warn", "off"]);

/**
 * Decide whether to allow a subagent spawn, given the post-increment counts.
 * @param {object} s
 * @param {number} [s.activeCount]  subagents currently active (incl. the one being spawned)
 * @param {number} [s.totalCount]   subagents spawned this session (incl. this one)
 * @param {object} [s.caps]         { maxConcurrent, maxTotal } (0/absent = that cap off)
 * @param {string} [s.mode]         block | warn | off  (default warn)
 * @returns {{action:'allow'|'block', reason:string, advisory?:boolean}}
 */
export function subagentGateDecision(s = {}) {
  const mode = SUBAGENT_GATE_MODES.has(s.mode) ? s.mode : "warn";
  const active = Number.isFinite(s.activeCount) ? s.activeCount : 0;
  const total = Number.isFinite(s.totalCount) ? s.totalCount : 0;
  const maxConcurrent = s.caps && Number.isFinite(s.caps.maxConcurrent) ? s.caps.maxConcurrent : 0;
  const maxTotal = s.caps && Number.isFinite(s.caps.maxTotal) ? s.caps.maxTotal : 0;

  if (mode === "off") {
    return { action: "allow", reason: "subagent gate off" };
  }

  const breaches = [];
  if (maxConcurrent && active > maxConcurrent) {
    breaches.push(`concurrent fan-out ${active} exceeds cap ${maxConcurrent}`);
  }
  if (maxTotal && total > maxTotal) {
    breaches.push(`total subagents ${total} exceeds cap ${maxTotal}`);
  }

  if (breaches.length === 0) {
    return { action: "allow", reason: "within subagent budget" };
  }

  const detail = breaches.join("; ");
  if (mode === "warn") {
    return { action: "allow", advisory: true, reason: `advisory (P9 subagent budget): ${detail}` };
  }
  return {
    action: "block",
    reason:
      `P9 subagent budget: ${detail}. Let running subagents finish before spawning more, ` +
      `do this work in the coordinating agent, or raise the cap in config/agentic/loop-budget.json ` +
      `(subagents.caps) if the isolation genuinely pays for the token cost.`,
  };
}
