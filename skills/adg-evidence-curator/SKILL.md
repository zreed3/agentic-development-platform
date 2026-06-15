---
name: adg-evidence-curator
description: Select, record, and validate ADG evidence. Use when choosing targeted checks, recording failed commands, linking tests to requirements, writing audit events, registering advisory gaps, or preparing feature/release evidence.
---

# ADG Evidence Curator

Use this to keep proof truthful and compact.

## Decide

- what exact claim the evidence proves;
- the narrowest command or artifact that proves it;
- whether unit, integration, browser, database, security, traceability, or full governance evidence is required;
- whether a failed result needs backlog, audit, or gap registration.

## Rules

- Record failed commands instead of hiding them behind a passing summary.
- For a deliverable that renders to a user, a rendered artifact (screenshot or montage) plus `npm run asset:lint` on any image assets is the evidence; metric-only evidence is a lower tier and needs a `live` event under `release-class:visual`.
- Do not use a narrow check to prove a broad claim.
- Evidence should name commands, paths, artifacts, or audit ids.
- Advisory gaps are allowed, but must remain queryable.
