# Agentic Development Governance (ADG)

**A deny-by-default governance layer that has grown into a *tiered governed harness +
SDK* over the vendor agent loops — keeping AI coding agents bounded, auditable, and
context-disciplined, in a handful of Node scripts and SQLite files.**

Hand an AI agent your codebase and two failure modes dominate:

1. **It does too much** — unbounded, unaudited, occasionally destructive or
   injection-hijacked actions, with no hard stop.
2. **It drowns in context** — you paste the whole tracker into the prompt and burn six
   figures of tokens before it writes a line, and recall degrades as the window fills.

ADG is a small, local control plane that fixes both. It started as one deny-by-default
PreToolUse guardrail. It is now a **governance layer that wraps the agent loop itself** —
bounding termination, feeding failures back, injecting only the context that matters, and
selecting the model tier — while never replacing the vendor runtime. It runs on nothing
but **Node (≥ 20) and the `sqlite3` CLI.** No SaaS, no agent framework, no vector
database, no API keys. Everything is grep-able, diffable, offline, and the full gate runs
in seconds.

> **The core inversion:** SQLite *selects* the context. Your richest generated artifacts
> are treated as hazards, not assets — a relational backlog hands the agent a few-KB
> packet of pointers instead of the firehose.

```text
task → classify lane → SQL lookup → capped context packet → anchored files → targeted checks
        │                                                                          │
        └──────────────── governed loop: action-gate · termination · backpressure ─┘
```

---

## 1. What ADG is

ADG is a **governance overlay** *and* a **governed harness**:

- **The overlay** (portable, the original product): deny-by-default risk-class guardrails,
  an append-only + hash-chained audit log, AI-security evals, DORA-style delivery metrics,
  a SQL-first backlog, elicitation-as-code, maturity-as-code, and a context broker that
  keeps tokens bounded by *refusing* to load context-blowing artifacts.
- **The harness** (ADG 2.0): a governance *layer over each vendor agent loop* — the Claude
  Agent SDK and the OpenAI Agents SDK — that enforces specific loop edges deterministically
  (action gate, loop governor/termination, backpressure, context injection, model
  orchestration), delivered through four interchangeable surfaces (Claude Code hooks, Codex
  adapters, a CLI, and `@adg/sdk`). **It is a layer, never a replacement runtime.**

The honest framing: most ingredients exist somewhere. The combination — governance whose
audience is *an agent, not an auditor*, plus the context inversion, plus enforcing
loop-design principles outside the model — is uncommon.

## 2. Best use cases — where ADG actually helps

**Strong fit:**
- A **fleet of agents** (or a solo dev + agents) making real changes to a real repo, where
  unaudited or destructive actions are unacceptable.
- Long or autonomous runs that need a **hard stop** and a **release gate** so "done" is
  decided by evidence, not the model's self-report.
- Token-sensitive work where **context discipline** is the difference between cents and
  six figures.
- Regulated / solo contexts needing **non-repudiable** history (append-only, hash-chained)
  even with no human reviewer.
- Running **Claude Code and Codex in one repo** under one shared policy.

**Weak / non-fit (stated honestly):**
- A single throwaway prompt with no repo and no stakes — the governance overhead won't pay.
- A team that wants ADG to *execute and sandbox* code-as-action — ADG governs the loop; it
  is not a runtime or a sandbox.
- Retrieval-heavy RAG products needing a vector store — ADG is deliberately
  SQL/filesystem-first.

## 3. Introduction to loops

ADG is built on a first-principles study of **agent loops** — the iterate cycle an agent
runs: gather context → act → observe → repeat. That study (the **P1–P12 framework**) lives
in [`loops-research.md`](loops-research.md), and the current state of the field — top labs,
figures, and repos — in
[`research/agentic-field-map-2026-06-20.md`](research/agentic-field-map-2026-06-20.md).

The load-bearing insight: **the loop is the product; the model is a component.** Capability
gain comes from how outputs and observations are fed back, not from a bigger model alone.
And the moment a loop acts autonomously, three things become structurally true — it must be
*bounded*, *inspectable*, and treat *every observation as untrusted input*.

ADG's distinctive move is that it **enforces specific loop edges deterministically, outside
the model**, rather than advising the model to behave:

| Loop edge | ADG mechanism (deterministic) |
|---|---|
| **Action** is gated by blast radius | PreToolUse guardrail (deny-by-default risk classes) |
| **Termination** is bounded + evidence-gated | loop governor (`maxTurns` ceiling + release gate) |
| **Observation** failures re-enter the loop | backpressure hook (failed check → next-iteration observation) |
| **Context** is curated, not dumped | context-inject / pin / rehydrate hooks + the broker |
| **Fan-out** is cost-bounded | subagent budget gate (`maxConcurrent` / `maxTotal`) |
| **Model tier** matches the work | model orchestrator (effort-first, abstract tiers) |

The full P1–P12 self-audit of how well ADG scores on each principle is in
[`docs/adg-scorecard.md`](docs/adg-scorecard.md); the gap analysis and improvement plan in
[`research/gap-analysis.md`](research/gap-analysis.md) and
[`research/improvement-plan.md`](research/improvement-plan.md).

## 4. The 12 areas we govern

The design surface every real agent loop must answer — and where ADG governs it:

| # | Principle (one line) | How ADG governs it |
|---|---|---|
| **P1** | The loop is the product; the model is a component | `packages/{core,sdk,cli}` — a harness, not a checker |
| **P2** | Use the least autonomy that solves the problem | Proofline lanes L0–L4 + governor modes |
| **P3** | Every loop needs a hard stop *and* an authority for "done" | governor caps + release gate (evidence tiers) |
| **P4** | Context is a finite attention budget, not storage | context broker, profiles, in-loop context hooks |
| **P5** | Externalize durable state to filesystem + git | SQL backlog + append-only audit log |
| **P6** | Ground every iteration in real observation | evidence tiers + backpressure |
| **P7** | Make the loop transparent and agent-shaped | audit chain, dashboard, adapter contract, surfaces |
| **P8** | Add error recovery as a loop edge (backpressure) | backpressure hook + `backlog:fail` |
| **P9** | Reach for multi-agent only when isolation pays | subagent budget gate (fan-out cost cap) |
| **P10** | Prefer predictable failure to unpredictable success | deterministic policy; fail-closed security / fail-open quality |
| **P11** | Bound action by blast radius; observations are untrusted | deny-by-default classes, always-on controls, write-scope |
| **P12** | Design the success criterion before the loop | elicitation → criteria → evidence tiers → release gate → evals |

## 5. Setup and configuration

```sh
# Requirements: Node >= 20 and the sqlite3 CLI on PATH.
# ADG is not currently published on npm; copy or clone it into your dev folder.

npm run setup                 # build an empty data/backlog.sqlite from schema + seed
npm run setup:demo            # optional: load the self-referential ADG worked example

# Classify a lane before burning tokens on context or gates:
npm run work:classify -- --intent "quick css spacing fix" --file docs/setup.html

# Onboard / install into a host repo:
npm run adg:init                                   # zero-onboarding entry (detect + install + value-proof)
npm run adg:install -- --target /path/to/repo --client claude   # claude | codex | both
npm run adg:install -- --target /path/to/repo --client both --dashboard on
npm run adg:update  -- --target /path/to/repo      # preserves governed toggle state

# Day-to-day:
npm run models:tiers                               # show the abstract capability ladder
npm run context:slice -- --feature S07 --workflow agentic-tooling
npm run ci:governance                              # the full gate
npm run adg:doctor                                 # catch install/invariant drift
```

**Policy-as-code lives in `config/agentic/`** — edit these, not the scripts:

| File | Governs |
|---|---|
| `guardrails.json` | deny-by-default risk classes + toggleable controls (3 pinned always-on) |
| `loop-budget.json` | governor caps (`maxTurns`/`maxToolCalls`), release-gate mode, subagent fan-out caps |
| `models.json` | abstract tier → provider model (the *only* place model IDs live) |
| `context-profiles.yaml` | per-workflow context budgets |
| `delivery-lanes.json` | the L0–L4 Proofline lanes |

Toggling a control is itself a governed, audited action — use
`npm run guardrails:toggle -- --control <name> --set off --reason … --risk … --rollback …`;
never hand-edit the policy to relax a control (the runtime ignores it and the gate rejects
it).

## 6. Which harnesses it works best with

ADG is purpose-built for the two harnesses whose vendor SDKs expose the loop hooks it
governs:

- **Claude Code / Claude Agent SDK** — richest integration: all seven hook events plus
  slash commands and `@adg/sdk`'s `withClaudeGovernance`.
- **OpenAI Codex / OpenAI Agents SDK** — harness-neutral lifecycle adapters plus
  `@adg/sdk`'s OpenAI functions.

