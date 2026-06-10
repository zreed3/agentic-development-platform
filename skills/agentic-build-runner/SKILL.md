---
name: agentic-build-runner
description: Execute backlog items from the SQL-first backlog through claim, implementation, tests, traceability updates, and commit-readiness, in any repo using the Agentic Development Platform. Use when asked to build, pick up, run, complete, verify, or orchestrate work from data/backlog.sqlite, especially with multi-agent backlog execution.
---

# Agentic Build Runner

Use this skill to turn backlog requirements into code, tests, and traceability
evidence.

## Required Companion Skill

Load `$agentic-traceability` first. Its audit and append-only rules are mandatory.

## Fast Slice Loop

Use a feature slice as the default unit in complete-dev mode:

1. Plan: choose one bounded feature slice and the exact items/routes/contracts in scope.
2. Design: decide behavior, RBAC/scope/state expectations, and test seams before editing.
3. Build: edit the scoped code and directly related tests only.
4. Test: run targeted checks first; reserve `npm run ci:governance` for feature completion, governance/tooling changes, or pre-push.

Prefer one consolidated verification/audit event when one command set covers several
tasks, test cases, use cases, or success criteria. If a targeted check fails, record
it once with:

```sh
npm run backlog:fail -- --item S07-TASK-01 --summary "Targeted check failed" --evidence "npm run test:agent-context"
```

## Build Loop

1. Read `AGENTS.md`.
2. Snapshot workspace state:
   ```sh
   git status --short --branch
   ```
3. Generate a bounded context packet, then select and inspect one item:
   ```sh
   npm run agent:next -- --workflow route --max-items 5
   npm run backlog:show -- --item S07-TASK-01
   ```
4. Confirm the item is tractable:
   - feature dependencies and release band are understood;
   - persona/RBAC workflow expectations are relevant to the implementation;
   - routes, permissions, scope, and evidence paths are clear;
   - tests and success criteria describe observable behavior.
5. Claim the item before editing (claim a narrow write scope):
   ```sh
   npm run backlog:claim -- --item S07-TASK-01 --actor agent --scope scripts/agent-context.mjs
   npm run backlog:start -- --item S07-TASK-01 --summary "Started context broker work"
   ```
6. Implement using normal repo conventions. Keep the write scope as narrow as possible.
7. Run targeted checks first, then broader gates based on risk.
8. Complete or block the item:
   ```sh
   npm run backlog:complete -- --item S07-TASK-01 --summary "Implemented profile merge" --evidence scripts/agent-context.mjs
   npm run backlog:verify -- --item S07-TASK-01 --summary "Verified" --evidence "npm run test:agent-context"
   ```
9. At a feature/release checkpoint, or after process/tooling changes, run the governance gate:
   ```sh
   npm run ci:governance
   ```
10. Record a feature-level audit event with `$agentic-traceability` before your final response.

## Multi-Agent Orchestration

Use subagents only when the user explicitly asks for multi-agent, delegated, or
parallel agent work.

When authorized:
- keep the parent agent responsible for selecting and claiming the backlog item;
- delegate bounded side work only — code mapping, isolated implementation slices,
  test review, or security/RBAC review;
- give workers disjoint write scopes (use `--scope` on the claim);
- tell workers they are not alone in the codebase and must not revert others' changes;
- keep the SQL backlog, audit log, and final integration in the parent agent.

Do not let multiple workers independently mutate `data/backlog.sqlite`,
`data/backlog-source.sql`, or `data/audit/audit-log.jsonl`.

## Done Criteria

An item is commit-ready only when:
- implementation matches the item title, tests, success criteria, and persona workflow;
- relevant negative tests cover scope/role/permission cases where applicable;
- `npm run backlog:verify` has evidence;
- targeted checks from the context packet pass;
- `npm run ci:governance` passes at the next feature/release checkpoint;
- a documented audit `decision` explains any gate that was waived.
