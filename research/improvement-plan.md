# ADG Improvement Plan — repo-anchored, testable

*Turns each gap in `gap-analysis.md` into a specific, verifiable improvement. Plan only —
nothing here is implemented. Each item names the file(s), the external verifier that
would prove it (P12), lane/risk, and rollback.*

**Date:** 2026-06-20 · **Rule:** every actionable Step 0 gap has ≥1 anchored improvement;
every non-action is an explicit "no action — why." **Mechanical** = config/docs (no
behavior change). **Behavioral** = hook/policy change → needs negative tests + an
`agent:evals` scenario (P6/P11).

---

## Behavioral improvements (need negative tests + evals)

### I1 — Enforce `maxToolCalls`, not just `maxTurns` (P3)
- **Why:** `loop-budget.json` declares `caps.maxToolCalls: 500`, but `governor.mjs` only
  consumes `caps.maxTurns` (confirmed: governor reads `s.caps.maxTurns` only). The
  tool-call ceiling is dead config — a hard-stop ADG claims but does not enforce.
- **Files:** `packages/core/governor.mjs` (read+honor `maxToolCalls`), the governor hook
  (`adg-governor-hook.mjs`) to track a per-session tool-call count, `tooling/adg-as-code/test-governor.mjs`.
- **Verifier:** new unit cases — `toolCallCount >= maxToolCalls` → failsafe yield, named
  in reason; existing cases stay green; `npm run test:governor`.
- **Lane / risk:** L3 · med (governor is a stop-gate; must stay fail-open).
- **Rollback:** revert the three files; config value is inert without the code.

### I2 — Extend backpressure beyond `Bash` (P6)
- **Why:** the PostToolUse backpressure hook matches `Bash` only (confirmed in
  `hooks.json`); failed checks run through other tools aren't fed back as observations.
- **Files:** `plugins/adg-governance/hooks/hooks.json` (widen matcher where a failure
  signal exists), `packages/core/backpressure.mjs` (recognize more failure shapes),
  `tooling/adg-as-code/test-loop-hooks.mjs`.
- **Verifier:** `npm run test:loop-hooks` with new cases for the added tool shapes; an
  `agent:evals` scenario asserting a failed check surfaces as an observation.
- **Lane / risk:** L2 · low (additive, fails open).
- **Rollback:** revert matcher to `Bash`.

### I3 — Port the P9 subagent gate to Codex + `@adg/sdk` (P9 cross-parity)
- **Why:** the fan-out cap is enforced only on the Claude hook surface; the Codex
  lifecycle adapter and `@adg/sdk` don't enforce P9. This is the deferred Phase 6
  host-bundling follow-up (relative `../../../packages/core` import needs a bundler).
- **Files:** `plugins/adg-governance/.codex-plugin/hooks/` (a `adg-codex-subagent` adapter
  delegating to `subagent-gate.mjs`), `packages/sdk/claude.mjs` + `openai.mjs`
  (`loopCaps`/guardrail path applies the fan-out cap), SDK tests.
- **Verifier:** `npm run test:sdk` + a Codex lifecycle test mirroring the Claude smoke
  (3rd concurrent spawn blocked); `npm run ci:governance`.
- **Lane / risk:** L3 · med (touches installer file-list + adapters — land with install
  tests green; do not carry a relaxed control forward).
- **Rollback:** the gate stays Claude-only (current state); revert adapter + sdk edits.

### I4 — Advisory→enforced lane (P2)
- **Why:** `work:classify` emits a lane but nothing holds the agent to it; lane choice is
  convention. P2 wants the least-autonomy dial to bite.
- **Files:** `packages/core/governor.mjs` or a new `packages/core/lane-gate.mjs`,
  `config/agentic/delivery-lanes.json`, a hook + test.
- **Verifier:** unit cases — a signoff claim under a lane whose evidence floor isn't met
  → block/advisory by mode; negative tests; `agent:evals` scenario.
- **Lane / risk:** L3 · med (new stop-edge; default `warn` like the subagent gate).
- **Rollback:** revert; lane stays advisory.

---

