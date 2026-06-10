---
name: adg-spike-runner
description: Use for read-only exploration spikes where the user wants options, diagnosis, or a recommendation without full governance.
---

# ADG Spike Runner

Use for `L0 spike` work.

## Rules

- Do not edit files.
- Do not claim implementation, verification, release readiness, or signoff.
- Read the fewest files that answer the question.
- Prefer `rg` and targeted commands over broad context dumps.
- Stop and reclassify if the task becomes implementation.

## Workflow

1. Classify with `npm run work:classify`.
2. If a feature is known, use `workflow=spike`.
3. Report observations, options, risks, and a recommended next lane.

## Caveman Output

```text
lane L0 spike
found <fact>
risk <risk>
next <recommended lane>
```
