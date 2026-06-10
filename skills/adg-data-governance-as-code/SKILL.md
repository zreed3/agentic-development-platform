---
name: adg-data-governance-as-code
description: Define and verify data governance as code. Use when data classes, retention, deletion, export, residency, subprocessors, sensitive metadata, privacy behavior, or data-handling evidence changes.
---

# ADG Data Governance As Code

Use this when data policy and runtime behavior must agree.

## Capture

- data class, owner, system of record, sensitivity, and residency;
- retention, deletion, export, legal hold, and backup expectations;
- subprocessors and integration data boundaries;
- authorization and audit behavior for privacy operations;
- tests or evidence proving the behavior.

## Rules

- Never store secrets, credentials, customer data, or private operational data in governance artifacts.
- Mark staged claims as partial until runtime proof exists.
- Missing privacy/export/delete evidence becomes a structured gap.