## Mechanical improvements (config/docs)

### I5 — Per-lane / per-model context budgets (P4, §9-Q1)
- **Why:** `context-profiles.yaml` treats the recall limit as a constant; §9-Q1 says it's
  model/task-dependent.
- **Files:** `config/agentic/context-profiles.yaml` (per-lane budgets), optional
  token-spend telemetry in the context broker.
- **Verifier:** `npm run test:agent-context` (broker honors the per-lane budget);
  `npm run context:slice` output reflects it.
- **Lane / risk:** L2 · low. **Rollback:** revert to single budget.

### I6 — Unit-test `policy-client.mjs` (component hygiene)
- **Why:** `policy-client.mjs` is the SDK's action-gate delegation path but has no direct
  unit test (only indirect via `test:sdk`).
- **Files:** new `tooling/adg-as-code/test-policy-client.mjs`; wire into `ci:governance`.
- **Verifier:** the new test runs in the chain; asserts subprocess allow/deny/ fail-closed.
- **Lane / risk:** L2 · low. **Rollback:** drop the test + chain entry.

### I7 — Scheduled field-map refresh (§9-Q5)
- **Why:** star counts / caps are point-in-time; the field map should not rot silently.
- **Files:** `research/agentic-field-map-*.md` (dated snapshots); optionally a `/schedule`
  routine to re-run the deep-research + GitHub-API pass quarterly.
- **Verifier:** a fresh dated file exists; `adg:doctor` stays clean (no volatile
  provenance in tracked docs).
- **Lane / risk:** L1 · low. **Rollback:** none needed (additive snapshots).

### I8 — Held-out loop eval (P12)
- **Why:** evals gate per-run behavior; there's no held-out eval for the *loop itself*
  (Yao's "eval is the bottleneck").
- **Files:** `tooling/agent-evals/scenarios/` (a loop-level scenario set).
- **Verifier:** `npm run agent:evals` includes the new scenarios and passes.
- **Lane / risk:** L3 · med (defines the success criterion — get it right first).
- **Rollback:** remove the scenarios.

### I9 — Lost-update-free subagent counter (P9 robustness)
- **Why:** the subagent gate (and the governor's turn counter) use a non-atomic
  read-modify-write on `.adg/*-state.json`; under simultaneous spawns an increment can be
  lost, so the fan-out cap may be exceeded slightly. Today the write is atomic
  (temp-file + rename, so no torn read) and the undercount errs toward ALLOW (fail-open,
  never traps) — but the count is not lost-update-free.
- **Files:** `plugins/adg-governance/hooks/adg-subagent-gate-hook.mjs` (and the governor
  hook's `bumpTurnCount`); a small file-lock or atomic-counter helper in `packages/core`.
- **Verifier:** a concurrency test spawning N gate processes against one session asserts
  the final count equals N; `npm run test:subagent-gate`.
- **Lane / risk:** L2 · low (best-effort → exact; safe direction already holds).
- **Rollback:** revert to the current best-effort counter.

---

## No action — explicit rationale

| Item | Why no action |
|---|---|
| **§9-Q2** self-judgment termination | Governor already gates on an external verifier; the hard cap stays regardless. Monitor as models improve; no change warranted now. |
| **§9-Q3** vector-store memory | ADG is SQL/filesystem-first — already the field-consensus stance. Document, don't build. |
| **§9-Q4** code-as-action sandbox | ADG governs the loop; it is not a runtime/sandbox. Out of scope by design; state the boundary in the README. |
| **§9-Q6** multi-agent 90.2%/15× | The P9 gate bounds cost and takes no side; keeping lab-specific magnitudes out of policy is correct. |
| **P5, P7, P10, P11** | `covered` with tests; no gap. Keep. |

---

## Step 1 verifier

Every actionable gap in `gap-analysis.md` (P2, P3, P4, P6, P8, P9-parity, P12, Q1, Q5)
maps to ≥1 anchored, testable improvement (I1–I8). Every remaining §9 question and every
`covered` principle has an explicit "no action — why." ✅ Implementation deferred — this
is the plan only.
