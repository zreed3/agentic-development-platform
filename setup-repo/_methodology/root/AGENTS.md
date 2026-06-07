# AGENTS.md

## Project

This repository is the bord.room V4.1 monorepo. It is a multi-tenant hospitality operations platform with tenant workspaces, business/venue scoping, RBAC, billing/entitlements, operational modules, platform admin, and integrations.

V4.1 should be treated as a launch-hardening release. Do not assume every visible or planned surface is GA. Prefer making live surfaces truthful, secure, scoped, and testable over expanding unfinished modules.

Primary V4.1 source documents:
- `docs/v4-1-release-plan.md`
- `docs/v4-1-site-map.md`
- `docs/UX Design/v4-1-ux-workflows.md`
- `docs/architecture/v4-1-architecture-plan.md`
- `docs/traceability/v4-1-documentation-process.md`
- `docs/traceability/v4-1-development-tracker.sqlite`
- `documents for review/` - Zach-facing architecture and requirements review packets.

## Repo Shape

This is a pnpm/Turbo workspace.

Important areas:
- `apps/web` - Next.js web app.
- `packages/shared` - shared platform types, RBAC permissions, domain types.
- `packages/db` - database schema, migrations, seed and migration scripts.
- `packages/auth` - auth helpers and tenant/session context.
- `packages/config` - environment/config handling.
- `packages/integrations` - integration abstractions and shared integration code.
- `packages/integrations/doshii` - Doshii integration.
- `packages/integrations/ap-ocr` - AP OCR integration.
- `packages/crypto` - encryption and key handling.
- `packages/email` - email sending support.
- `packages/storage` - storage abstraction.
- `packages/events` and `packages/workflow` - events/jobs/workflow support.
- `docs` - planning, architecture, UX, security, interactive docs, traceability.
- `.obsidian` - local Obsidian vault configuration for navigating the repo docs.

Archived V4.0 material belongs outside the active repo under `/Users/zach/Development/_archive.bord.roomv4.1/`. Treat it as reference-only material unless explicitly reactivated, and prefer current V4.1 docs plus the SQL backlog for execution.

## Obsidian Vault And Database Awareness

The repository root is also used as an Obsidian vault for planning and review.
Agents should be aware of this, but must keep the SQL backlog as the canonical
execution source.

Use these Obsidian-oriented sources when gathering product, architecture, or
review context:
- `documents for review/`
- `docs/README.md`
- `docs/traceability/v4-1-documentation-process.md`
- `docs/traceability/v4-1-development-tracker.json`
- `docs/traceability/v4-1-development-tracker.sqlite`
- generated Markdown under `docs/`, including wiki-style links.

Rules:
- Treat `.obsidian/` as local vault configuration and workspace state. Do not
  delete, reset, or rewrite it unless Zach explicitly asks.
- Treat `docs/traceability/v4-1-backlog.sqlite` and
  `docs/traceability/v4-1-backlog-source.sql` as the canonical build backlog.
- Treat Obsidian Markdown/JSON as navigation, review, and context mirrors unless
  a generated-doc source says otherwise.
- Preserve wiki-style links and tags in generated docs.
- Do not store secrets, credentials, customer data, or private operational notes
  in Obsidian-facing docs.

## Commands

Use pnpm.

Common commands:
- Install: `pnpm install`
- Dev all: `pnpm dev`
- Web dev: `pnpm dev:web`
- Build: `pnpm build`
- Lint: `pnpm lint`
- Typecheck: `pnpm typecheck`
- Unit tests: `pnpm test`

Database commands:
- Start dev DB: `pnpm db:up`
- Stop dev DB: `pnpm db:down`
- Reset dev DB: `pnpm db:reset`
- Validate migrations: `pnpm db:validate-migrations`
- Migrate: `pnpm db:migrate`
- Seed: `pnpm db:seed`
- Fresh DB: `pnpm db:fresh`

Jobs:
- Worker dev: `pnpm jobs:dev`

Docs/planning:
- Regenerate V4.1 planning docs: `node scripts/generate-v4-1-planning-docs.mjs`
- Seed SQL backlog from the legacy Linear import: `pnpm backlog:init`
- Validate SQL backlog: `pnpm backlog:validate`
- Snapshot Git branch plus dirty/untracked paths: `pnpm workspace:status`
- Record workspace-state evidence: `pnpm workspace:audit -- --target worktree-baseline --summary "Preserved pre-existing dirty state"`
- Validate audit log: `pnpm audit:validate`
- Check agent guardrail policy: `pnpm guardrails:check`
- Run local agent evals and AI security scenarios: `pnpm agent:evals`
- Capture DORA-style delivery metrics: `pnpm metrics:dora`
- Check generated artifact drift: `pnpm drift:generated`
- Run the traceability gate: `pnpm ci:traceability`
- Run solo-dev pre-push checks: `pnpm dev:prepush`
- Fast delivery context packet: `pnpm context:feature -- --feature S08 --workflow delivery-slice`
- Default Lite context packet: `pnpm context:lite -- --feature S08`
- Lite local checks: `pnpm lite:check`
- Record failed backlog test evidence: `pnpm backlog:fail -- --item S08-TEST-01 --summary "Targeted check failed" --evidence "pnpm test -- ..."`

