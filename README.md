# Agentic Development Governance (ADG)

**Governance, traceability, elicitation, maturity scoring, and bounded context for
agent-assisted software development — in a handful of Node scripts and SQLite
files.**

Hand an AI agent your codebase and two failure modes dominate: it does too much
(unbounded, unaudited, occasionally destructive actions), or it drowns in context
(you paste the whole tracker into the prompt and burn six figures of tokens before
it writes a line). This platform is a small, local control plane that fixes both. It
gives an AI collaborator the apparatus of a regulated engineering org — deny-by-default
guardrails, an append-only audit trail, AI-security evals, delivery metrics, a
SQL-first backlog, **feature elicitation as code**, and **maturity as code** — plus
a **context broker** that keeps token usage bounded by *refusing* to load the
artifacts that blow up a context window.

It runs on nothing but **Node (≥ 20) and the `sqlite3` CLI.** No SaaS, no agent
framework, no vector database, no API keys. Everything is grep-able, diffable,
offline, and the full gate runs in seconds.

## The idea in one line

> **SQLite *selects* the context.** Your richest generated artifacts are treated as
> hazards, not assets — and a relational backlog database hands the agent a few-KB
> packet of pointers instead.

```text
task -> classify -> SQL lookup -> capped context packet -> anchored files -> targeted checks
```

For delivery speed, the default operating unit is a **feature slice**:
`plan -> design -> build -> test`. The slice profile keeps context tighter, runs
targeted checks during implementation, records failures explicitly, and reserves the
full governance gate for feature/release checkpoints.

## What makes it different

Most of the ingredients here exist somewhere. The combination, and one specific
inversion, are uncommon:

- **Generated artifacts are context *hazards*.** The mainstream context tools
  (Repomix, code2prompt, files-to-prompt) maximize what they pack in. This does the
  opposite: the full SQL dump, JSON mirrors, and generated HTML sit on a
  `forbiddenBulkFiles` denylist, and the database returns the same information in
  bounded form. Aider's repo map is the closest cousin — but it ranks *code symbols*;
  this selects by *project intent and traceability* (feature → items → routes →
  anchors → audit).
- **Governance whose audience is an agent, not an auditor.** The audit log, DORA
  metrics, and `decision` events with reason/risk/rollback are enterprise-SDLC
  machinery — applied so that a *non-human collaborator's* work is non-repudiable,
  even for a team of one. "If no reviewer is available, enforce strict solo-dev gates."
- **Security as a pre-merge gate, for your own agent.** Tools are deny-by-default,
  and prompt-injection / excessive-agency / resilience scenarios (mapped to OWASP LLM
  and NIST AI-RMF) run *before* work is "done" — the agent is treated as an untrusted
  insider, not a trusted teammate.
- **Append-only by construction.** The audit log is event-sourced; current state
  (a feature's status, an item's lifecycle) is always *derived* via SQL views, never
  edited in place. Neither the agent nor a future you can quietly launder history.
- **Deliberately small.** `node` + `sqlite3` + JSONL. The richest part of the system
  is a stance, not a dependency tree.

This is an honest "uncommon," not "unprecedented": it's an assembly of known
patterns executed with unusual discipline, plus the context inversion, which is the
genuinely fresh part.

## Why bounded context pays off

Measured on the seeded demo backlog, a context packet is **~2.0 KB (TOON) / ~2.8 KB
(markdown)** versus the **~26 KB SQL dump and ~164 KB database** it stands in for. At
real-project scale the gap is the decisive one: the source project's generated
mirrors ran to **multiple megabytes** each — *hundreds of thousands of tokens* — while
the bounded instruction set stayed around **4–7k tokens**. The full method and how to
reproduce it: [`docs/token-reduction.md`](docs/token-reduction.md).

## Quickstart

