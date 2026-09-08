# Multi-agent orchestration: v2.3.0 direction

Status: planned for the next minor version. This document defines the direction;
the capabilities below are not shipped in v2.2.1.

ADG will extend its existing task, context, and audit controls to make it easier
for developers and their agents to collaborate across separate machines and
accounts. Git remains the record of code changes and the integration workflow.

## Planned work

- Shared task ownership with an explicit claim and handoff process, including
  recovery when an agent stops before completing its task.
- Structured handoffs containing the task, acceptance criteria, repository,
  branch, commit, decisions, checks, unresolved questions, and next owner.
- Separate agent roles and context. Both agents receive the same requirements
  and contracts; each can investigate independently before comparing conclusions.
- Independent review before the reviewer reads the implementation rationale,
  followed by evidence-based resolution of disagreements.
- Authenticated coordination across machines, with explicit permission to post
  updates or dispatch work and a record of who requested each action.
- Bounded execution with duplicate-event handling, retry limits, and human
  escalation when ownership or a material decision is unresolved.

The shared-state backend and dispatch mechanism remain design decisions. A local
SQLite copy on each machine is not sufficient for shared ownership. Evaluation
will compare the added coordination against a GitHub issues and pull request
workflow, including integration failures, duplicate work, review findings, and
manual intervention.
