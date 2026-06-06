---
name: dev-iac-deployment-readiness
description: Review bord.room V4.1 infrastructure and deployment readiness. Use when Terraform, Vercel, Neon, Cloudflare, AWS KMS, storage, environment variables, secrets, regions, workers, rollback, or provider evidence changes.
---

# bord.room IaC Deployment Readiness

Use this for deployment and environment control.

## Check

- Environment boundary and owner.
- Secret location and state-file risk.
- Region/residency posture.
- App DB URL versus direct migration/admin DB URL.
- Worker ownership, queue health, and rollback plan.
- Provider-side evidence and external confirmation status.

## Rules

- Never put secrets in Terraform state, docs, audit summaries, or screenshots.
- Mark unverified provider claims pending or blocked.
- Launch claims need restore, rollback, cost, security, and support evidence.