```sh
# Requirements: Node >= 20 and the sqlite3 CLI on PATH.
# ADG is not currently published on npm; copy or clone it into your development folder.
npm run setup            # build an empty data/backlog.sqlite from schema + empty seed
npm run setup:demo       # optional: load the self-referential ADG worked example
npm run ci:governance    # the full gate; loads the demo fixture for governance checks
npm run elicitation:packet -- --feature S07 --format toon
npm run elicitation:graph -- --feature S07 --format toon
npm run context:slice -- --feature S07 --workflow agentic-tooling
npm run ux:validate
npm run standards:validate
npm run deliverable:audit
npm run plugin:validate
npm run maturity:score -- --format toon

# Ask the broker for a bounded packet instead of opening files blind:
npm run context:feature -- --feature S07 --workflow route
npm run context:item -- --item S07-TASK-01 --workflow route --format toon
npm run context:feature -- --feature S07 --workflow delivery-slice
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
| **Elicitation as code** | `config/agentic/elicitation.json`, `scripts/adg-elicitation.mjs` | Feature brief → RBAC stories → requirements → contracts → scenarios → gaps. |
| **Requirements graph / UX as code** | `config/agentic/ux-as-code.json`, `scripts/adg-ux.mjs` | SQL graph lineage from feature intent to UX contracts, journeys, states, and test evidence. |
| **Standards as code** | `config/agentic/standards-map.json`, `scripts/adg-standards.mjs` | Local control evidence mapped to global ISMS, secure SDLC, AI-risk, and GenAI security references. |
| **Deliverable auditability** | `config/agentic/deliverables.json`, `scripts/adg-deliverable.mjs` | Records source inputs, graph slices, files, tests, decisions, and evidence for bug and rework triage. |
| **Maturity as code** | `config/agentic/maturity.json`, `scripts/adg-maturity.mjs` | 1.0-5.0 scorecards for required ADG domains, with evidence and gaps. |
| **Codex plugin package** | `plugins/adg-codex-plugin/` | Standalone Codex plugin package plus neutral manifest for future agent clients; deterministic controls, not a runtime. |
| **Agent skills** | `skills/agentic-*`, `skills/adg-*`, `config/agentic/skill-manifest.json` | Portable disciplines plus generic as-code skills validated by manifest. |
| **Rulebook** | `AGENTS.md` | What every agent reads first; also a per-repo template. |

## Documentation

- [`AGENTS.md`](AGENTS.md) — the agent rulebook / per-repo template.
- [`docs/architecture/governance-model.md`](docs/architecture/governance-model.md) — the five design principles.
- [`docs/architecture/agentic-application-development-pipeline.md`](docs/architecture/agentic-application-development-pipeline.md) — the end-to-end pipeline and benchmark sources.
- [`docs/roadmap-review-overview.md`](docs/roadmap-review-overview.md) — the external review summary and ADG roadmap.
- [`docs/setup.html`](docs/setup.html) — static setup page with manual install and Otterblock contact details.
- [`docs/sql-data-layer.md`](docs/sql-data-layer.md) — the SQL "server": schema, views, and the item lifecycle.
- [`docs/token-reduction.md`](docs/token-reduction.md) — how context stays cheap, with measured numbers.
- [`docs/reference/`](docs/reference/) — the context-tooling design record and extraction/provenance notes.
- [`skills/README.md`](skills/README.md) — installing the skills.

## Repository layout

```
agentic-development-governance/
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

The generated `data/*.sqlite` databases are gitignored. A clean install starts
empty with `npm run setup`; the self-referential worked example is opt-in with
`npm run setup:demo`. This mirrors the platform's own rule: SQLite is queried,
never treated as canonical.

## Adopting it in another repo

Copy `config/`, `scripts/`, `tooling/`, `data/schema.sql`, and `AGENTS.md`; replace
`data/seed/backlog.seed.json` with your project's backlog; fill in the *Project
Profile* in `AGENTS.md`; install the skills; then `npm run setup` to start from
an empty SQL database, or `npm run ci:governance` to run the bundled
worked-example checks. Full steps in
[`docs/reference/extraction-notes.md`](docs/reference/extraction-notes.md).

For Codex marketplace distribution, use the standalone package in
[`plugins/adg-codex-plugin`](plugins/adg-codex-plugin). It vendors the
deterministic core scripts and includes marketplace metadata for the dedicated
`zreed3/adg-codex-plugin` repository.

## License

**Source-available, non-commercial.** Licensed under the
[PolyForm Noncommercial License 1.0.0](LICENSE) — free to use, modify, and share for
any **non-commercial** purpose.

**All commercial rights are reserved by Otterblock Pty Ltd** (ABN 91 614 672 794),
which retains full ownership of and all rights in this software. Commercial use
requires a separate commercial license — contact **zach+github@otterblock.com**.

(Note: a non-commercial restriction makes this *source-available* rather than OSI
"open source." The label is deliberate.)

---

© 2026 Otterblock Pty Ltd · ABN 91 614 672 794 · ACN 614 672 794. All rights reserved.
