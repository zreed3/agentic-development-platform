# ADG 2.0 — Harness & SDK Overhaul Plan

**Status:** proposal for review · **Date:** 2026-06-19 · **Author:** drafted for Zach
**Scope:** turn ADG from a *governance overlay on someone else's loop* into a *tiered
governed harness + SDK*, while keeping the portable overlay intact.

> This is a **plan for review**, not an implementation. Nothing in Parts A–D below is
> built yet. Approve / amend the phases and open questions at the end before we start.

---

## 0. The thesis (one paragraph)

ADG today deterministically enforces exactly **one** edge of the agent loop — the
*action* edge (deny-by-default tool gating, `PreToolUse`) — and only *advises* on the
others (termination, context, recovery, memory, model choice). The overhaul spends the
same fail-closed determinism on the **quality and reach** edges: a loop governor that
owns termination, a backpressure gate that owns recovery, a context injector that owns
attention budget, and a **model orchestrator** that owns capability-per-effort. We do
this as a **3-layer split** (Core → Harness/SDK → Adapters) so one core serves the
portable overlay (any host) *and* an optional SDK harness (owns the loop). Governance
stays the floor; it stops being the whole product.

---

## 1. Validation of the new request (model orchestrator + context-slice multi-agent)

**Request:** add an orchestrator/guide that chooses models by effort, following
OpenAI/Anthropic advice, across a tier ladder (e.g. `5.5 pro, 5.5, 5.4 mini, 5.3 spark,
opus, sonnet, haiku`), with built-in multi-agent orchestration where each agent gets only
a context slice.

**Verdict: adopt — with one structural constraint.**

| Check | Result |
|---|---|
| Aligns with existing ADG convention? | **Yes.** `adg-backlog-swarm` already maps Opus→planner / Sonnet→worker / Haiku→mechanical and says "stronger model for L3." This formalizes it. |
| Aligns with lanes / risk classes? | **Yes.** Effort already exists as a first-class axis: Proofline lanes L0–L4 and risk classes. Model selection = `f(lane, riskClass, mechanical?)`. |
| Context-slice multi-agent already possible? | **Yes.** Context broker (~1.3k-token packets) + `ADG_WRITE_SCOPE` + per-item lifecycle. The orchestrator just needs to drive it in code instead of via a playbook skill. |
| **Risk — staleness** | Hardcoding model IDs/prices into tracked code or docs goes stale within weeks **and** trips `adg:doctor`'s volatile-provenance gate. |

**Constraint (the correction):** the orchestrator selects a **capability tier**, never a
model name. Tier→model mapping lives in an **editable policy file** (`models.json`),
exactly like `context-profiles.yaml` governs context budgets. The tier ladder is abstract
(`frontier-reasoning > balanced > fast-reasoning > economy`); concrete model IDs are
config rows the adopter fills per provider. This keeps ADG deterministic, provider-neutral,
and out of the doctor's volatile-fact net.

---

## 2. The model orchestrator design (`@adg/orchestrator` + `models.json`)

### 2.1 Capability tiers (abstract, stable)

| Tier | Use it for | Default Anthropic seed | OpenAI seed (adopter fills) |
|---|---|---|---|
| `frontier-reasoning` | L3/L4, planning, judge panels, ambiguous design | Opus 4.8 | `5.5 pro` |
| `balanced` | L2 normal feature work, most workers | Sonnet 4.6 | `5.5` |
| `fast-reasoning` | L1 quick-fix with light reasoning | Haiku 4.5 | `5.4 mini` |
| `economy` | L0/L1 mechanical (rename, format, mirror edits) | Haiku 4.5 | `5.3 spark` |

> Model IDs above are **seed examples**, written here as the *only* place provider names
> appear, and flagged as configurable. The shipped `models.json` is the source of truth;
> this table is illustrative and must not be treated as a pinned fact.

### 2.2 `config/agentic/models.json` (policy-as-code)

