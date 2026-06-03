---
title: Reducing Token Usage
status: active
classification: internal
category: agentic-delivery
---

# Reducing Token Usage

The most expensive mistake in agent-assisted development is **bulk-loading context**:
pasting whole generated trackers, SQL dumps, or HTML dashboards into a prompt
"so the agent has everything." Those artifacts are exactly the ones that explode a
context window. This platform is built to make the *right* context cheap, bounded,
and deterministic instead.

```text
task -> classify -> SQL lookup -> capped context packet -> anchored files -> targeted checks
```

## The core inversion: SQLite chooses the context

The richest artifacts (the full SQL dump, the JSON mirror, generated HTML) are put
on a **denylist** and the database is made the *selector*. Instead of handing an
agent everything, the broker queries SQLite and returns a small packet: the feature,
its items, its routes, the few recent audit events, and the specific files to read
next — plus an explicit "do not bulk read" list.

See [`scripts/agent-context.mjs`](../scripts/agent-context.mjs) and
[`config/agentic/context-profiles.yaml`](../config/agentic/context-profiles.yaml).

## Four mechanisms

1. **Forbidden bulk files.** Each profile inherits a `forbiddenBulkFiles` list. The
   broker will never name these in a packet, and `npm run context:audit` fails if a
   packet manifest references one. They are the generated mirrors of data the broker
   already returns in bounded form.

2. **Per-workflow caps.** A profile caps audit rows, backlog events, routes, and —
   most importantly — `maxFiles`. The agent is told to read only the files the packet
   names. A `route` packet is not allowed to balloon into the whole repo.

3. **Query selection.** A profile lists which queries run (`routes_by_feature`,
   `persona_workflows_by_feature`, `recent_audit`, ...). A docs task does not pull
   route files; an RBAC task pulls persona workflows and negative-test anchors first.

4. **TOON transport.** For uniform arrays (routes, items, audit rows) the broker can
   emit [TOON](https://github.com/toon-format/toon): a compact, header-plus-rows table
   format. JSON/SQL/SQLite stay canonical; TOON is a *transport* used only for the
   LLM-facing packet, and only after measuring that it is actually smaller.

## Fast delivery mode

Use the `delivery-slice` workflow when the repo is in complete-dev mode and speed
matters:

```sh
npm run context:feature -- --feature S07 --workflow delivery-slice
```

The packet carries the operating sequence directly:

1. Plan the feature slice and the exact backlog items in scope.
2. Design the RBAC/scope/state behavior and the test seams.
3. Build only the scoped files plus directly related tests.
4. Test with targeted commands, record failed runs once with `npm run backlog:fail`,
   and defer `npm run ci:governance` until feature/release checkpoints.

This keeps the quality-improving checks while removing repeated full-gate runs and
micro-event narration.

## Measured locally (this repo, demo backlog)

Generated with the seeded demo backlog (7 features, 57 items, 8 audit events):

| Artifact | Size | Note |
|---|---:|---|
| `context:feature S07 route` (toon) | **~2.0 KB** | LLM-facing packet |
| `context:feature S07 route` (markdown) | ~2.8 KB | human-facing packet |
| `context:feature S07 route` (json) | ~7.5 KB | machine assertions |
| `data/backlog-source.sql` (the SQL mirror) | ~26 KB | **forbidden bulk file** |
| `data/backlog.sqlite` (the database) | ~164 KB | queried, never pasted |

The packet is roughly **an order of magnitude smaller than the SQL dump and ~80×
smaller than the database** — on a *tiny* demo backlog. The gap widens sharply with
scale.

### At real-project scale

In the product repository this layer was extracted from, the generated tracker JSON,
SQL dump, and HTML mirrors were **multiple megabytes each**. The recorded context
budget there:

- Normal instruction overhead (`AGENTS.md` + a skill + the pipeline note): **~4–7k tokens**.
- Bulk-loading the generated planning/tracker artifacts: **hundreds of thousands to
  millions of tokens**.

A few-KB packet versus multi-MB mirrors is the difference between a request that fits
comfortably and one that cannot run at all.

## Reproduce a measurement

A rough rule of thumb: **tokens ≈ bytes ÷ 4** for English/JSON text.

```sh
npm run setup

# packet size in each format
for fmt in markdown json toon; do
  printf "%-9s " "$fmt"
  node scripts/agent-context.mjs feature --feature S07 --workflow route --format "$fmt" --no-manifest | wc -c
done

# the bulk file you are NOT loading
wc -c data/backlog-source.sql data/backlog.sqlite
```

## Non-goals

- No production RAG / vector database for the dev pipeline. SQL selection is enough
  and is deterministic, diffable, and offline.
- TOON never becomes a canonical stored artifact; it is render-only.
- The broker never mutates the audit log or backlog; reducing tokens must not cost
  traceability.
