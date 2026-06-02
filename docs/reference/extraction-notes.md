---
title: Extraction Notes & Provenance
status: active
classification: internal
category: agentic-delivery
---

# Extraction Notes & Provenance

Captured: 2026-06-02

## What this is

This repository is the **agent governance layer extracted from a product
repository** (an internal multi-tenant operations platform, "V4.1") and generalized
into a standalone, reusable sub-app for future agentic work. The product repo
invented the model while shipping a real product; this repo lifts the *model* out so
it can be adopted by any project without dragging the product with it.

Nothing here contains product code, customer data, secrets, or the product's backlog
content. The seed (`data/seed/backlog.seed.json`) is fresh, self-referential demo
data describing this platform's own components.

## What was reused (and generalized)

| Source artifact | Here | Change |
|---|---|---|
| Root `AGENTS.md` | [`AGENTS.md`](../../AGENTS.md) | Kept the universal governance sections; product specifics replaced by a clearly-marked "Project Profile" to fill in per repo. |
| `config/agentic/guardrails.json` | same path | Generic already; only `policyVersion` re-stamped. |
| `config/agentic/context-profiles.yaml` | same path | `forbiddenBulkFiles` and required checks re-pointed at this repo's generic paths/commands. |
| Context broker | [`scripts/agent-context.mjs`](../../scripts/agent-context.mjs) | Consolidated from a two-database (tracker + backlog) design to a **single** `data/backlog.sqlite`; commands de-branded to `npm run`. |
| SQL backlog engine | [`scripts/backlog-db.mjs`](../../scripts/backlog-db.mjs) | Generalized schema; seeds from a generic JSON instead of a product/Linear export; added `routes`/`integrations`/`audit_events` and a `feature_current_status` view so the broker works against one DB. |
| Guardrail check, eval runner, DORA | `scripts/guardrail-check.mjs`, `scripts/run-agent-evals.mjs`, `scripts/dora-metrics.mjs` | Output paths moved under `data/`; logic unchanged. |
| Audit validator | [`scripts/validate-audit.mjs`](../../scripts/validate-audit.mjs) | Rewritten as a clean, self-contained validator (the original delegated to a second file). |
| Eval scenarios | [`tooling/agent-evals/scenarios/`](../../tooling/agent-evals/scenarios/) | De-branded; OWASP/NIST risk tags preserved. |
| Codex skills | [`skills/`](../../skills/) | `bordroom-traceability` → `agentic-traceability`, `bordroom-build-runner` → `agentic-build-runner`; reference generic commands. |
| Pipeline / "old toolding" notes | [`../architecture/`](../architecture/), this file | Generalized into the architecture and reference docs. |

## What was intentionally left behind (product-specific)

These existed in the source repo but are product-coupled and are **not** part of the
reusable layer. They are documented as host-repo extension points:

- **Route-registry generator / check** — derived routes from a specific Next.js app.
  Host apps can re-add a `route-registry:check` gate that populates the `routes` table.
- **Generated-artifact drift check** — guarded product-specific generated docs/HTML.
- **Planning-doc generator** — produced the product's Markdown/HTML/SVG planning pack
  and the second "tracker" database. Replaced here by the single seeded backlog.
- The product's multi-megabyte backlog/tracker mirrors and the Obsidian vault config.

Because of this, the default gate here is `ci:governance` (backlog, audit,
guardrails, evals, DORA, context-broker test) rather than the product's broader
`ci:traceability`. A waiver for the dropped route-registry gate is recorded as a
`decision` event in the seeded audit log, as the model prescribes.

## Adopting this layer in a new repo

1. Copy `config/`, `scripts/`, `tooling/`, `data/schema.sql`, and `AGENTS.md`.
2. Replace `data/seed/backlog.seed.json` with the host project's backlog.
3. Fill in the "Project Profile" section of `AGENTS.md`.
4. Install the skills (see [`../../skills/README.md`](../../skills/README.md)).
5. `npm run setup && npm run ci:governance`.
6. Add host-specific gates (route registry, typecheck, lint, tests) to `ci:governance`.

## Reversibility

The layer is deliberately small and side-effect-light: `node` scripts + the
`sqlite3` CLI + JSONL/JSON/YAML config. The generated database is disposable
(`.gitignore`d, rebuilt by `setup`). Removing the layer from a host repo means
deleting `scripts/`, `config/agentic/`, `tooling/`, and `data/` and the related
`package.json` scripts; nothing patches the host application at runtime.
