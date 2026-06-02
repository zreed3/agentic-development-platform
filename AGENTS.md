# AGENTS.md

## Project

This repository is the **Agentic Development Platform**: a SQL-first, deny-by-default
governance layer for agent-assisted software development. It provides risk-class
guardrails, an append-only audit log, AI-security evals, DORA-style delivery metrics,
a SQL backlog engine, and a context broker that keeps token usage bounded.

It is both a working tool (it governs its own development — the seeded backlog
describes its own components) and a **template** other repos adopt. When you work
here, follow these rules. When this file is copied into a host repo, fill in the
*Project Profile* below for that project.

> ### Project Profile (replace per repo)
> - **Product:** _what this codebase is._
> - **Primary surfaces / packages:** _where the important code lives._
> - **RBAC / scope model:** _roles, tenancy, entitlements, if any._
> - **Integrations & lifecycle states:** _live / partial / stub / planned._
> - **Host-specific gates:** _typecheck, lint, tests, route registry, migrations._
>
> For this repo specifically, the platform *is* the product; the sections below are
> the authoritative rules.

## Repo Shape

- `config/agentic/` — `guardrails.json` (risk-class policy) and
  `context-profiles.yaml` (per-workflow context budgets).
- `scripts/` — the governance scripts (backlog engine, context broker, guardrail
  check, eval runner, DORA metrics, audit validate/record).
- `tooling/agent-context/` — context-broker manifests and smoke test.
- `tooling/agent-evals/scenarios/` — AI-security eval fixtures.
- `skills/` — portable Codex skills (`agentic-traceability`, `agentic-build-runner`).
- `data/` — the SQL data layer: `schema.sql`, `seed/`, `audit/`, and the generated
  (gitignored) SQLite database.
- `docs/` — architecture, the governance model, token-reduction, the SQL data layer,
  and reference/provenance notes.

## Commands

The platform needs only Node (>= 20) and the `sqlite3` CLI. There are no runtime
dependencies to install.

- Build/refresh the database: `npm run setup`
- Validate the backlog: `npm run backlog:validate`
- Validate the audit log: `npm run audit:validate`
- Record an audit event: `npm run audit:record -- --feature S07 --type status --status in-progress --summary "..."`
- Check the guardrail policy: `npm run guardrails:check`
- Run agent evals / AI-security scenarios: `npm run agent:evals`
- Capture delivery metrics: `npm run metrics:dora`
- Context broker test: `npm run test:agent-context`
- **Full gate:** `npm run ci:governance`
- Context packets: `npm run context:feature -- --feature S07 --workflow route`

## Guardrails And Risk Classes

`config/agentic/guardrails.json` is **deny-by-default**. Every tool maps to a risk
class:

- `read-only`, `generated-artifact`, `code-change` — run freely.
- `migration`, `secrets`, `billing`, `production` — require confirmation.
- `destructive` — denied by default; needs an explicit user request.

Before performing a sensitive action, resolve it against the policy
(`npm run guardrails:check -- --tool <name>`) and supply the `requiredEvidence`.
Do not weaken the policy to make work proceed; if a gate must be waived, record a
`decision` audit event with reason, risk, and rollback.

## SQL-First Backlog

The canonical backlog is `data/backlog.sqlite`, rebuilt from
`data/seed/backlog.seed.json` and `data/audit/audit-log.jsonl`. Treat the SQLite
database as generated and queryable; treat `data/backlog-source.sql` and
`data/schema.sql` as the reviewable mirrors. Do not invent a parallel spreadsheet or
Markdown-only backlog — the SQL backlog is the requirements/elicitation system.

Use the item lifecycle (`backlog:next` → `claim` → `start` → `complete` → `verify`)
and keep current state *derived* from events, never hand-edited. See
[`docs/sql-data-layer.md`](docs/sql-data-layer.md).

## Append-Only Audit And Traceability

`data/audit/audit-log.jsonl` is **append-only**. Never delete or rewrite an event;
append a corrective `comment` or `decision`. Never put secrets, tokens, or customer
data in audit events (`audit:validate` will flag likely secrets). Record an audit
event before finishing material work. Use `$agentic-traceability` for the full
discipline.

## Context Discipline

Generate a bounded context packet **before** opening source files, and read only the
files the packet names unless local evidence points elsewhere. Never bulk-load the
generated mirrors — they are on the `forbiddenBulkFiles` denylist precisely because
they blow up the context window. See [`docs/token-reduction.md`](docs/token-reduction.md).

## Required Delivery Gates

Before finishing material work, run the relevant gates:
- `npm run backlog:validate` after backlog changes.
- `npm run audit:validate` after any audit append.
- `npm run guardrails:check` when tool/action policy changes.
- `npm run agent:evals` for guardrail, eval, or AI-security changes.
- `npm run metrics:dora` for delivery-process changes.
- `npm run ci:governance` before considering work done.

If no reviewer is available, enforce strict solo-dev gates. Any waived gate needs an
audit `decision` event with reason, risk, and rollback.

## Security Rules

Never commit secrets, real credentials, tokens, private keys, or customer data.
Security-sensitive changes should include negative tests where possible (denial
paths, scope/role/permission boundaries). Do not weaken auth, encryption, or policy
behavior to make a test pass.

## Testing Expectations

Use risk-based testing. For narrow changes, run targeted checks; for policy, schema,
or broker changes, run `npm run ci:governance`. Add or update an eval scenario when
you change the guardrail policy or an AI-security behavior.

## Agent Behavior

- Read code before changing it; prefer implementation over only proposing when asked.
- Ask only when a missing decision is genuinely risky.
- Verify work before finalizing; report checks that passed and checks that could not run.
- For subagent work: each subagent should run the relevant `context:*` command and
  stay within the returned packet. Prefer subagents for read-heavy exploration,
  review, and triage; avoid parallel write-heavy work unless explicitly asked. Keep
  the SQL backlog, audit log, and final integration in the parent agent.
- The worktree may contain user changes. Never revert changes you did not make unless
  explicitly asked, and never use destructive git commands without an explicit request.
