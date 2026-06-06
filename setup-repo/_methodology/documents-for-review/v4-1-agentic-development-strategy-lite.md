---
title: V4.1 Agentic Development Strategy Lite
status: submitted for review
date: 2026-06-05
classification: internal
category: agentic-development
backlog_policy: not added to backlog or traceability tracker
---

# V4.1 Agentic Development Strategy Lite

## Purpose

This note proposes a lighter strategy for agentic development in bord.room V4.1.
It keeps the existing SQL-first delivery system, but makes the day-to-day agent
loop easier to run: smaller context, narrower skills, clearer risk gates, and
queryable evidence instead of prose-only progress.

## Reviewed Inputs

- `/Users/zach/Downloads/openmetadata_aws_high_level_design.html`
- `AGENTS.md`
- `docs/agentic-application-development-pipeline.md`
- `docs/agentic-ai-end-user-concept.md`
- `documents for review/v4-1-secure-mcp-server-requirements.md`
- `skills/bordroom-lite-build-runner/SKILL.md`
- `skills/bordroom-lite-traceability/SKILL.md`
- `config/agentic/context-profiles.yaml`
- `config/agentic/guardrails.json`
- `docs/traceability/v4-1-backlog.sqlite`
- `docs/traceability/v4-1-development-tracker.sqlite`
- `docs/traceability/v4-1-agent-evals.sql`
- `docs/traceability/v4-1-delivery-metrics.sql`

## Strategy

Treat agentic development as a metadata control plane for delivery.

OpenMetadata is useful as a pattern: it does not move business data; it connects
to source systems, extracts metadata, normalizes entities and relationships,
applies governance, then makes discovery, lineage, quality, and ownership
queryable.

bord.room should use the same idea for software delivery:

- Source systems: docs, code, routes, migrations, tests, backlog rows, evals,
  guardrails, and audit events.
- Metadata store: the existing SQLite backlog and tracker.
- Ingestion runtime: `scripts/agent-context.mjs`, backlog commands, tracker
  update scripts, generated-doc scripts, guardrail checks, evals, and metrics.
- Governance: `AGENTS.md`, Lite skills, risk-class guardrails, RBAC rules,
  entitlement rules, and required evidence.
- Lineage: feature -> persona -> route -> code file -> test -> evidence.

The core rule: SQL controls execution, Markdown explains intent, skills control
agent behavior, and generated artifacts are refreshed only when the source
changes or a checkpoint requires them.

## Operating Model

1. Query before reading.
   Use SQLite and `pnpm context:lite -- --feature Sxx` before opening broad docs.

2. Plan one feature slice.
   Name the feature, route or contract, persona/RBAC state, entitlement state,
   files in scope, negative tests, and likely verification command.

3. Design the boundaries before editing.
   Decide tenant scope, business scope, role, entitlement, page-state behavior,
   write authority, audit behavior, and failure mode.

4. Build narrowly.
   Edit only scoped implementation files and directly related tests. Do not
   create Markdown task lists that compete with the SQL backlog.

5. Test close to the change.
   Run targeted tests first. Use `pnpm backlog:fail` for failed commands so the
   SQL backlog remains truthful.

6. Record evidence once.
   Prefer one consolidated verification per feature slice when the same command
   proves several tasks, tests, use cases, or success criteria.

7. Escalate only at checkpoints.
   Use full traceability, generated-doc sync, and pre-push gates for process
   changes, release checkpoints, feature completion, or before pushing.

## Design Principles

- The SQL backlog is canonical for execution.
- Markdown is for human intent, review, and decisions.
- Context should be selected, not bulk-loaded.
- A feature slice is the normal unit of agent work.
- Every protected path checks entitlement, permission, and tenant/business scope.
- UI visibility is not authority; server checks and RLS remain authoritative.
- Read-only analysis ships before write automation.
- Consequential writes need explicit approval and durable audit evidence.
- Tool outputs are untrusted until validated and redacted.
- Failed checks are recorded as evidence, not hidden in summaries.
- Generated mirrors are products of source data, not places for hand edits.
- Agent changes should make the repo easier for the next agent to reason about.

