---
title: ADG Field Report and Hardening Plan
status: draft
classification: internal
category: review
---

# ADG Field Report and Hardening Plan

## Provenance

A field report from intensive first-party use of ADG-governed development: one
extended working session on **bord.room v4.1** (a Next.js + Postgres multi-tenant
SaaS that adopted ADG's governance machinery), covering a production-latency
investigation, four governance-recorded changes, and a backlog/audit
reconciliation.

It complements [`roadmap-review-overview.md`](roadmap-review-overview.md): that
roadmap expands ADG's *capabilities* (task evals, runtime traces, sandboxing,
signed audit, CLI); this report addresses the *lived ergonomics and
evidence-rigor* of the core that already exists. Nothing here contradicts the
roadmap's "What To Keep" or "Non-Goals" — it slots underneath them.

## What the design got right (validated under load)

Not endorsements on paper — each of these changed an outcome in the session:

- **SQL-selected, queryable status prevented hand-wavy claims.** Classifying 118
  remaining backlog items into *code-doable now* vs *owner/infra/live-env-gated*
  was a SQL query over blocked-reasons, not a guess — and it turned a vague
  "complete all features" directive into an honest ~10%/90% split.
- **"Verify before claiming" caught a confident error.** A parallel read-only
  scout flagged an RLS "deny-all bug"; the norm of grounding claims in evidence
  is the only reason it was checked against the actual migrations and found to be
  a **false positive** before it reached the user.
- **Append-only audit surfaced a real loose end.** A prior session's
  `drift failed → status restored` event pair was visible in the log and got
  closed, instead of silently rotting.
- **The context inversion held.** Work stayed anchored to named files and bounded
  `sqlite3` queries, never a whole-tracker paste.

The center of gravity — SQL-first backlog, append-only audit, bounded context,
deny-by-default — is correct and worth protecting. The findings below are about
the edges, not the core.

## Findings

### F1 — Adopters drift from the platform's own rules, and nothing detects it

ADG's rule is explicit: *"SQLite is queried, never treated as canonical"* — the
`.sqlite` databases are gitignored and rebuilt from tracked text sources. The
adopting repo violated exactly this. bord.room **commits** the generated
databases (three `.sqlite` files at ~13 MB / ~19 MB / ~23 MB), **plus** the full
set of generated SQL/JSON mirrors and six generated planning docs, **plus** a
`drift:generated` gate that diffs the committed generated artifacts against a
fresh regeneration.

The cost of that drift, observed directly:

- **Recording one fact became a four-step dance:** append audit event →
  regenerate → commit → drift gate goes red on `data/backlog.*` (which lag one
  regeneration pass) → `git commit --amend` → drift green. Hit twice in one
  session for single low-risk events (a deferral decision; an evidence note).
- **Unreviewable diffs:** 13–23 MB binary `.sqlite` changes per governance
  commit; generated docs that re-churn on every commit because they embed the
  git SHA in tracked frontmatter.
- **The lanes get undermined:** ADG's lightweight Proofline lanes exist precisely
  so small work stays cheap, but the committed-artifact tax applies even to a
  trivial `decision` event.

The platform's design is right; the gap is that **nothing downstream enforces
it.** An adopter can silently re-introduce the exact anti-pattern ADG was built
to avoid, and there is no conformance check to catch the regression.

### F2 — "Verified" has no evidence tier, so config-existence masquerades as live-proof

The backlog lifecycle (`claim → … → verify`) records evidence as a free-form
command or path, with no distinction between *"the configuration that should make
this true exists"* and *"this was observed true in the running system."*

This produced a concrete false-confidence failure. A deployment task — pin the
serverless functions to the Sydney region, co-located with the Australian
database — was recorded **verified** on the strength of the Terraform config
declaring `syd1`. Production HAR captures later proved the functions were
actually executing in `iad1` (US East) while the database sat in Sydney: every
query crossing the Pacific, 4–6 second pages. The audit trail looked complete and
honest; the claim was simply **false at the only layer that mattered**.

