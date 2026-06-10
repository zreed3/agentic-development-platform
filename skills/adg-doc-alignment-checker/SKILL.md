---
name: adg-doc-alignment-checker
description: Use when a PDF, runbook, or signoff document must be checked against the repo's actual commands, schema, scripts, and gates.
---

# ADG Doc Alignment Checker

Use when a document describes the intended pipeline and you need to verify it
against the repo.

## Workflow

1. Extract the document's commands, table names, file paths, and signoff claims.
2. Compare them with:
   - `package.json` scripts;
   - `data/schema.sql`;
   - `config/agentic/*.json`;
   - `scripts/`;
   - targeted validation output.
3. Label each item:
   - `aligned`;
   - `alias needed`;
   - `schema mismatch`;
   - `host-specific`;
   - `future goal`.
4. Recommend the smallest repo or document change that makes the claim true.

Do not treat a clear diagram as executable proof. Commands and queries must run.
