---
description: Run a stronger-tier completeness pass over a UI or asset deliverable before sign-off, and ratchet any new failure mode into the control library.
argument-hint: [deliverable type, e.g. web-image-asset] [path or feature id]
---

Run a completeness-critic pass before a deliverable that renders to a user is signed off.
The goal is to catch the off-checklist failure that proxy metrics miss (the kind that ships
a clipped logo): not "did the listed checks pass" but "what is this checklist missing".

Do this:

1. Resolve the deliverable's type and its inherited check set from
   `config/agentic/artifact-types.json` (for `web-image-asset`: dimensions, format, blank
   guard, edge-clip, contrast, positive-on-light).

2. Run the deterministic enforcing checks for the type. For `web-image-asset` that is
   `npm run asset:lint -- "$ARGUMENTS"` (or `--staged` before a commit). Every checked
   asset must pass; the edge-clip and blank guards are the encodable floor.

3. Run the stronger-tier critic question against the deliverable and its requirement intent:
   what acceptance check does the stated intent need that no control yet encodes? Look at a
   rendered artifact (screenshot or montage), not only the metrics. For each requirement,
   confirm an acceptance criterion covers its intent (an uncovered requirement is flagged by
   `npm run elicitation:validate` as an advisory gap).

4. The ratchet: if the pass finds a new, encodable failure mode, add it as a new check to the
   type's check set in `config/agentic/artifact-types.json` (and, when it is pixel-encodable,
   to the asset-lint checks) so it is never missed again. Completeness becomes a property of
   the versioned control library, not your memory.

5. Record the completeness pass as evidence:
   `npm run audit:record -- --feature <ID> --type comment --status in-progress --summary "completeness-pass: <type> <path> reviewed, checks: <list>, new checks added: <list or none>" --tier test`.

A deliverable that renders to a user must not reach `verified` on metric or test evidence
alone. Features that carry a visual surface should carry the `release-class:visual` label, so
the release gate (`npm run backlog:validate`) stays red until a `--tier live` event records a
rendered-artifact observation. A green that is metrics-only on a visual deliverable is, by
definition, a lower tier.
