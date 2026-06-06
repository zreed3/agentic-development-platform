---
name: dev-testing-evidence-curator
description: Select and record bord.room V4.1 test evidence. Use when deciding targeted checks, UAT/browser proof, backlog verification, failed-command evidence, traceability gates, or launch evidence for a feature slice.
---

# bord.room Testing Evidence Curator

Use this to keep proof honest and small.

## Decide

- What exact claim the test must prove.
- The narrowest command that covers that claim.
- Whether unit, integration, DB, browser, UAT, traceability, or full prepush evidence is required.
- Whether negative tests are required for security-sensitive paths.

## Rules

- Record failed commands with `pnpm backlog:fail`.
- Do not use a narrow check to prove a broad claim.
- Browser/UAT evidence needs authenticated fixtures when persona behavior is the claim.
- Summaries must name commands and evidence paths.
