---
title: Agentic Application Development Pipeline
status: active
classification: internal
category: agentic-delivery
generated_at: 2026-06-02
tags:
  - agentic-delivery
  - traceability
  - development-process
---

# Agentic Application Development Pipeline

## Purpose

This document describes the process for turning agent-assisted development into an
**auditable application delivery pipeline**. It is the generalized form of a
pipeline first built inside a product repository and then extracted into this
standalone platform (see [`../reference/extraction-notes.md`](../reference/extraction-notes.md)).

The process is not just "ask an agent to code." It adds repository discovery, a
SQL-first backlog, a root `AGENTS.md`, reusable skills, an append-only audit log,
generated-but-reviewable mirrors, guardrail policy, local agent evals, AI-security
scenarios, DORA-style metrics, a context broker, and repeatable gate commands.

## The Pipeline

1. Review the repository and its documentation base.
2. Split discovery across specialist passes: code map, architecture, QA,
   integrations, UX, and product.
3. Capture scope as a **SQL-first backlog** (`data/backlog.sqlite`) with epics,
   features, items, routes, personas, tests, integrations, and dependencies.
4. Publish a root `AGENTS.md` so every agent reads the same rules first.
5. Install reusable skills (`agentic-traceability`, `agentic-build-runner`).
6. Record comments, status, evidence, test results, and decisions as events in the
   append-only `data/audit/audit-log.jsonl`.
7. Mirror the audit/backlog data into SQL, schema, and (optionally) JSON for review.
8. Run local gates: backlog validation, audit validation, guardrail policy, agent
   evals, AI-security scenarios, DORA metrics.
9. Use the **context broker** to select bounded context packets instead of
   bulk-loading generated artifacts.
10. Verify generated output and record audit evidence before finishing material work.

## Maturity Summary

Overall posture: **SQL-first, governed, local pipeline.**

Strong areas:
- Traceability from feature → items → routes → tests → personas → audit events.
- Human review of `AGENTS.md` before agents act on it.
- Repeatable gate command and a durable, append-only audit source.
- Guardrail policy, eval scenarios, AI-security checks, and DORA metrics run locally and offline.
- Bounded context selection keeps token usage predictable (see [`../token-reduction.md`](../token-reduction.md)).

Implemented gates (this repo):
- `npm run backlog:validate`
- `npm run audit:validate`
- `npm run guardrails:check`
- `npm run agent:evals`
- `npm run metrics:dora`
- `npm run test:agent-context`
- `npm run ci:governance` (runs all of the above)

## Remaining Improvements

1. Move route/integration registries into versioned source config in host repos.
2. Add signed audit events once key-handling policy is decided.
3. Expand eval scenarios into full agent task fixtures with expected artifacts and scorecards.
4. Add runtime trace correlation for model calls, tool calls, handoffs, guardrails, and costs when an agent runtime is introduced.
5. Optionally connect tracker status to GitHub issues/PRs when external issue tracking is needed.
6. Build an HTML audit dashboard from the SQLite tracker.

## Benchmark Sources

- OpenAI Agents SDK: https://developers.openai.com/api/docs/guides/agents
- OpenAI Agents SDK tracing: https://openai.github.io/openai-agents-python/tracing/
- OpenAI Agents SDK guardrails: https://openai.github.io/openai-agents-python/guardrails/
- Anthropic, Building Effective Agents: https://www.anthropic.com/engineering/building-effective-agents
- DORA metrics: https://dora.dev/guides/dora-metrics/
- NIST SSDF SP 800-218: https://csrc.nist.gov/pubs/sp/800/218/final
- NIST AI RMF: https://www.nist.gov/itl/ai-risk-management-framework
- OWASP Top 10 for LLM Applications 2025: https://genai.owasp.org/resource/owasp-top-10-for-llm-applications-2025/
- Microsoft AI Red Team: https://learn.microsoft.com/en-us/security/ai-red-team/