Anything that can shell out to the CLI or read the SQL backlog can use the overlay
(audit, backlog, context broker, evals) even without loop-hook integration.

## 7a. The Claude section — how ADG plugs into Claude Code

ADG registers all seven Claude Code hook events (`plugins/adg-governance/hooks/hooks.json`):

| Hook event | ADG enforcement | Direction |
|---|---|---|
| `PreToolUse` (Bash/Edit/Write/Read/…) | deny-by-default guardrail (security floor) | fails **closed** |
| `PreToolUse` (Task) | subagent budget gate (P9 fan-out cap) | fails open |
| `Stop` | loop governor — hard cap + release gate | fails open |
| `SubagentStop` | governor + subagent-gate decrement | fails open |
| `PostToolUse` (Bash) | backpressure — failed check → observation | fails open |
| `UserPromptSubmit` | context injection (bounded steering) | fails open |
| `PreCompact` | pin durable state before window reset | fails open |
| `SessionStart` | rehydrate state from disk | fails open |

Slash commands: `/adg-init`, `/adg-classify`, `/adg-context`, `/adg-models`, `/adg-verify`,
`/adg-completeness-critic`. Programmatic: `@adg/sdk`'s `withClaudeGovernance(options)`
patches the Claude Agent SDK `query()` — an action gate via `canUseTool` (delegating to the
hardened hook), the lifecycle hooks, and `governAgentModel` → `AgentDefinition.model`/
`effort`.

## 7b. The Codex section — how ADG plugs into Codex

ADG ships **harness-neutral lifecycle adapters** in
`plugins/adg-governance/.codex-plugin/hooks/` that delegate to the *same* hook binaries via
the uniform adapter contract (`docs/adg-adapter-contract.md`):

| Adapter | Delegates to | Role |
|---|---|---|
| `adg-codex-pretool.mjs` | the guardrail hook | action gate (normalizes Codex field names) |
| `adg-codex-stop.mjs` | the governor | termination / release gate |
| `adg-codex-posttool.mjs` | backpressure | failed-check feedback |

Programmatic: `@adg/sdk`'s OpenAI functions wrap the OpenAI Agents SDK — `governTool`
(per-tool action gate), `adgOutputGuardrail` / `adgRunHooks` (guardrail + lifecycle),
`modelSettingsFor` (reasoning effort → `model_settings`), and `loopCaps` (`max_turns`).
`npm run adg:install -- --client codex|both` installs and keeps both adapters on one policy
source.

## 8. Coming soon (planned, not shipped)

Drawn from the deferred follow-ups in `docs/adg-2.0-overhaul-plan.md` and
[`research/improvement-plan.md`](research/improvement-plan.md). **Planned — not yet built:**

- **P9 cross-adapter parity** — port the subagent fan-out cap from the Claude hook surface
  to the Codex adapter and `@adg/sdk` (needs the Phase-6 host-bundling of the new lifecycle
  hooks).
- **In-process PolicyEngine** — replace the action-gate subprocess hop with a pure
  in-process engine (perf only; delegation already works).
- **Enforce `maxToolCalls`** — the tool-call ceiling is declared in `loop-budget.json` but
  the governor currently honors only `maxTurns`.
- **Backpressure beyond Bash**, **per-lane context budgets**, **advisory→enforced lanes**,
  and a **held-out loop eval** — see the improvement plan.
- **npm / marketplace distribution** — today install is via `npm run adg:install` from a
  cloned copy.

## 9. How this benefits context discipline and agentic governance

- **P4 (attention budget):** the broker returns a **~2.0 KB (TOON) / ~2.8 KB (markdown)**
  packet in place of the **~26 KB SQL dump / ~164 KB database** it stands for; at real
  scale, ~4–7k tokens instead of hundreds of thousands. Generated mirrors sit on a
  `forbiddenBulkFiles` denylist. Method + numbers: [`docs/token-reduction.md`](docs/token-reduction.md).
- **P5 (externalized state):** the SQL backlog and append-only audit log *are* the durable
  memory; current state is always derived via SQL views, never edited in place.
- **P11 (blast radius):** tools are deny-by-default; three controls (`destructiveDeny`,
  `auditAppendOnly`, `forbiddenBulkRead`) are pinned always-on in code, so a hand-edit that
  relaxes one is ignored at runtime. Every observation is treated as untrusted input.
