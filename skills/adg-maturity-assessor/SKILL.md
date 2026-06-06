---
name: adg-maturity-assessor
description: Assess ADG maturity as code. Use when defining 1.0-5.0 scoring, evaluating required domains, validating evidence, producing maturity scorecards, or raising remediation gaps for domains below target.
---

# ADG Maturity Assessor

Use this to keep maturity claims measurable.

## Workflow

1. Read `config/agentic/maturity.json`.
2. Check every required domain and subdomain has evidence.
3. Score against the 1.0 to 5.0 maturity scale.
4. Record gaps for anything below 5.0; fail validation only when required score is below target or config shape is invalid.
5. Run `npm run maturity:validate` and, when useful, `npm run maturity:score -- --format toon`.

## Rules

- A 4.5 claim requires queryable source, agent-consumable output, governance gate inclusion, and structured gaps.
- A 5.0 claim requires task evals, runtime traces, and enforcement.
- Do not turn maturity into prose-only reporting.
