# Agentic Development Governance (ADG)

Start with **Git, concise Markdown instructions and decisions, the agent runtime's
native permissions, and focused application CI**. Add ADG only where an explicit
requirement needs enforcement or structured reporting beyond that baseline.

ADG provides optional deterministic controls and an advanced SQL governance profile.
A more capable model does not replace permission boundaries or application tests;
neither does it justify retaining orchestration that no longer improves outcomes.
For Astra and Fable 5.1, the current recommendation is to simplify first and measure
which components earn their cost. See the [modernisation and retirement decision
plan](docs/astra-fable-modernisation.md).

This is an adoption recommendation, not an automatic policy change. Existing ADG
installations retain their configured controls, audit history, and release gates
until an explicit migration preserves context and replaces any required enforcement.
The current installer installs the governed profile; it does not implement a
separate lightweight installer mode.

## 1. What ADG provides

- Executable action checks, scope controls, and tests for supported hook adapters.
- Evidence tiers and release checks for repositories that adopt them.
- An append-only audit log with a consistency hash chain. Its trust anchor remains
  reviewed Git history; someone able to rewrite both the log and its sidecar can
  forge a consistent history.
- Optional advanced planning infrastructure: SQL backlog, requirements lineage,
  context packets, and derived reports.
- Hook, CLI, and SDK integrations over vendor runtimes. ADG is not a sandbox.

The Node scripts require Node >= 20 and the `sqlite3` CLI. Optional integrations
have their own dependencies. Historical release notes describe changes, not proof
that ADG improves a current model's end-to-end performance.

## 2. Choosing a workflow

| Need | Starting point |
|---|---|
| Ordinary feature work and bug fixes | Git, a short `AGENTS.md` / `CLAUDE.md`, task notes only when useful, native permissions, focused CI |
| Long work spanning sessions | A concise Markdown handoff with goal, decisions, current state, next steps, and verification commands |
| Specific actions need deterministic denial | Native runtime controls first; add tested ADG controls where a documented gap remains |
| Queryable requirements lineage or structured evidence is required | Explicitly adopt the advanced SQL ADG profile and its maintenance obligations |
| Existing ADG installation | Inventory and preserve context before updating or removing managed components |

No task-quality comparison against this lightweight baseline has yet been completed.
Context packet byte savings against a generated SQL dump do not establish task
success, cost, or latency improvements over targeted search and Markdown.

## 3. Introduction to loops

ADG is built on a first-principles study of **agent loops** — the iterate cycle an agent
runs: gather context → act → observe → repeat. That study (the **P1–P12 framework**) lives
in [`loops-research.md`](loops-research.md), and the current state of the field — top labs,
figures, and repos — in
[`research/agentic-field-map-2026-06-20.md`](research/agentic-field-map-2026-06-20.md).

Model and harness capabilities interact. Re-evaluate scaffolding when the model or
vendor runtime changes, and retain it only for an observed gap or an explicit control requirement.
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

The existing design framework and its implemented mechanisms:

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

## 5. Advanced SQL profile: setup and configuration

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
| `models.json` | abstract tier → configured provider model |
| `context-profiles.yaml` | per-workflow context budgets |
| `delivery-lanes.json` | the L0–L4 Proofline lanes |

Toggling a control is itself a governed, audited action — use
`npm run guardrails:toggle -- --control <name> --set off --reason … --risk … --rollback …`;
never hand-edit the policy to relax a control (the runtime ignores it and the gate rejects
it).

## 6. Which harnesses it works best with

ADG ships integrations for these runtime families; adapter behavior and model
availability must be verified against the installed runtime:

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

## 9. Evidence and limitations

Context packets cap selected rows and file pointers, not the tokens in referenced
files. Anchors can be stale or incomplete. The eval fixtures test policy mappings
and selected executable hook paths; they are not an evaluation of Astra or Fable
solving development tasks. A `live` tier is recorded evidence, not independent
proof that the observation was correct.

The [context measurement notes](docs/token-reduction.md) distinguish serialization
size from model usage and task quality. The [modernisation plan](docs/astra-fable-modernisation.md)
defines matched tasks, independent grading, component removal experiments, and
conditional retirement. No claim of obsolescence or demonstrated model improvement
is made before that comparison.

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
- **🤖 Set it up with an agent:** [`docs/agent-setup-guide.md`](docs/agent-setup-guide.md) — a paste-into-an-agent runbook that installs/configures ADG and verifies it.
- **🔁 Agent loops:** [`loops-research.md`](loops-research.md) + [`research/agentic-field-map-2026-06-20.md`](research/agentic-field-map-2026-06-20.md) — the P1–P12 framework and the 2026 field map.
- **📊 Scorecard:** [`docs/adg-scorecard.md`](docs/adg-scorecard.md) — how ADG scores on each principle.
- **🧭 Harness plan:** [`docs/adg-2.0-overhaul-plan.md`](docs/adg-2.0-overhaul-plan.md) — Phases 0–7, vendor-SDK mapping, deferred follow-ups.
- **🔌 Surfaces & dual-harness:** [`docs/adg-surfaces.md`](docs/adg-surfaces.md) · [`docs/dual-harness.md`](docs/dual-harness.md) · [`docs/adg-adapter-contract.md`](docs/adg-adapter-contract.md) · [`docs/adg-distribution.md`](docs/adg-distribution.md).
- **🚀 Release notes:** [`docs/release-notes-2.0.md`](docs/release-notes-2.0.md) · [`docs/release-notes-1.1.md`](docs/release-notes-1.1.md) · [`docs/release-notes-1.0.md`](docs/release-notes-1.0.md).
- **🛡 Governance:** [`docs/governance-alignment.md`](docs/governance-alignment.md) — mapped to OWASP LLM Top 10, ISO/IEC 42001, the Three Lines model, ISO 31000.
- **🗃 SQL layer:** [`docs/sql-data-layer.md`](docs/sql-data-layer.md) · [`docs/audit-chain.md`](docs/audit-chain.md).
- **⚡ Lanes & tokens:** [`docs/proofline-delivery-lanes.md`](docs/proofline-delivery-lanes.md) · [`docs/token-reduction.md`](docs/token-reduction.md).
- [`AGENTS.md`](AGENTS.md) — the agent rulebook / per-repo template.

## Adopting it in another repo

For a new repository, start with the lightweight baseline above. If its requirements
justify the advanced governed profile, use `npm run adg:install -- --target /path/to/repo --client claude|codex|both` (add
`--dashboard on` for the read-only dashboard), then `npm run adg:doctor -- --target …` to
check for drift. The installer writes `config/agentic/adg-install-state.json` so updates
are versioned. **Or hand it to an agent:** paste
[`docs/agent-setup-guide.md`](docs/agent-setup-guide.md) into a fresh agent session and it
will install, configure, and verify ADG for you. Manual route and full steps:
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
