---
title: Context Tooling Implementation Plan (design record)
status: implemented
classification: internal
category: agentic-delivery
---

# Context Tooling Implementation Plan

This is the design record for the deterministic, SQL-first context tooling. Phases
1–3 and most of 4 are implemented in this repo; it is kept as a reference for intent
and for the remaining work.

## Goal

Make the right agent context cheap, deterministic, and bounded:

```text
task -> classify -> SQL lookup -> capped context packet -> anchored files -> targeted checks
```

## Non-Goals

- Do not replace SQLite, SQL, or JSON/JSONL as canonical artifacts.
- Do not implement production RAG for the dev pipeline.
- Do not introduce unbounded autonomous loops.
- Do not bulk-load generated mirrors (SQL dumps, JSON mirrors, generated HTML) into model context.

## Phase 1 — Context broker ✅

A CLI that queries SQLite and emits a capped context packet.

```sh
npm run context:feature -- --feature S07 --workflow route --format markdown
npm run context:item -- --item S07-TASK-01 --workflow route --format json
npm run context:item -- --item S07-TASK-01 --workflow route --format toon
```

The packet returns: feature id/title/status/priority/release band; the selected
item; recent item events; linked routes; file anchors; recent audit events (capped);
required checks; forbidden bulk files; and the explicit next files to read. It does
**not** return whole generated docs, whole SQL dumps, generated HTML, or unrelated
features/routes/audit history.

Implementation: [`scripts/agent-context.mjs`](../../scripts/agent-context.mjs).

## Phase 2 — Context profiles ✅

Per-workflow profiles choose the queries and caps:
`route`, `rbac`, `db-migration`, `ui`, `integration`, `docs`, `agentic-tooling`.
Each defines max audit/event/route/file counts, required checks, forbidden bulk
globs, and guidance.

Implementation: [`config/agentic/context-profiles.yaml`](../../config/agentic/context-profiles.yaml).

## Phase 3 — TOON output ✅

JSON stays for machine storage; TOON is added only as a compact LLM-facing packet
format for uniform arrays (routes, items, audit summaries). Benchmark TOON against
compact JSON before defaulting; irregular packets fall back to JSON. (Measured:
the TOON packet is the smallest of the three formats — see
[`../token-reduction.md`](../token-reduction.md).)

## Phase 4 — Context-discipline checks ◑

```sh
npm run context:audit
```

Implemented: the broker writes a per-packet manifest and `context:audit` flags
forbidden bulk files and file-count-cap violations on the last manifest. Remaining:
deeper transcript introspection (verifying a packet was generated *before* material
work) is not done; today it is manifest-based.

## Phase 5 — Bounded agent loop ◑ (plan-only)

```sh
npm run agent:next -- --workflow route --max-items 1
npm run agent:loop -- --feature S07 --workflow route --max-items 3
```

Implemented as a **planner / packet generator**, not an autonomous editor. It emits
a bounded plan (which items, which next files, which checks) with explicit
constraints: a context packet per item, stop on failed checks, stop on unexpected
dirty files, and no production/billing/secrets/destructive/migration work unless the
workflow allows it and the user asked. Connecting it to automatic backlog claims and
verification is deliberately left as opt-in future work.