For deployment, infrastructure, performance, data-residency, and
runtime-security claims, *config-tier* evidence is not verification. The lifecycle
should be able to tell the difference, and a release gate should be able to
require the stronger tier.

## Recommendations

Both fold into the existing roadmap rather than opening a new track.

### R1 — Conformance check ("ADG doctor"), folded into roadmap item 12

Add a `doctor`/conformance command (the roadmap already plans `adg doctor`) that
an adopter repo runs and that **fails when the install has drifted from ADG's
invariants**:

- generated `*.sqlite` or JSON/SQL mirrors are git-tracked (should be gitignored);
- a custom gate diffs committed generated artifacts (re-introduces the
  regenerate-then-amend tax);
- generated docs embed volatile provenance (git SHA / timestamp) in tracked files.

Wire it into `adg:install:status` and have `adg:update` warn on drift. Goal: the
"SQLite is generated, not canonical" rule becomes **checkable**, not just
documented.

### R2 — Evidence tiers on verify/audit, with a release-gate rule

Extend the verify/audit evidence model with a small, ordered tier:

| tier | meaning |
|---|---|
| `asserted` | a human/agent claim, no artifact |
| `config` | the controlling configuration exists (Terraform / env / flag) |
| `test` | an automated check passed (unit / integration / gate) |
| `live` | observed true in the running or deployed system (probe, response header, measured metric, restore drill) |

Then one release-gate rule: claims in **declared-sensitive classes** (deploy,
infra, performance, runtime-security, data-residency) **cannot gate a release on
`config`/`test` alone** — they require a `live` evidence event. This is a few-line
schema addition (an enum column plus one view predicate) and directly prevents
the F2 failure class. It also strengthens roadmap items 1 and 6 (task evals /
context-quality) by giving graders a *typed* notion of what kind of evidence
backs a claim.

### R3 — Bring the bord.room install back into conformance (downstream)

In the adopter repo: gitignore the generated `*.sqlite` and the regenerated
mirrors, drop or de-fang the committed-artifact drift gate, and stop embedding the
git SHA in tracked docs. This is remediation in bord.room, not platform work — but
R1 is what would have prevented the drift in the first place.

## Implementation plan

Small and sequenced; each phase is independently shippable and self-governed
under ADG's own lanes. Binaries stay gitignored throughout (eat the dog food).

- **Phase 0 — baseline (this change).** Land this report; tag **v0.9.1** as the
  reviewed, pre-development revert point. No behavior change.
- **Phase 1 — evidence tiers (R2).** Add an `evidence_tier` enum to the
  audit/verify schema and seed; thread it through `backlog:verify` and
  `audit:record`; add the release-gate view predicate; document in `AGENTS.md` and
  `docs/sql-data-layer.md`; add a `backlog:validate` check. *Test:* a
  sensitive-class claim with only `config` evidence fails the release gate; a
  `live` event clears it.
- **Phase 2 — conformance doctor (R1).** Add `scripts/adg-doctor.mjs` + an
  `adg:doctor` script; check for tracked generated DBs/mirrors, committed-artifact
  diff gates, and provenance-in-tracked-docs; wire into `adg:install:status` and
  `adg:update`. *Test:* a fixture install with a tracked `*.sqlite` fails doctor.
- **Phase 3 — adopter remediation (R3).** Apply doctor's guidance to bord.room
  (separate change, in that repo).

Relative to the roadmap, Phases 1–2 are **prerequisites**: typed evidence makes
the roadmap's eval/trace work trustworthy, and the doctor keeps adopters honest.
They slot before roadmap items 1–2 or run in parallel.

## Revert point

This document is the **only** change in **v0.9.1** — it is the agreed baseline to
develop the hardening from, or to revert to. Implementation of Phases 1–3 begins
only after review.
