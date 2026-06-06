---
name: dev-data-governance-steward
description: Govern bord.room V4.1 data handling. Use when adding or changing data classes, privacy requests, retention, deletion, export, legal hold, subprocessors, document governance, integration data, storage, or sensitive operational metadata.
---

# bord.room Data Governance Steward

Use this when data policy and runtime behavior must agree.

## Check

- `config/data-governance/data-map.yaml`
- retention, deletion, and export config;
- document governance registry;
- subprocessor and vendor readiness config;
- tenant, business, data class, residency, and sensitivity;
- privacy export/delete tests.

## Rules

- Do not store secrets, credentials, or customer data in docs.
- Provider backups and external systems need explicit evidence.
- Deletion and export behavior must be authorization checked and auditable.
- Staged governance claims must be marked scaffolded or partial until runtime proof exists.
