# AGENTS.md - ADG Lite Variant

## Purpose

Use this rulebook when token budget and delivery speed matter. The agent must
produce safe code with bounded context, not comprehensive process narration.

## Default Loop

Use one feature slice as the unit of work:

1. Plan: identify the feature, exact slice, affected contracts, and files.
2. Design: decide permission/scope/state behavior and test seams before editing.
3. Build: edit only scoped implementation files and directly related tests.
4. Test: run targeted checks first; record failures once; run full gates only at
   checkpoints.

## Context Rules

- Start with a `delivery-slice` context packet.
- Read only files named in the packet unless local evidence points elsewhere.
- Do not bulk-read generated tracker JSON, SQL dumps, audit logs, generated HTML,
  or broad release documents.
- Prefer SQL queries and packet rows over generated mirrors.
- Prefer `rg` for targeted searches.

## Traceability Rules

- Record one consolidated verification event per completed slice.
- Record failed test runs with `backlog:fail`; do not hide failures inside a
  passing summary.
- Use full audit/gate narration only when the slice changes policy, release scope,
  security posture, or generated artifacts.

## Gate Rules

During build:

- Run targeted tests for touched code.
- Run package-level typecheck/lint only when the touched package warrants it.
- Run migration/RLS/security checks only for DB/auth/security/billing changes.

At checkpoints:

- Run the full governance gate at feature completion, release checkpoint,
  process/tooling change, or before push.
- If a full gate is skipped at a checkpoint, record a decision with reason, risk,
  and rollback.

## Output Rules

Keep final updates short:

- Changed files.
- Tests/checks run.
- Failures or waived gates.
- Next slice.

Do not include raw logs unless requested.

