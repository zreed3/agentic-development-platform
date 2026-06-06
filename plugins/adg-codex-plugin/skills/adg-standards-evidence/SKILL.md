---
name: adg-standards-evidence
description: Maintain standards-linked governance evidence. Use when controls, evidence, maturity scores, security practices, AI governance, privacy, or deliverable auditability changes.
---

# ADG Standards Evidence

Use this to keep standards alignment machine-checkable.

## Workflow

1. Read `config/agentic/standards-map.json`.
2. Run `node <adg-codex-plugin>/scripts/adg-standards.mjs validate`.
3. Link local controls to evidence and maturity domains.
4. Reference standard identifiers and official URLs only.
5. Do not copy paid standard control text into the repo.

Run bundled commands from the host repo as the working directory so evidence paths resolve against the governed project.

## Evidence

Use command outputs, local policy files, tests, evals, and audit or deliverable records.
