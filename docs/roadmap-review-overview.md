---
title: ADG Roadmap and Review Overview
status: active
classification: public
category: roadmap
---

# ADG Roadmap and Review Overview

This document turns the external review notes into a publishable roadmap for
Agentic Development Governance (ADG). The core verdict is positive: ADG is strongest
when it stays a local agent SDLC control plane, not another agent framework.

ADG should sit underneath or around agent runtimes. Its job is to keep agent work
bounded, evaluated, traceable, sandboxed, and reviewable.

## Review Verdict

The strongest design choice is SQL-selected bounded context. ADG treats generated
mirrors as context hazards and gives the agent a small packet of named files,
routes, backlog items, claims, and recent audit events. That is the right center of
gravity: small, high-signal context beats pasting the whole repo or tracker into a
prompt.

The current platform is already compelling as a governance scaffold:

- Node, SQLite, and JSONL keep the system local, boring, and inspectable.
- Deny-by-default guardrails make risky actions explicit.
- Append-only audit keeps current state derived from events, not hand-edited.
- Context packets keep token use bounded.
- Local gates make solo development more accountable.

The main gap is that ADG is not yet a full evaluated agent runtime. The next stage
should add task-level evals, runtime traces, capability-scoped enforcement,
sandboxed execution, context-quality measurement, signed audit chains, GitHub CI,
and a small CLI surface.

## Positioning

Use this positioning:

> Local governance and evaluation layer for agent-assisted software delivery.
> Works with any agent runtime. Keeps context bounded, tools scoped, audit durable,
> evals replayable, and delivery evidence reviewable.

Avoid positioning ADG as a replacement for agent SDKs, orchestration frameworks, or
model-provider tooling. The advantage is repo-local governance: policy, context,
traceability, eval evidence, and delivery controls that survive across agents.

## What To Keep

- SQL-first backlog and context selection.
- Generated but reviewable mirrors.
- Append-only JSONL audit as canonical event source.
- SQLite as generated/queryable local database.
- Deny-by-default guardrail policy.
- Local/offline governance gates.
- Portable skills that encode traceability and build-runner discipline.
- Minimal runtime dependencies.

## Roadmap Priorities

### 1. Task-Level Agent Evals

Current evals are useful policy smoke tests. They validate expected tool decisions,
confirmation requirements, and security outcomes. The next step is a real task eval
harness:

```text
task fixture -> isolated repo copy -> context packet -> agent/tool loop
-> artifacts/diff -> graders -> trace/audit record
```

Each fixture should include:

- Task prompt.
- Starting repo state.
- Allowed capabilities.
- Forbidden paths.
- Expected touched files.
- Expected commands.
- Token, cost, and tool-call budgets.
- Hidden prompt-injection material where relevant.
- Expected artifact or diff.
- Code-based grader.
- Optional model or human grader.
- Replayable transcript.

First fixture set:

- 5 coding edits.
- 5 docs or generated-artifact edits.
- 4 RBAC/security tasks.
- 3 migration tasks.
- 3 prompt-injection or malicious-document tasks.

The build should fail on eval regression. Store transcript, patch, tool calls,
context packet, grader output, and audit event id in SQLite.

### 2. Runtime Trace Schema

ADG needs durable run traces before the agent loop grows. Add SQLite tables for:

- `agent_runs`
- `agent_spans`
- `model_calls`
- `tool_calls`
- `guardrail_decisions`
- `context_packets`
- `artifacts`

Every eval and real run should be replayable enough to answer: what context was
selected, what tool was requested, why it was allowed or denied, what changed, and
which audit event records the outcome.

### 3. Guardrail Enforcement Boundary

Policy JSON only becomes governance when all risky actions pass through it. Add a
single execution wrapper:

```sh
adg exec --run RUN_ID --cap CAPABILITY_ID -- npm test
adg edit --run RUN_ID --cap CAPABILITY_ID -- path/to/file
adg read --run RUN_ID --cap CAPABILITY_ID -- path/to/file
```

The wrapper should enforce:

- Allowed paths.
- Command allowlist.
- Network mode.
- Environment scrubbing.
- Timeout.
- Working directory.
- Audit event creation.
- Trace span creation.

### 4. Capability-Scoped Authority

Replace broad tool classes with per-run capabilities. The backlog claim and context
packet already name scope; execution should consume the same scope.

Example:

```json
{
  "capabilityId": "cap_run_123",
  "runId": "run_123",
  "expiresAt": "2026-06-02T22:00:00Z",
  "read": ["src/routes/billing.ts", "tests/billing.test.ts"],
  "write": ["src/routes/billing.ts", "tests/billing.test.ts"],
  "commands": ["npm test -- tests/billing.test.ts", "npm run lint"],
  "network": "deny",
  "secrets": "deny"
}
```

The agent may plan broadly, but execution stays narrow.

### 5. Brain/Hands Sandbox Split

Separate planning from execution:

