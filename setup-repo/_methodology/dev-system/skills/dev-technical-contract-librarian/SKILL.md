---
name: dev-technical-contract-librarian
description: Maintain bord.room V4.1 technical contracts. Use when APIs, server actions, webhooks, events, integrations, OpenAPI, Zod schemas, payload validation, provider lifecycle status, or typed client behavior changes.
---

# bord.room Technical Contract Librarian

Use this when a boundary sends or receives structured data.

## Contract Checklist

- Request and response schema.
- Auth realm, permission, entitlement, tenant scope, and business scope.
- Error shape and safe copy.
- Idempotency, retry, ordering, and audit behavior where relevant.
- Provider lifecycle state: live, partial, stub, archived, planned, or internal-only.
- Contract tests for happy path and failure states.

## Rules

- Validate external data with Zod or existing validators.
- Do not claim public API readiness unless docs, schemas, auth, and tests agree.
- Hidden or future routes stay out of public OpenAPI output.
