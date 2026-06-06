---
name: adg-bounded-delivery
description: Guide an agent through bounded feature-slice delivery. Use before implementation work that needs reduced rework, scoped context, stop conditions, evidence, and targeted checks.
---

# ADG Bounded Delivery

Use this before code edits.

## Workflow

1. Generate a slice with the bundled plugin command: `node <adg-codex-plugin>/scripts/adg-context.mjs slice --feature <id> --workflow <workflow>`.
2. Stop if the slice reports missing scope, hard elicitation gaps, or forbidden bulk files.
3. Read only the named files unless local evidence proves another file is required.
4. Run the narrowest checks that prove the slice.
5. Record deliverable evidence when the work is material.

Run bundled commands from the host repo as the working directory so ADG reads the host repo's `config/`, `data/`, and `tooling/` files.

## Evidence

- feature ID;
- graph slice;
- files touched;
- tests run;
- decisions and failures;
- audit or deliverable record.
