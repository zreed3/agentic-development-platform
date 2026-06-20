---
name: adg-backlog-decompose
description: Decompose a feature or intent into small, context-bound backlog items in the SQL backlog, for a planning model (Opus or Sonnet). Use before a swarm of workers: turn one feature into tightly scoped, logged items, each with a write scope and a context profile, so cheaper sub-agents can each work one item in isolation and total token use drops.
---

# ADG Backlog Decompose (planner)

You are the planner. You hold the feature view ONCE and turn it into many small, logged,
context-bound items so cheaper workers can each take one without loading the whole feature.

## Loop

1. Read the feature view once (this is your only wide context):
   `npm run context:feature -- --feature <ID> --workflow agentic-tooling --format toon`,
   and the lineage if the feature is elicited:
   `npm run elicitation:graph -- --feature <ID> --format toon`.
2. Split the feature into items that are each one coherent change, with a tight title, a
   named write scope (the files it may touch), and a context profile (`quick-ui`,
   `delivery-slice`, or `agentic-tooling`). Smaller is better: a worker should need only
   its own item packet (about 1.3k tokens) to act.
3. Write the items into the SQL backlog seed (do not invent a parallel Markdown list),
   rebuild, and confirm they are queryable: edit `data/seed/backlog.seed.json` (the host
   seed; the demo uses `data/seed/backlog.demo.seed.json`), then `npm run setup` (or
   `setup:demo`) and `npm run backlog:validate`.
4. Emit the worklist for the swarm:
   `npm run agent:loop -- --feature <ID> --max-items <N>` (each row carries the item's
   `context:item` command and the bounded-work constraints).

## Rules

- Keep item write scopes disjoint where possible, so workers can run in parallel without
  colliding.
- A sensitive item (auth, RBAC, schema, migration, guardrails, audit, billing, production)
  is an L3 item; flag it so the orchestrator gives it a stronger model and the right gate.
- Keep current state derived from events; never hand-edit item status.
- Run `npm run elicitation:validate` and resolve any "uncovered intent" advisory gap, so no
  requirement is decomposed into work without a covering acceptance criterion.
