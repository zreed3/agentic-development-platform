# Agentic Development Platform

A **SQL-first, deny-by-default governance layer for agent-assisted software
development.** It gives an AI collaborator the apparatus of a regulated engineering
org — risk-class guardrails, an append-only audit trail, AI-security evals, delivery
metrics, and a SQL backlog — and a **context broker** that keeps token usage bounded
by refusing to bulk-load the very artifacts that blow up a context window.

It runs on nothing but **Node (≥ 20) and the `sqlite3` CLI**. No SaaS, no agent
framework, no vector database. Everything is grep-able, diffable, offline, and fast.

> This repo is the governance *model* extracted from a real product and generalized
> into a reusable sub-app for future agentic work. See
> [`docs/reference/extraction-notes.md`](docs/reference/extraction-notes.md).

## The core idea

The intuitive move — "feed the agent the whole tracker so it's well-informed" — is a
trap. Generated trackers, SQL dumps, and dashboards are exactly what overflows a
context window. So this platform **inverts it: SQLite *selects* the context.** A task
is classified into a workflow, the broker runs a few capped SQL queries, and the
agent gets a small packet of pointers — and an explicit "do not bulk read" list.

```text
task -> classify -> SQL lookup -> capped context packet -> anchored files -> targeted checks
```

Measured on the seeded demo backlog: a context packet is **~2 KB (TOON) / ~2.8 KB
(markdown)** versus the **~26 KB SQL dump and ~164 KB database** it replaces — and at
real-project scale that is the difference between **a few thousand tokens and
hundreds of thousands**. See [`docs/token-reduction.md`](docs/token-reduction.md).

## Quickstart

```sh
# Requirements: Node >= 20 and the sqlite3 CLI on PATH. No npm install needed.
npm run setup            # build data/backlog.sqlite from schema + seed + audit log
npm run ci:governance    # run the full gate (backlog, audit, guardrails, evals, dora, broker)

# Ask the broker for a bounded packet instead of opening files blind:
npm run context:feature -- --feature S07 --workflow route
npm run context:item -- --item S07-TASK-01 --workflow route --format toon
```

## What's inside

| Component | Files | What it does |
|---|---|---|
| **Guardrail policy** | `config/agentic/guardrails.json`, `scripts/guardrail-check.mjs` | Deny-by-default risk classes; required evidence and confirmation per tool. |
| **Append-only audit** | `data/audit/audit-log.jsonl`, `scripts/record-audit.mjs`, `scripts/validate-audit.mjs` | Event-sourced, never rewritten, secret-scanned. |
| **AI-security evals** | `tooling/agent-evals/scenarios/`, `scripts/run-agent-evals.mjs` | Prompt-injection / excessive-agency / resilience scenarios mapped to OWASP LLM & NIST AI-RMF. |
| **Delivery metrics** | `scripts/dora-metrics.mjs` | DORA-style proxies from local git + the audit log. |
| **SQL backlog ("the SQL server")** | `scripts/backlog-db.mjs`, `data/schema.sql`, `data/seed/` | One SQLite DB; claim/start/complete/verify lifecycle; reviewable SQL mirrors. |
| **Context broker** | `scripts/agent-context.mjs`, `config/agentic/context-profiles.yaml` | Bounded packets in markdown/json/toon; forbids bulk files. |
| **Codex skills** | `skills/agentic-traceability`, `skills/agentic-build-runner` | Portable disciplines installable into `~/.codex/skills`. |
| **Rulebook** | `AGENTS.md` | What every agent reads first; also a per-repo template. |

## Documentation

- [`AGENTS.md`](AGENTS.md) — the agent rulebook / per-repo template.
- [`docs/architecture/governance-model.md`](docs/architecture/governance-model.md) — the five design principles.
- [`docs/architecture/agentic-application-development-pipeline.md`](docs/architecture/agentic-application-development-pipeline.md) — the end-to-end pipeline and benchmark sources.
- [`docs/sql-data-layer.md`](docs/sql-data-layer.md) — the SQL "server": schema, views, and the item lifecycle.
- [`docs/token-reduction.md`](docs/token-reduction.md) — how context stays cheap, with measured numbers.
- [`docs/reference/`](docs/reference/) — the context-tooling design record and extraction/provenance notes.
- [`skills/README.md`](skills/README.md) — installing the skills.

## Repository layout

```
agentic-development-platform/
├── AGENTS.md                      # agent rulebook + per-repo template
├── package.json                   # governance gate + lifecycle commands (npm run ...)
├── config/agentic/
│   ├── guardrails.json            # deny-by-default risk-class policy
│   └── context-profiles.yaml      # per-workflow context budgets
├── scripts/                       # backlog engine, context broker, gates
├── tooling/
│   ├── agent-context/             # broker manifests + smoke test
│   └── agent-evals/scenarios/     # AI-security fixtures
├── skills/                        # portable Codex skills
├── data/
│   ├── schema.sql                 # generated, reviewable DDL
│   ├── seed/backlog.seed.json     # editable backlog seed
│   └── audit/audit-log.jsonl      # append-only audit source
└── docs/                          # architecture, governance model, token reduction
```

The generated `data/*.sqlite` databases are gitignored; they are rebuilt from the
tracked text sources by `npm run setup`. This mirrors the platform's own rule:
SQLite is queried, never treated as canonical.

## Adopting it in another repo

Copy `config/`, `scripts/`, `tooling/`, `data/schema.sql`, and `AGENTS.md`; replace
`data/seed/backlog.seed.json` with your project's backlog; fill in the *Project
Profile* in `AGENTS.md`; install the skills; then `npm run setup && npm run
ci:governance`. Full steps in
[`docs/reference/extraction-notes.md`](docs/reference/extraction-notes.md).

## License

MIT — see [`LICENSE`](LICENSE).
