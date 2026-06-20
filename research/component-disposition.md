# ADG Component Disposition — KEEP / UPDATE / RETIRE / REPLACE

*A bounded walk over every harness/code component, with a disposition grounded in real
observation (its own test, or its wiring into `ci:governance`) — not memory.*

**Date:** 2026-06-20 · **Method:** component inventory from the filesystem +
test/ci-wiring confirmed by a read-only subagent (P9) and `package.json`. Work-list built
first (P12); single disposition per component (P3 hard cap = the enumerated list, no
scope creep). Cross-referenced against the Phase 0–7 build table and the two deferred
follow-ups in `../docs/adg-2.0-overhaul-plan.md`.

**Dispositions:** **KEEP** = load-bearing, tested/wired · **UPDATE** = drift / missing
test / stale · **RETIRE** = superseded · **REPLACE** = swap implementation.

---

## packages/core

| Component | Role | Evidence / test | Disposition | Rationale / follow-up |
|---|---|---|---|---|
| `governor.mjs` | P3 hard stop + P12 release-gate authority | `test:governor` (in ci) | **KEEP** | Load-bearing. Follow-up I1: also enforce `maxToolCalls` (currently dead config). |
| `backpressure.mjs` | P8 failed-check → observation | `test:loop-hooks` (in ci) | **KEEP** | Follow-up I2: extend beyond `Bash`. |
| `loop-context.mjs` | P4/P5 steer / pin / rehydrate | `test:loop-hooks` (in ci) | **KEEP** | — |
| `select-model.mjs` | P-tier effort-first model selection | `test:select-model` (in ci) | **KEEP** | — |
| `subagent-gate.mjs` | P9 fan-out cost cap | `test:subagent-gate` (in ci, new 2026-06-20) | **KEEP** | Follow-up I3: port to Codex + SDK. |
| `backlog-read.mjs` | Fail-soft reads of durable state | Indirect via `test:adg-hook` | **KEEP** | Used by hooks; chain-covered. |
| `policy-client.mjs` | SDK action-gate delegation to the hardened hook | No **direct** test (indirect via `test:sdk`) | **UPDATE** | Follow-up I6: add `test-policy-client.mjs` (subprocess allow/deny/fail-closed). |

## packages/sdk

| Component | Role | Evidence / test | Disposition | Rationale |
|---|---|---|---|---|
| `claude.mjs` | Claude Agent SDK adapter (canUseTool + hooks + model) | `test:sdk` (in ci) | **KEEP** | Follow-up I3 (P9 in SDK). |
| `openai.mjs` | OpenAI Agents SDK adapter (guardrails + RunHooks + model_settings) | `test:sdk` (in ci) | **KEEP** | Follow-up I3. |
| `index.mjs` | SDK entry / re-exports | `test:sdk` (in ci) | **KEEP** | — |

## packages/cli

| Component | Role | Evidence / test | Disposition | Rationale |
|---|---|---|---|---|
| `adg.mjs` | Terminal surface; dispatcher over ADG scripts | `test:adg-cli` (in ci) | **KEEP** | — |

## plugins/adg-governance/hooks

| Component | Role | Evidence / test | Disposition | Rationale |
|---|---|---|---|---|
| `adg-guardrail-hook.mjs` | PreToolUse security floor (deny-by-default) | `test:adg-hook` + `test:adg-write-scope` (in ci) | **KEEP** | The deterministic security floor; best-tested. |
| `adg-governor-hook.mjs` | Stop/SubagentStop → governor | chain-tested; core has `test:governor` | **KEEP** | Follow-up I1. |
| `adg-backpressure-hook.mjs` | PostToolUse → backpressure | core has `test:loop-hooks` | **KEEP** | Follow-up I2. |
| `adg-context-hook.mjs` | UserPromptSubmit → steer | core has `test:loop-hooks` | **KEEP** | — |
| `adg-precompact-hook.mjs` | PreCompact → pin | core has `test:loop-hooks` | **KEEP** | — |
| `adg-sessionstart-hook.mjs` | SessionStart → rehydrate | core has `test:loop-hooks` | **KEEP** | — |
| `adg-subagent-gate-hook.mjs` | PreToolUse(Task)/SubagentStop → P9 cap | core has `test:subagent-gate`; live smoke done | **KEEP** | Follow-up I3. |
| `adg-backlog-read.mjs` | Shared fail-soft reads for hooks | Indirect via `test:adg-hook` | **KEEP** | Helper mirror of core. |
| `test-adg-guardrail-hook.mjs` | Hook test fixture | runs as `test:adg-hook` | **KEEP** | Test asset. |

## config/agentic/*.json

All eleven are policy-as-code, each validated by a dedicated gate wired into
`ci:governance` — **KEEP** across the board:

| Config | Validated by |
|---|---|
| `guardrails.json` | `guardrails:check` |
| `loop-budget.json` | `test:governor` / `test:subagent-gate` |
| `models.json` | `test:select-model` |
| `delivery-lanes.json` | lane selection (`work:classify`) |
| `context-profiles.yaml`† | `test:agent-context` |
| `elicitation.json` | `elicitation:validate` |
| `ux-as-code.json` | `ux:validate` |
| `standards-map.json` | `standards:validate` |
| `artifact-types.json` / `deliverables.json` | `deliverable:audit` |
| `maturity.json` | `maturity:validate` |
| `skill-manifest.json` | `skills:validate` |

† `context-profiles.yaml` is YAML, listed for completeness. Follow-up I5: per-lane budgets.

---

## Phase 0–7 build table + deferred follow-ups

| Phase | Delivered | Disposition |
|---|---|---|
| 1 governor · 2 hook pack · 3 model orchestrator · 4 adapter contract · 5 `@adg/sdk` · 6 distribution · 7 surface parity | all ✅, all in `ci:governance` | **KEEP** |
| **0 in-process PolicyEngine** | deferred — satisfied today by `policy-client.mjs` subprocess delegation | **REPLACE (deferred)** | Pure in-process engine is a perf optimization; would replace the subprocess hop. Not done unattended (touches the security-critical hook). |
| **6 host-bundling of new lifecycle hooks** | deferred — relative `../../../packages/core` imports need a bundler + installer file-list change | **UPDATE (deferred)** | Lands the new hooks into host installs; do with install tests green. Overlaps I3. |

**No RETIRE:** every component is load-bearing and recent (ADG 2.0 fresh canon); nothing
is superseded.

---

## Step 2 verifier

- Every enumerated component (7 core + 3 sdk + 1 cli + 9 hook files + 11 configs) has a
  disposition. ✅
- Gate results (2026-06-20): `npm run ci:governance` → **EXIT 0** (full chain green);
  `npm run adg:doctor` → **ok, 6/6 checks**. ✅
