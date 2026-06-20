---
name: adg-backlog-swarm
description: Orchestrate a context-bound, backlog-logged multi-agent swarm to cut token use. Use to run a feature as a planner (Opus or Sonnet) that logs small backlog items, then cheaper workers (Sonnet or Haiku) that each implement one item under its bounded context packet, while the parent keeps integration, the SQL backlog, the audit log, and verification.
---

# ADG Backlog Swarm (orchestrator)

Run feature work as a context-bound swarm so total tokens stay low: the planner holds the
wide context once, and each worker holds only one item (about 1.3k tokens) instead of a
single agent accumulating the whole feature (about 5k and growing as it works every task).

These skills are a playbook over existing ADG commands; the actual sub-agent spawning is
the host's (the Task/Agent tool or a workflow). ADG supplies the logged backlog, the
per-item bounded packet, the write scope, and the lifecycle that make the swarm cheap and
traceable.

## Roles and model tiers

- Planner (Opus or Sonnet): decompose the feature into logged items. Use
  `adg-backlog-decompose`.
- Workers (Sonnet for normal items, Haiku for mechanical items): one item each. Use
  `adg-item-worker`. Give an L3 sensitive item a stronger model.
- Parent (you): keep the SQL backlog, the audit log, dedup, and final integration.

## Loop

1. Plan: run the planner so items exist and are queryable in `data/backlog.sqlite`.
2. Worklist: `npm run agent:loop -- --feature <ID> --max-items <N>` to get items plus
   their per-item context commands and constraints.
3. Fan out: spawn one worker per item, passing ONLY the item id (the worker loads its own
   packet). Set `ADG_WRITE_SCOPE` in the worker's environment to the item's write scope
   (a comma-separated list of path prefixes or globs); the deterministic hook then BLOCKS
   any write the worker makes outside that scope, so context-bound is enforced, not just
   asked for. Run workers concurrently only when their write scopes are disjoint.
4. Integrate: apply or confirm each worker's change in the parent, resolve any overlap, and
   keep the backlog and audit log in the parent, not in the workers.
5. Verify: run the relevant gate, then sign off with `adg-signoff-reviewer`. A visual
   deliverable needs `release-class:visual` plus a live rendered-artifact event.

## Token discipline (why this is cheaper)

- One worker packet (item, TOON) is about 1.3k tokens; the whole-feature packet is about
  5k. Workers do not accumulate each other's context, so N small items cost far less than
  one agent doing all N.
- Workers read only their item packet; they never bulk-load the generated mirrors or other
  features (the forbidden-bulk control still applies).

## Rules (from the rulebook)

- Keep the SQL backlog, the audit log, and final integration in the parent.
- Prefer workers for read-heavy or disjoint-write work; avoid parallel write-heavy work on
  overlapping scopes.
- Never let a worker verify its own item or weaken deny-by-default or the append-only log.
