---
title: Agentic Application Development Pipeline
release: V4.1
status: active planning
classification: internal
category: agentic-delivery
generated_at: 2026-06-02
tags:
  - v4.1
  - traceability
  - agentic-delivery
  - development-process
---

# Agentic Application Development Pipeline

## Purpose

This document describes the process established in the V4.1 planning chat for turning agent-assisted development into an auditable application delivery pipeline.

The process is not just "ask an agent to code." It now includes repository discovery, specialist review, a SQL-first solo-dev backlog, traceable planning artifacts, a root `AGENTS.md`, a reusable Codex skill, an append-only audit log, generated tracker mirrors, workspace-state tracking, guardrail policy, local agent evals, AI security scenarios, DORA-style metrics, and repeatable update commands.

In complete-dev mode, the operating unit is a feature slice: `plan -> design -> build -> test`. A slice should use a bounded context packet, decide the RBAC/scope/state contract before editing, build only the scoped files and tests, then run targeted checks before any full traceability/pre-push gate.

The project keeps SQL as the execution source of truth while adopting Lite delivery
as the default operating mode. Repo-local Lite skills live in `skills/` and encode
the lower-token feature-slice workflow without replacing the SQL backlog.

Interactive companion: `docs/interactive/agentic-application-development-pipeline.html`.

## Pipeline We Established

1. Review the repo and documentation base.
2. Split discovery across specialist agents: code map, architecture, QA, integrations, UX, and product.
3. Generate V4.1 release planning artifacts.
4. Create a queryable tracker with epics, features, user stories, use cases, routes, personas, tests, integrations, and docs.
5. Draft and publish `AGENTS.md` so future agents understand repo rules.
6. Create `$bordroom-traceability` as a reusable skill.
7. Add `scripts/v4-1-tracker-update.mjs` to record comments, status updates, evidence, test results, decisions, and scope changes.
8. Store audit entries in append-only `docs/traceability/v4-1-development-audit.jsonl`.
9. Mirror audit data into SQL, JSON, and SQLite.
10. Add a SQL-first backlog in `docs/traceability/v4-1-backlog.sqlite`.
11. Add local gates for audit validation, guardrails, agent evals, AI security scenarios, DORA metrics, and generated artifact drift.
12. Add `scripts/v4-1-workspace-audit.mjs`, `workspace-state` audit targets, and the `workspace_state_events` SQLite view for pre-existing dirty/untracked paths and local dependency installs.
13. Add the `delivery-slice` context profile so agents can plan, design, build, and test bounded slices without loading generated mirrors.
14. Add repo-local Lite skills for normal implementation while reserving the heavier traceability/build-runner flow for checkpoints.
15. Verify generated output and record audit evidence.

## Benchmark Summary

Overall maturity: SQL-first governed local pipeline.

Strong areas:
- Traceability from feature to docs, routes, tests, personas, integrations, and audit events.
- Human review before publishing `AGENTS.md`.
- Repeatable update command and durable audit source.
- Workspace-state records for dirty/untracked baselines and local setup work.
- Multi-agent decomposition aligned with specialist workflow patterns.
- SQL backlog replaces Linear as the active solo-dev source of truth.
- Guardrail policy, eval scenarios, AI security checks, and DORA metrics run locally.

Implemented gates:
- `pnpm backlog:validate`
- `pnpm workspace:status`
- `pnpm workspace:audit -- --target worktree-baseline --summary "Preserved pre-existing dirty state"`
- `pnpm audit:validate`
- `pnpm guardrails:check`
- `pnpm agent:evals`
- `pnpm metrics:dora`
- `pnpm drift:generated`
- `pnpm ci:traceability`
- `.github/workflows/traceability-guard.yml`

Fast-lane rule:
- During implementation, run the targeted checks named by the context packet and the touched package.
- Record failed test runs with `pnpm backlog:fail` so the SQL backlog remains truthful.
- Reserve `pnpm ci:traceability` and `pnpm dev:prepush` for feature completion, process/tooling changes, release checkpoints, or before push.

## Remaining Improvements

1. Move route and integration registries out of generator metadata into versioned source config.
2. Add signed audit events once key handling policy is decided.
3. Expand eval scenarios into full agent task fixtures with expected artifacts and scorecards.
4. Add runtime trace correlation for model calls, tool calls, handoffs, guardrails, and costs when an agent runtime is introduced.
5. Connect tracker status to GitHub issues/PRs if solo-dev workflow later needs external issue tracking.
6. Create an HTML audit dashboard from the SQLite tracker.

## Benchmark Sources

- OpenAI Agents SDK: https://developers.openai.com/api/docs/guides/agents
- OpenAI Agents SDK tracing: https://openai.github.io/openai-agents-python/tracing/
- OpenAI Agents SDK guardrails: https://openai.github.io/openai-agents-python/guardrails/
- Anthropic Building Effective Agents: https://www.anthropic.com/engineering/building-effective-agents
- DORA metrics: https://dora.dev/guides/dora-metrics/
- NIST SSDF SP 800-218: https://csrc.nist.gov/pubs/sp/800/218/final
- NIST AI RMF: https://www.nist.gov/itl/ai-risk-management-framework
- OWASP Top 10 for LLM Applications 2025: https://genai.owasp.org/resource/owasp-top-10-for-llm-applications-2025/
- Microsoft AI Red Team: https://learn.microsoft.com/en-us/security/ai-red-team/