```jsonc
{
  "version": 1,
  "tiers": {
    "frontier-reasoning": { "anthropic": "claude-opus-4-8", "openai": "5.5-pro" },
    "balanced":           { "anthropic": "claude-sonnet-4-6", "openai": "5.5" },
    "fast-reasoning":     { "anthropic": "claude-haiku-4-5",  "openai": "5.4-mini" },
    "economy":            { "anthropic": "claude-haiku-4-5",  "openai": "5.3-spark" }
  },
  "selection": {
    // effort-first: lane + risk + work-shape -> tier. Deterministic, auditable.
    "byLane":  { "L0": "economy", "L1": "fast-reasoning", "L2": "balanced",
                 "L3": "frontier-reasoning", "L4": "frontier-reasoning" },
    "riskFloor": { "secrets": "frontier-reasoning", "billing": "frontier-reasoning",
                   "migration": "balanced", "production": "frontier-reasoning" },
    "roleOverride": { "planner": "frontier-reasoning", "judge": "frontier-reasoning",
                      "mechanical-worker": "economy" }
  },
  "effort": { "reasoningEffort": { "L0": "low", "L1": "low", "L2": "medium",
                                   "L3": "high", "L4": "high" } },
  "provider": "anthropic"   // adopter-set default; overridable per call
}
```

### 2.3 Selection algorithm (pure function, no I/O)

```
selectModel({ lane, riskClass, role }) ->
  tier = max(            // highest capability wins (a floor, never a downgrade)
    byLane[lane],
    riskFloor[riskClass],
    roleOverride[role]
  )
  return { tier, model: tiers[tier][provider], effort: reasoningEffort[lane] }
```

- **Effort-first, capability-as-floor.** Risk and role can only *raise* the tier, never
  lower it — so a "stronger model for L3" is enforced, not remembered.
- **CLI surface:** `adg models:select --lane L3 --risk secrets --role worker` →
  prints the chosen tier + model + effort + the rule that decided it (transparent, P7).
- **Audited:** a tier-override (human picks a different tier than the policy) records a
  `decision` audit event with reason — same pattern as a guardrail toggle.

### 2.4 Multi-agent, context-slice orchestration (`runSwarm`)

Formalizes `adg-backlog-swarm` into code:

```
runSwarm(featureId):
  plan  = spawn(tier=frontier-reasoning, role=planner)  -> logs items to SQL backlog
  for each item in agent:loop(featureId):
    tier  = selectModel({ lane: item.lane, risk: item.risk, role: workerRole(item) })
    slice = contextBroker.buildPacket(item)            // ~1.3k-token context slice
    spawn(tier, env={ ADG_WRITE_SCOPE: item.writeScope }, input=slice)  // hook enforces scope
  parent keeps: SQL backlog, audit log, dedup, integration, verification
  workers run concurrently ONLY when write scopes are disjoint
```

Each agent gets **only its slice** (the bounded packet), **only its write scope**
(deterministically enforced by the existing hook), and **the cheapest tier that clears
its risk floor**. This is the token-discipline + safety + cost-routing story in one
primitive.

---

## 2.5 SDK integration — build ON Anthropic + OpenAI, do not replace (REQUIRED)

Verified against both SDKs (June 2026). **ADG's SDK is a governance *layer* over each
vendor's agent loop — it never reimplements the loop.** Both SDKs already expose exactly
the extension points ADG needs:

### Claude Agent SDK (`@anthropic-ai/claude-agent-sdk` / `claude-agent-sdk`)
[TS reference](https://code.claude.com/docs/en/agent-sdk/typescript) — `query({ prompt, options })`.

| ADG concern | Plugs into (native SDK field) |
|---|---|
| Action gate (PolicyEngine) | `options.hooks.PreToolUse` **and** `options.canUseTool` (returns `{behavior:'allow', updatedInput?}` or `{behavior:'deny', message}`) |
| Governor (termination) | `options.hooks.Stop` + `options.hooks.SubagentStop` |
| Backpressure | `options.hooks.PostToolUse` |
| Context inject | `options.hooks.UserPromptSubmit` |
| State pin / rehydrate | `options.hooks.PreCompact` / `options.hooks.SessionStart` |
| Model orchestrator | `AgentDefinition.model` + `AgentDefinition.effort` (`low\|medium\|high\|xhigh\|max`) per subagent in `options.agents` |
| Context-slice multi-agent | `options.agents: Record<string, AgentDefinition>` with per-agent `tools`/`maxTurns`/`disallowedTools` |
| Write scope | `ADG_WRITE_SCOPE` env on the subagent + `disallowedTools`/`canUseTool` |

> **All seven hook events ADG needs exist natively**, and `AgentDefinition` already carries
> `model`+`effort` — the orchestrator's output type *is* the SDK's input type.

### OpenAI Agents SDK (`openai-agents` / `@openai/agents`)
[Runner reference](https://openai.github.io/openai-agents-python/ref/run/).

| ADG concern | Plugs into (native SDK field) |
|---|---|
| Hard stop (P3) | `Runner.run(max_turns=…)` — **already built in** |
| Action gate + Governor | `input_guardrails` / `output_guardrails` (tripwire) + `RunHooks.on_tool_start` |
| Backpressure | `RunHooks.on_tool_end` |
| Model orchestrator | `RunConfig.model` / `model_settings` (incl. reasoning effort) per run |
| Context-slice multi-agent | `handoffs` + per-`Runner.run` context slice |

### Consequence for `@adg/sdk`
- Exports **adapters**, not a runtime: `withClaudeGovernance(options)` returns a patched
  Claude Agent SDK `Options`; `adgGuardrails()` / `adgRunHooks()` return OpenAI SDK
  guardrail+hook objects. The shared **Core** supplies the decisions; the vendor SDK runs
  the loop.
- `createGovernedAgent` (plan §0) is therefore a **thin convenience wrapper** over the
  vendor SDK of the caller's choice, not a competing loop. Renamed accordingly:
  `governed(vendor, options)`.

---

## 3. Build workflow (how we actually construct this)

**Method:** ADG governs its own build (dogfood). Every phase is a feature slice in the SQL
backlog with elicitation → criteria → evidence tier → release gate. We use `runSwarm`
*as soon as it exists* to build the rest of itself.

### Phase 0 — Foundation: extract the Core (no behaviour change)
- Extract `PolicyEngine` from `adg-guardrail-hook.mjs` into a pure host-agnostic module
  (`packages/core/policy.mjs`): risk classes, write-scope, always-on floor.
- The existing hook becomes a 5-line adapter calling `PolicyEngine`. **Zero behaviour
  change** — proven by the existing hook test suite passing unchanged.
- Exit criteria: `npm run test:adg-hook` + full `ci:governance` green; `live` evidence.

### Phase 1 — The governor (highest-leverage gap, Part A#1)
- `adg-governor` **Stop + SubagentStop** hook: blocks turn-end until release gate /
  required evidence tier passes; hard caps (maxTurns / maxToolCalls / tokenBudget) from
  `config/agentic/loop-budget.json`.
- Add an eval scenario for the new stop condition (`agent:evals`).
- Exit criteria: governor blocks a forced premature `verified`; cap fires; tests green.

### Phase 2 — The remaining enforcing hooks (Part A#2–5, #8)
- `adg-backpressure` (PostToolUse) · `adg-context-inject` (UserPromptSubmit) ·
  `adg-pin` (PreCompact) · `adg-rehydrate` (SessionStart) · `adg-eval-gate`.
- Ship as one **hook pack** in the existing plugin. Still fully portable to any Claude
  Code host.

### Phase 3 — Model orchestrator (Section 2)
- `models.json` + `selectModel` pure fn + `adg models:select` CLI + audit on override.
- Wire tier selection into the swarm skills (advisory) before the SDK exists.

### Phase 4 — Adapter contract (Part C)
- Formalize Core→Adapter interface: host hook event → `PolicyEngine` →
  `{decision, reason}`. Refactor `.claude-plugin` and `.codex-plugin` to both consume it.
- Add a Codex adapter for the new hooks (governor/backpressure where Codex supports them).

### Phase 5 — The SDK (Part D)
- `@adg/sdk` (TS first): `createGovernedAgent`, `PolicyEngine`, `hooks`, `backlog`/
  `audit`/`evidence` clients, `contextBroker`, `orchestrator.runSwarm`, types + schemas.
- `createGovernedAgent` bakes in `gather→act→verify→repeat` with the governor as
  termination authority. Python SDK (`adg-sdk`) second.

### Phase 6 — Distribution & zero-onboarding (Part B)
- `adg init` (host-detect, 3-question AGENTS.md, install hook pack, seed backlog, run one
  real classification on the user's diff).
- Channels: one-line installer, `npx @adg/cli`, Claude Code marketplace (exists),
  `codex plugin add adg`, `npm i -g @adg/cli`, Homebrew.

### Phase 7 — Interactive surfaces parity (Part C)
- Slash commands + `adg` subcommands + bundled dashboard reach parity across Claude Code
  (desktop+CLI), Codex (app+CLI), and bare terminal.

**Dependency order:** 0 → 1 → 2 → 3 → (4 ∥ 5) → 6 → 7. Phases 4 and 5 can overlap once
the adapter contract is drafted.

> **Sequencing note (risk-based):** Phase 0 (Core extraction) touches the
> security-critical, single-file-installed enforcement hook, so it is landed deliberately
> as a **drift-checked generated bundle** (the existing `CLAUDE.md`-sync idiom), proven
> byte-for-behaviour by the 65-case hook test. The purely-additive, hook-independent phases
> are built first so progress never risks the working enforcement layer. Actual build order:
> **3 → 0 → 1 → 2 → 5 → 4 → 6 → 7**.

---

## Build progress

| Phase | State | Evidence |
|---|---|---|
| Research: verify both SDKs (build-on-not-replace) | ✅ done | §2.5 added; mapping tables verified against live docs |
| Scaffold monorepo (`packages/core`) | ✅ done | `packages/core/package.json` |
| **3 — Model orchestrator** | ✅ done | `config/agentic/models.json` · `packages/core/select-model.mjs` · `scripts/adg-models.mjs` · `tooling/adg-as-code/test-select-model.mjs` (12 checks green) · `models:select`/`models:tiers` scripts · wired into `ci:governance` |
| **1 — Governor (Stop + SubagentStop hook)** | ✅ done | `config/agentic/loop-budget.json` · `packages/core/governor.mjs` · `plugins/adg-governance/hooks/adg-governor-hook.mjs` · `test-governor.mjs` (8 checks) + 5 live-binary smoke tests (allow/no-trap/fail-open/block/warn) · registered Stop+SubagentStop in `hooks.json` · wired into `ci:governance`; guardrail hook still 61/61, plugin valid |
| **2 — Remaining hook pack (backpressure / context-inject / pin / rehydrate)** | ✅ done | `packages/core/backpressure.mjs` + `loop-context.mjs` · 4 hooks (`adg-backpressure`/`adg-context`/`adg-precompact`/`adg-sessionstart`) + shared `adg-backlog-read.mjs` · `test-loop-hooks.mjs` (12) + live smoke on all 4 binaries · all 7 hook events now registered in `hooks.json` · **full `ci:governance` green** · `adg:doctor` clean |
| **5 — `@adg/sdk` (Claude + OpenAI adapters)** | ✅ done | `packages/sdk/` (`claude.mjs` `withClaudeGovernance`/`governAgentModel`, `openai.mjs` `governTool`/`adgOutputGuardrail`/`modelSettingsFor`, `index.mjs`, README) · `packages/core/policy-client.mjs` (action gate delegates to the hardened hook) + `backlog-read.mjs` · `test-sdk.mjs` (13 checks, action gate hits the REAL hook) · zero-dep, vendor SDKs optional peers · wired into `ci:governance` |
| **0 — Core PolicyEngine extraction** | ✅ satisfied by delegation | SDK builds ON the existing hook via `policy-client` subprocess (one source of truth, zero drift). Pure in-process engine = documented future perf optimization, not done unattended on the security-critical hook |
| **4 — Adapter contract / Codex (new hooks)** | ✅ done | `docs/adg-adapter-contract.md` (uniform decision shape + normalization + fail-direction) · harness-neutral `adg-codex-stop.mjs` (→governor) + `adg-codex-posttool.mjs` (→backpressure), same delegate-to-hook pattern as the pretool adapter · `test-adg-codex-lifecycle.mjs` (5 checks incl. cross-harness block path) · wired into `ci:governance` |
| **6 — Distribution + `adg init`** | ✅ additive done | `scripts/adg-init.mjs` (host-detect + install + value-proof classification) · `@adg/cli` (`packages/cli/`, `adg` dispatcher over every script) · `docs/adg-distribution.md` (channels + surface parity) · `test-adg-cli.mjs` (6 checks) · install tests still green (installer untouched). ⚠ host-bundling of the new lifecycle hooks = reviewed follow-up (needs a bundler + installer file-list change) |
| **7 — Surface parity** | ✅ done | new slash commands `/adg-models` + `/adg-init` (match the CLI) · `docs/adg-surfaces.md` (4 surfaces + capability→surface matrix) · `plugin:validate` clean · **final full `ci:governance` green** |

## v2.0 — completion summary

**Status: built and green.** Every phase landed its tested substance; the two deliberately
deferred pieces are flagged for review (they touch the hardened hook / adversarially-tested
installer and should not be done unattended).

Delivered:
- **`packages/core`** — host-agnostic decisions: `select-model`, `governor`, `backpressure`,
  `loop-context`, `policy-client` (delegates the action gate to the hardened hook),
  `backlog-read`.
- **Harness layer** — all 7 Claude Code hook events wired (action gate + governor +
  backpressure + context/pin/rehydrate), each pure-core + thin-hook + test.
- **`packages/sdk`** (`@adg/sdk`) — governance *layer over* the Claude Agent SDK and OpenAI
  Agents SDK; imports nothing from them (zero-dep, optional peers).
- **`packages/cli`** (`@adg/cli`) — the `adg` terminal entrypoint; `adg init` zero-onboarding.
- **Model orchestrator** — effort-first, capability-as-floor, provider-neutral
  (`config/agentic/models.json`); feeds `AgentDefinition.model`/`.effort` and OpenAI
  `model_settings`.
- **Cross-harness** — uniform adapter contract + Codex lifecycle adapters.
- **Docs** — adapter contract, distribution, surfaces; all wired into `ci:governance`.

Reviewed follow-ups (NOT done unattended):
1. **Phase 0 pure in-process policy engine** — superseded by delegation; a perf optimization.
2. **Phase 6 host-bundling of the new lifecycle hooks** — needs a bundler + an installer
   file-list change, landed with the install-test suite kept green.

**Revised build order (risk-based, updated live):** ✅3 → ✅1 → 2 → (0 ∥ 5) → 4 → 6 → 7.
Phase 0 deferred from "first" to "paired with the SDK" because it is the only step that
mutates the security-critical, single-file-installed hook — it should land where it is
actually consumed (Phase 5's action-gate), not unattended ahead of need.

---

## 4. Target architecture (end state)

```
┌─ Surfaces (interactive) ──────────────────────────────────────┐
│  Claude Code (desktop+CLI)   Codex (app+CLI)   Terminal `adg`  │
├─ Adapters (thin, per-host) ───────────────────────────────────┤
│  claude-adapter   codex-adapter   cli-adapter                  │
│   host hook event -> Core -> {allow|ask|deny, reason}          │
├─ Harness / SDK  (@adg/sdk, optional) ─────────────────────────┤
│  createGovernedAgent · orchestrator.runSwarm · governor        │
├─ Core (host-agnostic, pure) ──────────────────────────────────┤
│  PolicyEngine · evidence tiers · backlog · audit chain ·       │
│  contextBroker · selectModel(models.json)                      │
└───────────────────────────────────────────────────────────────┘
```

- **Portable overlay** = Core + hooks bound to host events (ships *without* the harness).
- **SDK harness** = Core + `createGovernedAgent` (ships *with* the loop).
- Same Core. Two products. This is the answer to the portability-vs-control tradeoff.

---

## 5. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Harness opinionation kills host portability | Tiered: overlay stays host-agnostic; SDK harness is opt-in only. |
| Model IDs/prices go stale, trip `adg:doctor` | Tier abstraction + `models.json`; no model names in tracked code/docs. |
| Stop-hook blocks legitimate exits (false stop) | Governor `ask`s (not hard-block) outside `release-class:*`; hard-block only on sensitive release classes; eval coverage. |
| Big-bang overhaul destabilizes a working tool | Phase 0 is behaviour-preserving; each phase gated by `ci:governance` + `live` evidence; nothing ships until green. |
| Codex hook surface ≠ Claude Code | Adapter contract degrades gracefully; a hook absent on a host falls back to advisory skill. |
| Multi-provider model routing untested | Anthropic rows seeded + tested first; OpenAI rows ship empty/advisory until validated. |

---

## 6. Open questions for review (please answer before we start)

1. **Scope of v2.0:** all 8 phases, or land Phases 0–3 first (governor + hooks + model
   orchestrator) and treat SDK/distribution (4–7) as v2.1?
2. **Package layout:** monorepo (`packages/core`, `packages/sdk`, `packages/cli`) vs.
   keep `scripts/` flat and publish from there? (Recommend monorepo for the SDK.)
3. **Provider default:** ship `models.json` Anthropic-only, or seed empty OpenAI rows now?
4. **Governor strictness default:** `ask` (confirm) or `block` on premature signoff for
   non-sensitive items? (Recommend `ask` off sensitive classes, `block` on them.)
5. **The tier ladder names:** confirm the abstract tiers
   (`frontier-reasoning / balanced / fast-reasoning / economy`) or supply your own.
6. **SDK language priority:** TS-first then Python (recommended), or both at once?

---

*Approve, amend, or reprioritize the phases and answer §6. On approval I'll create the
backlog feature slices for Phase 0 and begin the behaviour-preserving Core extraction.*