## Default Delivery Mode

Use the SQL-first backlog, but run the project in Lite feature-slice mode by default.
The normal loop is:

1. Plan: query SQLite and generate one bounded `delivery-slice` packet.
2. Design: decide tenant/business scope, RBAC, entitlement, page-state behavior, and test seams.
3. Build: edit only scoped files and directly related tests.
4. Test: run targeted checks first; record failures with `pnpm backlog:fail`; run full gates at checkpoints.

Repo-local Lite skills live in `skills/`:
- `skills/bordroom-lite-build-runner/SKILL.md`
- `skills/bordroom-lite-traceability/SKILL.md`

Use those Lite skills for normal implementation. Use the heavier `$bordroom-build-runner`
and `$bordroom-traceability` flow only for release checkpoints, process/tooling
changes, broad security work, or before pushing.

Before calling implementation work complete, run the most relevant checks. During complete-dev delivery, use the feature-slice loop: plan the bounded slice, design RBAC/scope/state behavior and test seams, build only scoped files and directly related tests, then test with targeted commands. For broad changes, prefer:
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- Any package-specific test or migration validation relevant to the change.

Do not run `pnpm dev:prepush` after every small backlog item. Reserve full traceability/pre-push gates for feature completion, release checkpoints, process/tooling changes, or before pushing.

## Product And Scope Rules

V4.1 priorities:
1. Tenant and business isolation.
2. Runtime RBAC and entitlement enforcement.
3. Route registry and truthful navigation.
4. Onboarding/provisioning.
5. Billing and package controls.
6. Platform admin operations.
7. Integration status clarity.
8. Operational workflows that are complete enough to trust.

Do not expose unfinished modules as if they are live. If a feature is staged, future, internal-only, or design-only, represent it honestly in navigation, docs, and tests.

CRM, broad connector rollout, full AI automation, direct regulator lodgement, broad OCR/email ingestion, and advanced search should remain future/staged unless explicitly re-scoped.

## RBAC, Scope, And Entitlements

Current tenant roles:
- `owner`
- `admin`
- `manager`
- `staff`
- `viewer`

Current platform roles:
- `super_admin`
- `support`
- `ops`

Shared RBAC definitions live in `packages/shared/src/types/index.ts`.

Every protected operation should satisfy all three checks:
1. Entitlement: tenant package includes the feature.
2. Permission: user role can perform the action.
3. Scope: user is allowed to access the tenant/business rows involved.

Business scoping matters. `TenantMembership.businessIds` may be `null` for all businesses or an explicit list for business-scoped access. Do not implement tenant-only checks where business-scoped checks are required.

Platform admin authority is separate from tenant workspace authority. Platform users should not silently gain tenant workspace access unless there is an explicit audited support/impersonation path.

## Security Rules

Never commit secrets, real credentials, tokens, private keys, or customer data.

Be careful with:
- Clerk identity and session handling.
- Tenant membership resolution.
- RLS context.
- Business scope.
- Billing and entitlement state.
- Webhook verification.
- Integration credentials.
- Tenant encryption keys.
- PII and operational audit trails.

Security-sensitive changes should include negative tests where possible:
- Cross-tenant denial.
- Cross-business denial.
- Insufficient-role denial.
- Missing-entitlement denial.
- Invalid webhook signature denial.
- Credential ownership checks.

Do not weaken encryption, auth, or RLS behavior to make a test pass.

## Database And Migrations

Database code belongs in `packages/db`.

When adding tables or tenant-owned rows:
- Include tenant/business ownership columns where appropriate.
- Add or update migrations.
- Consider RLS policies.
- Validate migrations with `pnpm db:validate-migrations`.
- Keep schema, migration, seed, and runtime repository behavior aligned.

Do not assume Drizzle schema alone is enough; migrations must create the required database objects.

## Integrations

Treat integrations by lifecycle state:
- Live
- Partial
- Stub
- Archived
- Planned
- Internal-only

Known integration/tooling areas include Clerk, Supabase/Postgres, Stripe, Doshii, Deputy, Xero, Gmail, Google Calendar, Resend, Sentry, AP OCR, storage providers, webhooks, jobs/workflows, and archived V4.0 connectors.

