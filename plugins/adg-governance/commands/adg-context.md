---
description: Get a bounded ADG context packet for a feature instead of reading files blind.
argument-hint: [feature id, e.g. S07]
---

Fetch a bounded ADG context packet rather than opening files blind or pasting the tracker.

Run the context broker:

`npm run context:feature -- --feature $ARGUMENTS`

Then anchor your work only to the files, routes, and backlog items the packet names. Do **not** read the forbidden bulk files — the generated SQL/JSON/HTML mirrors and `*.sqlite` databases — the broker already returns their content in bounded form, and the governance hook will block those raw reads. If you need a different slice, pass `--workflow <route|delivery-slice|spike|agentic-tooling>`.