## Skill Strategy

Keep the two existing Lite skills as the default:

- `bordroom-lite-build-runner`: day-to-day plan/design/build/test feature
  slices.
- `bordroom-lite-traceability`: concise SQL-first evidence without micro-event
  overhead.

Use the heavier installed skills only for broad or risky work:

- `$bordroom-build-runner`: release checkpoints, broad implementation
  orchestration, and commit-readiness.
- `$bordroom-traceability`: generated artifact sync, release evidence,
  architecture/UX/scope changes, and pre-push validation.

Recommended next skills:

| Skill | Helps With | Output |
|---|---|---|
| `bordroom-context-cartographer` | Turn a feature ID into a compact context packet and risk profile. | Scoped files, routes, tests, commands, and stop conditions. |
| `bordroom-rbac-boundary-reviewer` | Review tenant, business, role, entitlement, and RLS boundaries before edits. | Negative-test checklist and boundary risks. |
| `bordroom-route-truthfulness-reviewer` | Keep route registry, navigation, hidden/future routes, titles, and page states honest. | Route exposure findings and targeted tests. |
| `bordroom-db-migration-guardian` | Guard schema, migration, RLS, seed, and runtime repository alignment. | Migration risks plus `pnpm db:validate-migrations` guidance. |
| `bordroom-mcp-tool-designer` | Convert useful agent actions into safe MCP/tool contracts. | Tool schema, risk class, audit behavior, redaction, tests. |
| `bordroom-agent-eval-author` | Expand local evals for prompt injection, excessive agency, timeouts, and unsafe tool requests. | Scenario JSON plus expected assertions. |
| `bordroom-release-evidence-curator` | Prepare checkpoint evidence without overloading normal slices. | Evidence packet, generated-doc sync list, gate commands. |

Each skill should stay tiny. A good skill names:

- trigger;
- required SQL queries or context command;
- allowed reads and writes;
- required boundary decisions;
- verification commands;
- evidence to record;
- stop conditions.

## MCP And Tooling Stance

The secure MCP server should be an internal delivery and support tool first.
It should expose typed, audited, allowlisted tools over the existing backlog,
traceability, route, workflow, webhook, and platform-health surfaces.

Do not add:

- arbitrary SQL tools;
- arbitrary shell tools;
- secret-reading tools;
- destructive tools;
- tenant/customer-facing MCP access before a separate auth and security review.

The first useful tool set is read-mostly:

- `backlog_show`
- `traceability_status`
- `feature_persona_matrix`
- `route_registry_search`
- `route_exposure_check`
- `guardrail_policy_check`
- `agent_eval_summary`
- `audit_append_comment`

## OpenMetadata Fit

OpenMetadata can still be valuable for the broader data estate: PostgreSQL,
DynamoDB, dbt artifacts, DB2, identity ownership, lineage, glossary, tags, and
governance. It should not replace the repo SQL backlog.

For agentic development, use OpenMetadata thinking before adding OpenMetadata
infrastructure:

- catalog metadata, not raw business data;
- connect sources through least-privilege ingestion;
- normalize relationships into queryable entities;
- make lineage and ownership visible;
- treat profiling and samples as sensitive;
- prefer native lineage first, external graph analytics only if there is a real
  analysis need.

## Near-Term Path

1. Keep Lite delivery as default.
2. Add `bordroom-rbac-boundary-reviewer` and `bordroom-route-truthfulness-reviewer`
   first, because most V4.1 risk sits in scope, permissions, entitlements, and
   route truthfulness.
3. Add `bordroom-mcp-tool-designer` before implementing the internal MCP server.
4. Expand `tooling/agent-evals/scenarios/*.json` as each new skill or tool
   class lands.
5. Keep this strategy as a review note unless Zach decides to promote it into
   the generated V4.1 planning pack.