Do not surface a connector as customer-ready unless:
- Credentials are tenant-bound.
- Status is accurate.
- Error/retry behavior is documented.
- RBAC and entitlement gates exist.
- Functional tests cover happy path and failure states.

Prefer a registry/config source of truth for integration visibility rather than hardcoded UI lists.

## UX Rules

UX documentation lives in `docs/UX Design`.

For user-facing features, document or update:
- Persona/RBAC role.
- User story.
- Workflow.
- Page states.
- Empty/loading/error/forbidden/entitlement-locked states.
- Mobile and desktop considerations.
- Functional test cases.

Every live page should have truthful states:
- Loading.
- Empty.
- Success.
- Validation error.
- System error.
- Forbidden.
- Entitlement locked.
- Read-only where applicable.
- Dirty/unsaved where applicable.

Avoid adding navigation links to unfinished pages unless they are clearly marked and gated.

## Documentation And Traceability

Keep documentation wiki-style and traceable.

Use `$bordroom-traceability` for V4.1 feature delivery, bug fixes, route changes, UX/architecture updates, integration status changes, release evidence, comments, and status updates. Before finalizing material V4.1 work, record an audit event with:

`node scripts/v4-1-tracker-update.mjs --feature S08 --type status --status in-progress --summary "Started entitlement gate implementation"`

## SQL-First Delivery Backlog

The canonical V4.1 solo-dev backlog is `docs/traceability/v4-1-backlog.sqlite`, with `docs/traceability/v4-1-backlog-source.sql` as the reviewable SQL dump. `docs/linear/v4-pre-production-launch.plan.json` is now a legacy seed/export reference, not the active planning source.

## SQL-First Requirements Elicitation

Use the SQL backlog as the requirements elicitation system. Do not create a
parallel spreadsheet, Markdown-only backlog, or ad hoc task list when the work
belongs in V4.1 planning.

When eliciting, reviewing, or reshaping product scope, maintain the complete
chain in SQL:
- Features in `features`.
- User stories through feature narrative, UX, architecture, personas, and
  permissions fields.
- Tasks in `feature_items` with `item_type = 'task'`.
- Use cases in `feature_items` with `item_type = 'use_case'`.
- Test cases in `feature_items` with `item_type = 'test_case'`.
- Success criteria in `feature_items` with
  `item_type = 'success_criterion'`.
- Persona use cases and RBAC workflow expectations in
  `feature_persona_workflows`.

Every feature-level elicitation pass should answer:
- Which persona or role is this for?
- What route, API, integration, or workflow is touched?
- What is the expected state for owner, admin, manager, staff, viewer,
  anonymous, super_admin, support, and ops where applicable?
- What should be allowed, read-only, scoped, hidden, forbidden, or
  entitlement-locked?
- What task, use-case, success-criterion, and test-case rows prove it?
- What evidence path or command will verify it?

Before marking a feature or item verified, check the SQL views:
```sh
sqlite3 docs/traceability/v4-1-backlog.sqlite \
  "select id,feature_id,item_type,title,current_status,latest_update from backlog_item_current_status where feature_id='S08' order by position;"

sqlite3 docs/traceability/v4-1-backlog.sqlite \
  "select persona_id,rbac_role,realm,access_level,expected_state,primary_route,status from feature_persona_workflows where feature_id='S08' order by persona_id;"
```

After changing elicitation data, run the normal traceability flow:
1. Update `docs/traceability/v4-1-backlog.sqlite` or the source registry.
2. Export/regenerate `docs/traceability/v4-1-backlog-source.sql`.
3. Run `pnpm docs:v4:generate`.
4. Run `pnpm backlog:validate`; run `pnpm ci:traceability` at feature/release checkpoints or after process/tooling changes.
5. Record a feature-level audit event when scope, UX, architecture, routes,
   integrations, or acceptance criteria materially change.

Skill decision: a dedicated Codex skill is useful once this elicitation process
needs to be reused across repos or delegated to agents outside this monorepo.
Inside this repo, `AGENTS.md`, the repo-local Lite skills under `skills/`, and the
SQL-first backlog are the authoritative day-to-day instructions. `$bordroom-traceability`
and `$bordroom-build-runner` remain valid for checkpoint and release-hardening work;
all skills must preserve the SQL-first process rather than replace it.

Update flow:
1. Update the SQL backlog or source registry.
2. Record an audit event with `scripts/v4-1-tracker-update.mjs`.
3. Regenerate artifacts with `pnpm docs:v4:generate`.
4. Run targeted checks for the feature slice, then `pnpm ci:traceability` at feature/release checkpoints.
5. Run `pnpm dev:prepush` before push.

The audit log at `docs/traceability/v4-1-development-audit.jsonl` is append-only. Do not delete or rewrite audit events; append a corrective `comment` or `decision` event if an earlier update was wrong.

