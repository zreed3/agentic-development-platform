---
name: adg-runtime-readiness
description: Design governed autonomous runtime readiness for ADG. Use when defining capability-scoped execution, sandbox policy, runtime traces, model/tool call records, adapters, or compatibility with future native agent sandboxing.
---

# ADG Runtime Readiness

Use this when moving from governed planning to governed autonomous execution.

## Define

- run id, capability id, expiry, actor, and feature slice;
- allowed read paths, write paths, commands, network mode, and environment policy;
- model calls, tool calls, guardrail decisions, context packets, artifacts, and audit links;
- sandbox and adapter boundaries.

## Rules

- Keep ADG as a policy, context, evidence, and trace layer, not a heavyweight agent framework.
- Runtime wrappers should be optional adapters over the same source model.
- Do not assume native agent capability gaps will be permanent; keep interfaces small and replaceable.