- Brain process: model calls, planning, trace writing.
- Hand sandbox: temporary repo copy, command execution, no secrets, no ambient
  credentials.
- Tool broker: validates capability, runs action, logs result.

Default sandbox policy:

- Network denied.
- Environment scrubbed.
- Filesystem restricted to a temporary repo copy.
- Secrets unavailable.
- Write paths capability-scoped.
- Timeouts mandatory.
- Exported artifacts hashed and allowlisted.

### 6. Context Quality Benchmarks

Token reduction is only half the context story. ADG should measure whether the
broker picked the right files.

Add context evals with:

- `oracle_files`
- `selected_files`
- `precision_at_k`
- `recall_at_k`
- `missed_critical_file`
- `forbidden_file_violation`
- `stale_anchor_violation`
- `bytes_per_relevant_file`

Run ablations:

- SQL anchors only.
- SQL anchors plus route files.
- SQL anchors plus symbol search.
- SQL anchors plus recent git diff.
- SQL anchors plus optional embeddings.

Keep the default SQL-only path small until data proves a heavier retrieval layer is
worth it.

### 7. Workflow-First Multi-Agent Rules

Do not make multi-agent writes the default. The safe pattern is:

- Single writer.
- Many read-only scouts.
- Parent agent integrates.
- Subagents return short evidence summaries.
- Subagents do not write files.
- Subagents do not access secrets.
- Subagents do not run production commands.

Use parallel agents for breadth-first exploration, review, and triage. Keep final
integration and SQL/audit mutation in the parent agent.

### 8. Signed Audit Chain

Append-only audit is the right base. Add tamper evidence:

```json
{
  "id": "audit_123",
  "previousHash": "sha256:...",
  "eventHash": "sha256:...",
  "signature": "minisign:...",
  "keyId": "dev-key-2026-06",
  "occurredAt": "..."
}
```

Validation should check:

- Hash chain.
- Monotonic order.
- Schema.
- Secret redaction.
- Evidence paths.
- Signature policy.

Unsigned local mode can remain acceptable, but tamper evidence should exist.

### 9. Tool Contracts And Injection Hardening

Add JSON Schema for every tool input and output. Validate before execution and after
result capture.

Make this policy explicit:

- Tool output is data, not instruction.
- Tool output cannot grant capabilities.
- Tool output cannot override `AGENTS.md`.
- Tool output cannot request secrets.
- Tool output cannot widen scope.
- Instruction-like tool output is quoted or summarized, not obeyed.

Expand injection fixtures across README files, issues, test fixtures, package
scripts, SQL rows, generated docs, and external tool outputs.

### 10. Script Portability Hardening

Keep the "no Node SQLite dependency" approach, but remove unnecessary shell surface
where scripts call `sqlite3`. Prefer `execFileSync` or `spawnSync` with `shell:
false`.

Example:

```js
execFileSync("sqlite3", ["-json", absDbPath, normalizedQuery], {
  cwd: root,
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});
```

### 11. GitHub-Native Delivery

Add GitHub-native delivery evidence:

- `.github/workflows/governance.yml`
- PR summary comment with eval results.
- Artifact upload for traces, eval JSON, and context packets.
- Status badge.
- Required-check documentation.

### 12. CLI Bootstrap

Make adoption easier without turning ADG into a large framework:

```sh
adg init
adg doctor
adg context feature S07 --workflow route
adg eval run --fixture AE-001
```

The current manual install path should remain documented until a package or binary
distribution exists.

## Suggested PR Sequence

1. Task-level eval fixture format plus 5 runnable evals.
2. Trace SQLite schema plus span logger and JSON export.
3. Capability-scoped read/edit/exec wrapper.
4. Sandbox runner with network deny and environment scrub.
5. Context retrieval quality benchmarks.
6. Signed audit hash chain.
7. GitHub Action and PR summary artifacts.
8. ADG CLI bootstrap.

## Success Criteria

ADG graduates from governance scaffold to credible agentic SDLC control plane when:

- Task-level evals run in isolated repo copies.
- Every agent run has replayable traces.
- Every risky action is capability-scoped.
- Generated code runs away from secrets and ambient credentials.
- Context packets are scored for quality, not only size.
- Audit history is tamper-evident.
- GitHub PRs carry machine-readable governance evidence.
- Manual setup is clear, and CLI bootstrap is available when distribution is ready.

## Non-Goals

- Do not become a general-purpose agent framework.
- Do not default to vector search without measured retrieval gains.
- Do not make multi-agent writes the default workflow.
- Do not require SaaS to use the local governance layer.
- Do not weaken append-only audit or deny-by-default policy for convenience.

## Current Publishing Note

ADG is not currently published on npm. For now, copy or clone the repository into
your development folder, run `npm run setup` for an empty database, or run
`npm run ci:governance` for the bundled ADG worked-example checks.

For bugs or setup questions, contact
[zach+github@otterblock.com](mailto:zach+github@otterblock.com).