## Required Delivery Gates

Before finishing material V4.1 work, run the relevant local gates:
- `pnpm audit:validate` for every JSONL audit append.
- `pnpm backlog:validate` after backlog changes.
- `pnpm guardrails:check` when tool/action policy changes.
- `pnpm agent:evals` for agentic workflow, guardrail, or AI-security changes.
- `pnpm metrics:dora` for delivery-process changes.
- `pnpm drift:generated` after generated docs/tracker changes.

If no reviewer is available, enforce strict solo-dev gates. Any waived gate needs an audit `decision` event with the reason, risk, and rollback note.

When changing feature scope, routes, UX, architecture, or integration status, update the relevant docs:
- `docs/v4-1-release-plan.md`
- `docs/v4-1-site-map.md`
- `docs/UX Design/v4-1-ux-workflows.md`
- `docs/architecture/v4-1-architecture-plan.md`
- `docs/traceability/v4-1-development-tracker.*`
- `docs/traceability/v4-1-development-audit.jsonl`
- `docs/traceability/v4-1-backlog.sqlite`
- `docs/traceability/v4-1-backlog-source.sql`

Regenerate the V4.1 planning pack after route or feature-scope changes:
`node scripts/generate-v4-1-planning-docs.mjs`

Interactive HTML docs live in:
- `docs/interactive`
- `docs/UX Design`
- `docs/architecture`
- `docs/traceability`

Do not hand-edit generated files if the generator should own them. Update the generator or source data instead.

## Testing Expectations

Use risk-based testing.

For narrow UI or logic changes, run targeted checks. For auth, DB, RBAC, billing, integration, or routing changes, add or update tests.

Expected test coverage for protected features:
- Allowed role happy path.
- Lowest allowed role.
- Highest disallowed role.
- Cross-tenant denial.
- Cross-business denial where relevant.
- Missing entitlement denial.
- Empty/error state.
- Audit/log/event behavior where relevant.

The current repo has strong Vitest-style package testing but limited browser E2E coverage. Add browser tests when changing critical user workflows if the tooling exists or is introduced by request.

## Coding Conventions

Follow existing repo patterns before introducing new abstractions.

Prefer:
- Shared types from `packages/shared`.
- Existing auth/session helpers.
- Existing config/env helpers.
- Existing DB/repository patterns.
- Existing UI/component conventions.
- Existing integration abstractions.

Keep changes scoped. Do not perform broad unrelated refactors while fixing a specific issue.

Use TypeScript strictly. Avoid `any` unless the boundary genuinely requires it and validation is performed nearby.

For external data, validate with Zod or existing validation patterns.

## Git And Local Changes

The worktree may contain user changes. Never revert changes you did not make unless explicitly asked.

Before editing, inspect relevant files and run `pnpm workspace:status` for material work. If unrelated files are modified, leave them alone.

Do not use destructive Git commands such as `git reset --hard` or `git checkout --` unless explicitly requested.

When summarizing work, distinguish new changes from pre-existing dirty state.

Track material workspace hygiene notes as `workspace-state` audit events. Use this when a dirty or untracked path is present before the current task, when local dependencies are installed only to run checks, or when a generated artifact is intentionally left untouched:

`pnpm workspace:audit -- --target worktree-baseline --type evidence --status verified --summary "Preserved pre-existing dirty state: docs/interactive/v4-product-briefing.html and .obsidian/" --evidence docs/interactive/v4-product-briefing.html --evidence .obsidian/`

`pnpm workspace:audit -- --target dependency-install --type evidence --status verified --summary "Installed local dependencies with pnpm install --frozen-lockfile; lockfile unchanged" --evidence package.json --evidence pnpm-lock.yaml`

Query these notes with:

`sqlite3 docs/traceability/v4-1-development-tracker.sqlite "select occurred_at,target_id,status,summary,evidence from workspace_state_events order by occurred_at desc;"`

## Agent Behavior

Agents should be proactive but conservative:
- Read the code before changing it.
- Prefer implementation over only proposing when the user asks for a change.
- Ask only when a missing decision is genuinely risky.
- Keep user-facing updates concise.
- Verify work before finalizing.
- Report checks that passed and checks that could not be run.

For parallel or subagent work:
- Before inspecting files, each subagent should run the relevant `pnpm context:*` command and stay within the returned packet unless evidence requires another file.
- Prefer subagents for read-heavy exploration, review, test triage, and summarization. Avoid parallel write-heavy implementation unless Zach explicitly asks for it.
- Subagents should return concise summaries with file references and avoid dumping raw logs into the parent thread.

Do not invent product policy. If launch scope, commercial behavior, or access policy is unclear, use the V4.1 docs as the default and call out uncertainty.
