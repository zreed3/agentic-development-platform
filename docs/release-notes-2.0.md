# ADG 2.0 release notes

The big one. ADG 1.x was a governance overlay that deterministically enforced exactly
one edge of the agent loop, the action edge (deny-by-default tool gating at
`PreToolUse`), and only advised on the rest. ADG 2.0 spends the same fail-closed
determinism on the quality and reach edges of the loop: a governor that owns
termination, a backpressure gate that owns recovery, a context injector that owns the
attention budget, and a model orchestrator that owns capability-per-effort. ADG is now a
tiered governed harness and SDK over the vendor agent loops, while the portable overlay
stays intact. Governance is still the floor; it has stopped being the whole product.

Style rule: no em dashes. Date: 2026-06-20.

## The foundation: a first-principles study of agent loops

2.0 is anchored in `loops-research.md`, a principles document (P1 to P12) derived from
the labs, researchers, and repositories defining agent-loop design, with a current field
map in `research/agentic-field-map-2026-06-20.md`. The load-bearing idea: the loop is the
product and the model is a component, and the moment a loop acts autonomously it must be
bounded, inspectable, and treat every observation as untrusted input. ADG's distinctive
move is to enforce specific loop edges deterministically, outside the model, rather than
advising the model to behave. The P1 to P12 self-audit lives in `docs/adg-scorecard.md`.

## What is new in 2.0

### Three-layer split (Core, Harness/SDK, Adapters)

A monorepo separates pure decisions from the runtimes that consume them, so one Core
serves both the portable overlay (any host) and the optional SDK harness:

- `packages/core` (`@adg/core`): host-agnostic decisions, no I/O. `select-model`,
  `governor`, `backpressure`, `loop-context`, `subagent-gate`, `policy-client` (delegates
  the action gate to the hardened hook), `backlog-read`.
- `packages/sdk` (`@adg/sdk`): the governance layer over the vendor SDKs.
- `packages/cli` (`@adg/cli`): the `adg` terminal entrypoint.

### The loop governor (P3: hard stop and an authority for done)

A Stop and SubagentStop hook (`packages/core/governor.mjs` plus
`adg-governor-hook.mjs`) holds turn-end against the release gate and the required evidence
tier, with hard caps read from `config/agentic/loop-budget.json`. It fails open and
asks rather than hard-blocks outside sensitive release classes.

### Backpressure and context-lifecycle hooks (P6, P8, P4, P5)

The remaining enforcing hooks ship as one pack and register all seven Claude Code hook
events: backpressure on `PostToolUse` (a failed check returns as the next observation),
context injection on `UserPromptSubmit`, state pin on `PreCompact`, and rehydrate on
`SessionStart` (`packages/core/backpressure.mjs`, `loop-context.mjs`).

### Subagent budget gate (P9: fan-out only when isolation pays)

`packages/core/subagent-gate.mjs` plus `adg-subagent-gate-hook.mjs` bound multi-agent
fan-out (`maxConcurrent` / `maxTotal` from `loop-budget.json`) on `PreToolUse(Task)` and
`SubagentStop`. It is a quality gate: fails open, default warn.

### Model orchestrator (effort-first, capability-as-floor, provider-neutral)

`config/agentic/models.json` plus a pure `select-model` function and the `models:select`
/ `models:tiers` CLI choose an abstract capability tier
(`economy < fast-reasoning < balanced < frontier-reasoning`) from lane, risk, and role.
Floors only raise the tier, never lower it. Concrete provider model IDs are confined to
the single editable `models.json`, so the rest of ADG never hardcodes a model name and
nothing trips the doctor's volatile-provenance gate.

### `@adg/sdk`: build on the vendor loops, never replace them

`@adg/sdk` is a governance layer over each vendor agent loop, importing nothing from them
(zero dependencies, optional peers):

- Claude Agent SDK: `withClaudeGovernance(options)` patches `query()` (action gate via
  `canUseTool` delegating to the hardened hook, the lifecycle hooks), and
  `governAgentModel` feeds `AgentDefinition.model` / `effort`.
- OpenAI Agents SDK: `governTool` (per-tool action gate), `adgOutputGuardrail` /
  `adgRunHooks`, `modelSettingsFor` (reasoning effort), and `loopCaps` (`max_turns`).

### Cross-harness adapter contract and Codex lifecycle adapters

A uniform decision shape (`docs/adg-adapter-contract.md`) lets harness-neutral Codex
lifecycle adapters (`adg-codex-stop.mjs`, `adg-codex-posttool.mjs`) delegate to the same
hook binaries as the Claude surface, over one shared policy.

### Distribution, zero-onboarding, and surface parity

`adg init` (host-detect, install, and one real value-proof classification on your diff),
the `@adg/cli` dispatcher, `--client claude|codex|both`, `--dashboard on` for the
read-only dashboard, new slash commands, and a four-surface capability matrix
(`docs/adg-surfaces.md`, `docs/adg-distribution.md`).

### Agent setup guide

`docs/agent-setup-guide.md` is a paste-into-an-agent runbook: an agent reads it and sets
ADG up itself, either to evaluate the repo or to install it into a host, then operates
under the lanes, append-only audit, and release-gate rules.

## What 2.0 does not change (the floor stays)

The deny-by-default security floor, the append-only hash-chained audit log, the SQL-first
backlog, the evidence-tier lattice and release gate, the context broker, and the three
always-on controls (`destructiveDeny`, `auditAppendOnly`, `forbiddenBulkRead`) are all
intact and still enforced outside the model.

## Deferred follow-ups (planned, not shipped)

Flagged honestly so the release does not overclaim. These touch the hardened hook or the
adversarially-tested installer and were not done unattended:

- In-process PolicyEngine: a pure engine to replace the action-gate subprocess hop
  (performance only; delegation already works).
- Host-bundling of the new lifecycle hooks into installs (needs a bundler and an installer
  file-list change).
- `maxToolCalls` enforcement: declared in `loop-budget.json`, but the governor honors
  `maxTurns` today.
- Backpressure beyond Bash, per-lane context budgets, advisory-to-enforced lanes, a
  held-out loop eval, and P9 parity across the Codex adapter and SDK. See
  `research/improvement-plan.md`.

## Verification

The full gate is green: `npm run ci:governance` exits 0 (backlog, audit, guardrail,
asset, eval, metrics, and the elicitation/context/ux/standards/deliverable/plugin/
maturity/skills validators, the full tooling test suite, the doctor, and the
install/hook/codex/mcp suites). `npm run adg:doctor` reports conformant, 6 of 6 checks.

## Upgrade notes

- Root version moves from 1.1.0 to 2.0.0; the `@adg/core`, `@adg/sdk`, and `@adg/cli`
  packages are at 2.0.0.
- New policy files: `config/agentic/loop-budget.json` and `config/agentic/models.json`.
  Seven Claude Code hook events are now registered in
  `plugins/adg-governance/hooks/hooks.json`.
- The core still needs only Node 20 or newer and the `sqlite3` CLI. `npm install` remains
  optional, used only by the governance MCP server.
- Adopt or refresh a host with `npm run adg:install` / `npm run adg:update`; a routine
  update preserves a host's governed toggle state and never carries a relaxed always-on
  control forward. Check for drift with `npm run adg:doctor`.

## Sources

The build table and the vendor-SDK mapping are in `docs/adg-2.0-overhaul-plan.md`. The
principles and field map are in `loops-research.md` and
`research/agentic-field-map-2026-06-20.md`. The gap analysis, improvement plan, and
component dispositions are under `research/`; the per-principle self-audit is in
`docs/adg-scorecard.md`.
