# ADG Research Gap Analysis — P1–P12 + §9 Open Questions

*What our research (`../loops-research.md`, `agentic-field-map-2026-06-20.md`) covers
vs. what the codebase actually enforces, with a concrete plan per gap.*

**Date:** 2026-06-20 · **Method:** read-only subagent fan-out (P9) over the research,
the field map, `docs/`, and the live code; synthesized single-threaded. Status grades
reuse the audited mapping in `../docs/adg-scorecard.md`. Self-consistent internal audit,
not an independent benchmark.

**Status legend:** `covered` = enforced by a real artifact + test · `partial` = enforced
but with a convention-shaped edge · `gap` = not enforced · `stale` = enforced but the
backing claim/data needs refresh.

---

## Part A — P1–P12 against the field and the code

| Area | Status | Evidence (artifact) | Gap / edge | Opportunity (2026 field) | Proposed plan | Effort / lane | Risk |
|---|---|---|---|---|---|---|---|
| **P1** loop is the product | covered | `packages/{core,sdk,cli}` harness over vendor loops | — | "harnesses > algorithms" shift validates the direction | Keep; document in README as the framing | docs / L1 | low |
| **P2** least autonomy | partial | lanes `delivery-lanes.json` + governor; `work:classify` | lane choice is agent-selected, advisory not enforced | autonomy-slider framing (Karpathy) | Add an advisory→enforced path: a classifier-emitted lane that the governor can read and hold against signoff scope | core+hook / L3 | med (blast radius on stop) |
| **P3** hard stop + authority | covered | `governor.mjs` caps (`loop-budget.json`) + release gate | — | cross-vendor convention (`max_turns`) | Keep; `maxToolCalls` cap not yet enforced in-hook (only `maxTurns`) → wire it | core / L2 | low |
| **P4** context budget | covered | context broker, `context-profiles.yaml`, in-loop hooks (`loop-context.mjs`) | — | context engineering is now the umbrella discipline | Keep; consider per-lane token budgets (ties to §9-Q1) | config / L2 | low |
| **P5** externalize state | covered | SQL backlog + append-only `audit-log.jsonl` + chain | — | filesystem/git-as-memory is the field consensus | Keep; strongest measure | — | low |
| **P6** ground in observation | partial | evidence tiers + backpressure (`backpressure.mjs`) | backpressure hook matches `Bash` only; other tools' failures not fed back | errors-as-observations is load-bearing | Extend backpressure matcher beyond Bash where a failure signal exists | hook / L2 | low |
| **P7** transparent + agent-shaped | covered | audit chain, dashboard, adapter contract, 4 surfaces | — | inspectability now table-stakes | Keep | — | low |
| **P8** error recovery edge | covered | backpressure hook + `backlog:fail` | retry-bounding is via the governor cap, not a dedicated retry budget | reflexion-style retry is a known pattern | Optional: explicit retry budget in `loop-budget.json` | config / L2 | low |
| **P9** multi-agent when isolation pays | covered* | `subagent-gate.mjs` + `adg-subagent-gate-hook.mjs` (shipped 2026-06-20) | *enforced on the Claude hook surface only — Codex adapter + `@adg/sdk` do not yet enforce P9 | single-vs-multi-agent is the live unsettled debate | Port the gate to the Codex lifecycle adapter + `@adg/sdk` (the deferred host-bundling follow-up) | hook+sdk / L3 | med |
| **P10** predictable failure | covered | deterministic policy outside model; fail-closed security / fail-open quality; pinned always-on controls | — | governability now a design value | Keep | — | low |
| **P11** blast radius + untrusted input | covered | deny-by-default risk classes, 3 pinned always-on controls, `ADG_WRITE_SCOPE` | — | injection surface = the feedback edge | Keep; strongest measure | — | low |
| **P12** criterion before loop | covered | elicitation → criteria → evidence tiers → release gate → evals | — | "eval is the bottleneck" (Yao) | Keep; consider a held-out eval for the loop itself, not just per-run | evals / L3 | med |

\* P9 is `covered` on the Claude surface as of 2026-06-20; the cross-adapter port is the
one open edge, tracked in Part A row P9 and Part B Q-cross.

---

## Part B — §9 open questions, each with a plan

| § Open question | Bearing on ADG | Proposed plan | Action? |
|---|---|---|---|
| **Q1** context-rot magnitude is model/task-dependent | `context-profiles.yaml` budgets treat the recall limit as a constant | Make budgets per-lane/per-model tunable; add token-spend telemetry so the budget is measured, not assumed | plan — config / L2 |
| **Q2** termination-by-self-judgment is improving | governor gates "done" on an external verifier (correct for now) | Keep the hard cap always; revisit `warn`-mode self-judgment as models improve — monitor, no change now | monitor — no action |
| **Q3** vector-store memory has receded | ADG is SQL/filesystem-first (already aligned) | Document the stance in README; no build | no action — documented |
| **Q4** code-as-action ~+20% is task-dependent + needs sandbox | ADG governs the loop; it does not execute code-as-action | Out of scope: ADG is a governance layer, not a runtime/sandbox. State the boundary | no action — boundary stated |
| **Q5** star counts / caps are point-in-time | the field map cites star counts | Re-verify on a cadence; field map is dated + GitHub-API-sourced. Candidate for a scheduled quarterly refresh | plan — docs / L1 |
| **Q6** multi-agent 90.2% / 15× are lab-specific | the P9 gate must not hard-code a side | Gate takes no side (bounds cost only); keep magnitudes out of policy | no action — by design |
| **Q-cross** P9 enforced on Claude surface only | Codex adapter + SDK lack the fan-out cap | Port `subagent-gate` to the Codex lifecycle adapter and `@adg/sdk` (see Part A P9) | plan — hook+sdk / L3 |

---

## Coverage check (Step 0 verifier)

- **All 12 principles** P1–P12: covered above, each with a status + plan. ✅
- **All 6 §9 open questions** (Q1–Q6) + the cross-cutting P9-parity item: each has a
  non-empty plan or an explicit "no action — why." ✅

Scope is closed here per the task's hard stop (P3): no expansion beyond the 12
principles and the §9 questions. Concrete, repo-anchored improvements derived from these
gaps are in **`improvement-plan.md`** (Step 1).
