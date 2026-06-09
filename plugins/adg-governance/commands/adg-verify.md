---
description: Record verification of a backlog item with an evidence tier, not a bare claim.
argument-hint: [item id] [evidence command-or-path]
---

Record verification of a backlog item with explicit, tier-appropriate evidence.

Before claiming verified, check the evidence tier matches the claim:

- `asserted` — a claim with no artifact (never enough to sign off).
- `config` — the controlling configuration exists (Terraform / env / flag). **Not sufficient** for deploy, infra, performance, runtime-security, or data-residency claims.
- `test` — an automated check passed.
- `live` — observed true in the running or deployed system (a probe, response header, measured metric, or restore drill). **Required** to sign off a sensitive class.

Record it:

`npm run backlog:verify -- --item <ITEM> --summary "<what was proven>" --evidence "$ARGUMENTS"`

Then append the matching audit event with `npm run audit:record`. Do not record `verified` for a deploy/infra/runtime claim on `config` evidence alone — that is the exact false-confidence failure the v0.9.1 field report documents.
