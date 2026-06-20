# ADG Scorecard — P1–P12 Agent-Loop Principles

*How the Agentic Development Platform scores against the twelve agent-loop design
principles in [`../loops-research.md`](../loops-research.md), graded against the
current build and the field as mapped in
[`../research/agentic-field-map-2026-06-20.md`](../research/agentic-field-map-2026-06-20.md).*

**Date:** 2026-06-20 · **Scope:** ADG 2.0 (governed harness + SDK over the vendor
agent loops). Grades are an internal self-audit against ADG's own framework using the
build artifacts on disk — self-consistent, not an independent benchmark.

---

## Summary

ADG 2.0 turned a governance *overlay* (one PreToolUse hook) into a *governed harness*.
The transformation is concentrated exactly where the research said an overlay was blind
— the loop-mechanics principles a PreToolUse guardrail structurally cannot touch
(**P1, P3, P8**, with **P4** moving from a pre-read to in-loop). Roughly **9 of 12**
measures now sit at **A / A−**, up from ~5 pre-2.0. The one measure still on guidance
rather than code is **P9 (multi-agent)** — addressed by the subagent budget gate
shipped alongside this scorecard (see [Subsequent work](#subsequent-work)).

---

## Scorecard

| # | Principle | Pre-2.0 | Now | What backs the grade |
|---|---|---|---|---|
| **P1** | Loop is the product, model is a component | C | **A** | All of `packages/{core,sdk,cli}` is loop machinery layered over the vendor SDKs — governor, backpressure, context hooks, model orchestrator. |
| **P2** | Least autonomy that solves the problem | B | **A−** | Proofline lanes L0–L4 + governor `ask`-off-sensitive / `block`-on-`release-class:*`. Autonomy dial is policy-as-code; lane choice still partly agent-driven. |
| **P3** | Hard stop + external authority for success | D | **A−** | `loop-budget.json` `maxTurns` hard cap via the Stop/SubagentStop governor (`maxToolCalls` is declared but not yet enforced — see improvement I1); release gate refuses turn-end on a `release-class:*` item signed off without `live` evidence. |
| **P4** | Context as a finite attention budget | B | **A** | Context broker + `context-profiles.yaml` + packets + `forbiddenBulkFiles`, plus in-loop hooks: backpressure, context-inject, precompact pin, sessionstart rehydrate. |
| **P5** | Externalize durable state to FS + git | A | **A** | SQL backlog rebuilt from seed; append-only `audit-log.jsonl` with hash chain; git-tracked mirrors. |
| **P6** | Ground every iteration in real observation | B− | **A−** | Evidence tiers `asserted < config < test < live` make "observed in the running system" first-class and gated; backpressure feeds `Bash` failures back (extension to other tools is improvement I2). Per-tool-error reaction still partly convention. |
| **P7** | Transparent loop + agent-shaped interface | A− | **A** | Tamper-evident audit chain, read-only dashboard, adapter contract, 4 surfaces + slash commands. |
| **P8** | Error recovery as a loop edge (backpressure) | D | **A−** | Phase-2 backpressure hook + `backlog:fail` turn failed checks into next-iteration observations. Retry-bounding via the governor cap. |
| **P9** | Multi-agent only when isolation pays | C+ | **A− (Claude surface)** | Was guidance-only in CLAUDE.md. Now enforced by the subagent budget gate (`packages/core/subagent-gate.mjs` + `PreToolUse/Task` hook) capping fan-out and total spawns — **on the Claude hook surface only**; Codex adapter + `@adg/sdk` enforcement is deferred (improvement I3). See below. |
| **P10** | Predictable failure over unpredictable success | A | **A** | Deterministic policy outside the model; security hook fails **closed**, quality hooks fail **open**; always-on controls pinned in code. |
| **P11** | Bound action space by blast radius; observations untrusted | A | **A** | Deny-by-default risk classes, three pinned always-on controls, `ADG_WRITE_SCOPE` (hardened over 13 adversarial rounds). |
| **P12** | Success criterion before the loop; eval is the bottleneck | A− | **A** | Elicitation → acceptance criteria → evidence tiers → release gate → eval scenarios. The verifier that gates "done" is authored before the work. |

---

## How the field map informs the grades

The 2026 field convergence documented in the field map maps directly onto the
principles ADG scores highest on:

- **Durable state outside the context window** (Anthropic `claude-progress.txt` + git;
  Anthropic Memory store for >200k-token plans) — ADG's **P5** (SQL backlog + audit log).
- **Hard caps + agent-decided "more work?"** (OpenAI `max_turns`/`MaxTurnsExceeded`;
  Anthropic stopping conditions) — ADG's **P3** (governor caps + release gate).
- **Context engineering as the umbrella** (Chase; Anthropic) — ADG's **P4**
  (context broker + in-loop hooks).
- **The unsettled single-vs-multi-agent axis** (Cognition's "don't build multi-agents"
  vs. Anthropic's orchestrator-worker) — ADG's **P9**, the measure that motivated the
  subagent budget gate.

---

## Subsequent work

P9 was the only measure still governed by prose rather than code. The **subagent budget
gate** closes it **on the Claude hook surface** (shipped 2026-06-20): a quality gate
(fails open, like the governor) that bounds subagent fan-out at the spawn point.
Cross-adapter enforcement (Codex lifecycle adapter + `@adg/sdk`) is deferred as
improvement **I3** — which is why the grade is `A− (Claude surface)`, not a flat A.
Informed by the live single-vs-multi-agent debate in the field map — Cognition argues
parallel subagents make conflicting implicit decisions, while Anthropic's
orchestrator-worker self-reports a large (but internal, unreproduced) gain — ADG does not
pick a side: it bounds the *cost/blast-radius* of fan-out (`maxConcurrent`, `maxTotal`)
and leaves the topology choice to the operator, defaulting to `warn` so it advises before
it blocks. The per-session counter is best-effort and non-atomic (see I9), so under
concurrent spawns the cap may be exceeded slightly — failing in the safe (allow)
direction, never trapping the agent.
