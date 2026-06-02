---
title: The Governance Model
status: active
classification: internal
category: agentic-delivery
---

# The Governance Model

This platform is an SDLC governance layer whose *workforce is agents*. It applies
the apparatus normally used to govern a regulated engineering org — audit trails,
deny-by-default policy, delivery metrics, adversarial testing — to a setting where
the thing being governed is an AI collaborator, often with a single human in the
loop. Five design principles drive every component.

## 1. Treat your own generated artifacts as context *hazards*, not assets

The intuitive move is "we have a rich tracker JSON, a full SQL dump, and an
interactive dashboard — feed it all to the agent so it is well-informed." This
platform does the opposite. Those exact files are on a denylist
(`forbiddenBulkFiles`), and **SQLite is positioned as the thing that *selects* a
capped packet of context** instead.

The reasoning is quantitative: a normal instruction set (`AGENTS.md` + a skill + a
context packet) is a few KB / a few thousand tokens, while bulk-loading generated
mirrors can run to hundreds of thousands or millions of tokens. Your richest
artifacts are the ones most likely to poison the context window, so the broker's
whole job is to *withhold* them and hand back only pointers.

- **Mechanism:** [`scripts/agent-context.mjs`](../../scripts/agent-context.mjs),
  [`config/agentic/context-profiles.yaml`](../../config/agentic/context-profiles.yaml).
- **Evidence:** [`../token-reduction.md`](../token-reduction.md).

## 2. Build the governance for an audience of agents

The audit trail, the append-only event log, the DORA metrics, the
"decision event with reason / risk / rollback" — that is the machinery of a
regulated engineering org. But there may be no team here. The line
*"if no reviewer is available, enforce strict solo-dev gates"* gives the game away:
the bureaucracy of an enterprise SDLC exists so that the work of a **non-human
collaborator is non-repudiable**. Solo-dev tooling is usually about speed; this is
about accountability.

- **Mechanism:** [`scripts/record-audit.mjs`](../../scripts/record-audit.mjs),
  [`scripts/validate-audit.mjs`](../../scripts/validate-audit.mjs), the gate chain in
  [`package.json`](../../package.json).

## 3. Threat-model your own agents as untrusted insiders

Guardrails default to `deny`. The eval scenarios encode prompt injection,
cross-scope escalation, and excessive agency as *standing assumptions* rather than
reactions — the agent **will** be prompt-injected or will try to over-reach, so the
denials and field redaction are written ahead of time. Pairing NIST SSDF (secure
development) + NIST AI RMF + OWASP LLM Top 10 is a deliberate "this is both an SDLC
problem and an AI-risk problem" posture.

- **Mechanism:** [`config/agentic/guardrails.json`](../../config/agentic/guardrails.json),
  [`tooling/agent-evals/scenarios/`](../../tooling/agent-evals/scenarios/),
  [`scripts/run-agent-evals.mjs`](../../scripts/run-agent-evals.mjs).

## 4. Borrow append-only discipline from event sourcing

> Never rewrite an audit event. If a past one was wrong, append a corrective
> `comment` or `decision` event.

Immutability is the point: neither the agent *nor a future you* can quietly launder
history. The current state (a feature's status, an item's lifecycle) is always
**derived** from the event stream via SQL views, never edited in place. That makes
the trail a real trust primitive instead of decoration.

- **Mechanism:** append-only [`data/audit/audit-log.jsonl`](../../data/audit/audit-log.jsonl);
  the `feature_current_status` and `backlog_item_current_status` views in
  [`scripts/backlog-db.mjs`](../../scripts/backlog-db.mjs) fold events into current state.

## 5. Restraint in the implementation

For all the conceptual ambition, the whole thing is `node scripts/*.mjs` + the
`sqlite3` CLI + JSONL. No SaaS, no heavy agent framework, no vector database
("do not implement production RAG for the dev pipeline" is an explicit non-goal).
It is grep-able, diffable, offline, and fast. TOON exists *only* as a compact
LLM-facing transport, with JSON/SQL/SQLite kept canonical — count tokens, do not
cargo-cult.

- **Mechanism:** zero runtime dependencies (see [`package.json`](../../package.json));
  TOON is render-only in the broker and never a stored artifact.

## The honest tension

The one place governance is deliberately switched *off* is the experiment about
*how to feed context to agents* — historically carved out as out-of-band, reversible
tooling. The tooling for governance escaped the governance. Extracting it into this
standalone platform is the resolution: the context broker is now a first-class,
tested, gated component (feature `S07` in the seed) rather than an un-audited
side-experiment. Keep that pressure valve deliberate: when ceremony starts getting
*routed around* instead of followed, make the routing explicit and bring it back
under a gate.
