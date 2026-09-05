---
title: Context Selection and Measurement
status: active
classification: internal
category: agentic-delivery
---

# Context selection and measurement

The default recommendation is targeted repository search, concise Markdown context,
and the vendor runtime's context management. The SQL context broker is an optional
advanced facility for repositories that already maintain structured requirements
and need queryable slices. Existing adopted policy still applies until explicitly
migrated; this recommendation does not waive a repository's controls.

## What the broker actually does

`scripts/agent-context.mjs` queries feature and backlog data and chooses file
pointers from configured feature anchors followed by route paths. It removes
configured forbidden paths and truncates the list to the workflow's `maxFiles`.
Profiles also cap selected row collections. A packet can include required checks
and recent evidence. JSON supports machine consumers; Markdown and TOON are
alternative renderings.

These are row and file-count limits, not token limits. A referenced file can be
large, an anchor can be stale, and the ordering can omit a relevant file. The model
must still follow source evidence beyond the initial pointers when necessary.
The manifest validates pointer membership and count; it does not prove adequate
context or successful task completion.

Generated mirrors remain unsuitable for routine bulk loading in the advanced
profile. That does not imply ordinary source files or maintained Markdown notes
should be hidden from capable agents.

## What previous measurements establish

Earlier measurements compared serialized packets with generated SQL dumps and
SQLite database sizes. They demonstrate representation-size differences for the
seeded example. A database's storage bytes are not model tokens, and a competent
Git-and-Markdown workflow does not paste the database into a prompt.

The historical byte-divided-by-four figures are estimates, not provider token
usage. They do not measure accepted correctness, avoided rework, end-to-end cost,
or time. Similarly, stable output prefixes may help caching, but cache eligibility
and actual cache hits depend on the runtime and provider; prefix stability alone
is not a measured saving.

No controlled comparison currently establishes that the broker helps Astra or
Fable 5.1 more than targeted search and concise Markdown. Historical snapshots in
`docs/agent-guides/` remain provenance, not current performance claims.

## Reproduce representation sizes

In an isolated checkout with a seeded example database:

```sh
npm run setup:demo
for fmt in markdown json toon; do
  node scripts/agent-context.mjs feature --feature S07 --workflow route --format "$fmt" --no-manifest | wc -c
done
```

This reports output bytes only. Do not run demo setup over a host repository's
working backlog. Compare actual provider input, output, and cached-token usage
separately, including orchestration and evaluator calls.

## Decide whether to keep it

Use the [Astra/Fable modernisation experiment](astra-fable-modernisation.md): matched
tasks, blind outcome grading, recorded interventions, and measured runtime usage.
A context-broker ablation must preserve the same requirements and tests in concise
Markdown, rather than comparing a structured packet with a deliberately excessive
dump. Retain the broker only where results or an explicit query/reporting
requirement justify its maintenance cost.
