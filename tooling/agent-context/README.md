# Agent Context Tooling

Local tooling for SQL-first context selection. The principle is simple:

> **SQLite chooses the context.** The agent should read only the files listed in
> the packet's `nextFiles` unless local evidence points elsewhere.

## Commands

```sh
npm run setup:demo
npm run context:feature -- --feature S07 --workflow route
npm run context:item -- --item S07-TASK-01 --workflow route --format toon
npm run context:audit
npm run agent:next -- --workflow route --max-items 1
npm run agent:loop -- --feature S07 --workflow route --max-items 3
```

## What the broker forbids

The broker refuses to name the large generated mirrors in a packet (configured in
`config/agentic/context-profiles.yaml`):

- `data/backlog-source.sql`
- `data/backlog.json`
- `data/audit/audit-log.jsonl`
- `docs/generated/**`

These are the files most likely to blow up a context window. The broker returns
the same information in bounded form by querying SQLite directly. See
[`docs/token-reduction.md`](../../docs/token-reduction.md).

## Formats

- `markdown` — default, for human review.
- `json` — for tests and exact machine assertions.
- `toon` — compact, LLM-facing table packet. A transport format only; it never
  replaces JSON, SQL, SQLite, or Markdown as a canonical artifact.

## Manifests

Every packet writes a manifest to `manifests/last-context-packet.json` and appends
to `manifests/history.jsonl`. `context:audit` checks the last manifest for
forbidden-file violations and file-count-cap violations. Manifests are local
working state and are gitignored.