- **P12 (eval is the bottleneck):** the success criterion is authored before the loop
  (elicitation → criteria), carried as an evidence tier (`asserted < config < test <
  live`), and enforced by the same release gate the governor consults at turn-end.

---

## Repository layout

```
agentic-development-governance/
├── AGENTS.md                      # agent rulebook + per-repo template
├── loops-research.md              # the P1–P12 agent-loop principles
├── package.json                   # governance gate + lifecycle commands (npm run ...)
├── packages/
│   ├── core/                      # pure loop decisions (governor, backpressure, subagent-gate, select-model …)
│   ├── sdk/                       # @adg/sdk — Claude + OpenAI governance adapters
│   └── cli/                       # @adg/cli — terminal dispatcher
├── plugins/adg-governance/
│   ├── hooks/                     # Claude Code hooks + hooks.json (7 events)
│   └── .codex-plugin/hooks/       # Codex lifecycle adapters
├── config/agentic/                # policy-as-code (guardrails, models, loop-budget, …)
├── scripts/                       # backlog engine, context broker, gates
├── tooling/                       # broker manifests + as-code tests + eval scenarios
├── research/                      # field map, gap analysis, improvement plan, dispositions
├── data/                          # schema.sql, seed/, audit/audit-log.jsonl (sqlite gitignored)
└── docs/                          # architecture, governance model, harness plan, token reduction
```

The generated `data/*.sqlite` databases are gitignored. A clean install starts empty with
`npm run setup`; the worked example is opt-in with `npm run setup:demo`.

## Documentation

- **📖 Start here:** [`docs/adg-introduction.md`](docs/adg-introduction.md) — why a fleet of agents is a governance problem.
- **🔁 Agent loops:** [`loops-research.md`](loops-research.md) + [`research/agentic-field-map-2026-06-20.md`](research/agentic-field-map-2026-06-20.md) — the P1–P12 framework and the 2026 field map.
- **📊 Scorecard:** [`docs/adg-scorecard.md`](docs/adg-scorecard.md) — how ADG scores on each principle.
- **🧭 Harness plan:** [`docs/adg-2.0-overhaul-plan.md`](docs/adg-2.0-overhaul-plan.md) — Phases 0–7, vendor-SDK mapping, deferred follow-ups.
- **🔌 Surfaces & dual-harness:** [`docs/adg-surfaces.md`](docs/adg-surfaces.md) · [`docs/dual-harness.md`](docs/dual-harness.md) · [`docs/adg-adapter-contract.md`](docs/adg-adapter-contract.md) · [`docs/adg-distribution.md`](docs/adg-distribution.md).
- **🚀 Release notes:** [`docs/release-notes-1.1.md`](docs/release-notes-1.1.md) · [`docs/release-notes-1.0.md`](docs/release-notes-1.0.md).
- **🛡 Governance:** [`docs/governance-alignment.md`](docs/governance-alignment.md) — mapped to OWASP LLM Top 10, ISO/IEC 42001, the Three Lines model, ISO 31000.
- **🗃 SQL layer:** [`docs/sql-data-layer.md`](docs/sql-data-layer.md) · [`docs/audit-chain.md`](docs/audit-chain.md).
- **⚡ Lanes & tokens:** [`docs/proofline-delivery-lanes.md`](docs/proofline-delivery-lanes.md) · [`docs/token-reduction.md`](docs/token-reduction.md).
- [`AGENTS.md`](AGENTS.md) — the agent rulebook / per-repo template.

## Adopting it in another repo

Use `npm run adg:install -- --target /path/to/repo --client claude|codex|both` (add
`--dashboard on` for the read-only dashboard), then `npm run adg:doctor -- --target …` to
check for drift. The installer writes `config/agentic/adg-install-state.json` so updates
are versioned. Manual route and full steps:
[`docs/reference/extraction-notes.md`](docs/reference/extraction-notes.md).

## License

**Source-available, non-commercial.** Licensed under the
[PolyForm Noncommercial License 1.0.0](LICENSE) — free to use, modify, and share for any
**non-commercial** purpose.

**All commercial rights are reserved by Otterblock Pty Ltd** (ABN 91 614 672 794), which
retains full ownership of and all rights in this software. Commercial use requires a
separate commercial license — contact **zach+github@otterblock.com**.

(A non-commercial restriction makes this *source-available* rather than OSI "open source."
The label is deliberate.)

---

© 2026 Otterblock Pty Ltd · ABN 91 614 672 794 · ACN 614 672 794. All rights reserved.
