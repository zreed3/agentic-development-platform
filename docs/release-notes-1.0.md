# ADG 1.0 release notes

Agentic Development Governance (ADG) 1.0. A SQL-first, deny-by-default governance layer
for agent-assisted development: external, deterministic guardrails, an append-only and now
tamper-evident audit log, AI-security evals as a pre-merge gate, and bounded context.

Style rule: no em dashes. Date: 2026-06-15.

## The thesis 1.0 deepens

A guardrail trained into a model can be talked around with a prompt; a guardrail enforced
outside the model (a deterministic PreToolUse hook, a deny-by-default policy, an
append-only audit log) cannot be. The June 2026 Fable 5 and Mythos 5 access suspension,
triggered by a prompt that bypassed an in-model safeguard, is the motivating case. ADG 1.0
deepens external enforcement and keeps the new toggleable-controls surface from ever
becoming the jailbreak: toggling a control is itself a governed, audited action, and the
always-on controls are pinned in code where no configuration can reach them.

## What is new in 1.0

### Toggleable controls (policy-as-code)

Every guardrail control lives in `config/agentic/guardrails.json` under `controls`, with an
explicit enable/disable surface scoped by risk and context. Safe defaults are
deny-by-default. Three controls are always-on and can never be disabled:
`destructiveDeny`, `auditAppendOnly`, and `forbiddenBulkRead`. They are pinned in code in
both `scripts/guardrail-check.mjs` and the deterministic hook, so a hand-edit that relaxes
one is ignored at runtime (fail-closed) and rejected by the gate.

Toggling is a governed action. The only supported path is
`npm run guardrails:toggle -- --control <name> --set off --reason "..." --risk "..."
--rollback "..."`. It refuses always-on controls, requires reason, risk, and rollback, and
writes an append-only audit `decision` event. Negative tests prove a disabled control is
logged and a re-enabled control blocks again, and that an always-on control cannot be
disabled at runtime or pass validation.

### Tamper-evident audit log (rolling hash chain)

The append-only audit log now carries a rolling hash chain (`scripts/audit-chain.mjs`,
following RFC 9162, the research.swtch.com transparent-logs design, and GoLogX). Each
recorded event stores a `prevHash` and a `hash` over a canonical field projection. The
write stays a single append; no earlier line is ever rewritten. `npm run audit:validate`
hard-fails on any edit, deletion, reorder, or insertion in the chained region. A
git-tracked high-water-mark sidecar (`data/audit/audit-log.chain-state.json`) additionally
closes a strip-all-hashes rewrite, a truncated chain tip, and a pre-chain edit. Append-only
is strengthened, never weakened.

### One install, one policy source

`npm run adg:install -- --client claude|codex|both` ships the shared deterministic
enforcement layer to a host repo: the hook, the single policy source, the validator, the
governed toggle, and the append-only audit recorder and chain. Both the Claude Code and the
Codex adapters enforce the same deny-by-default policy from one file. A routine
`npm run adg:update` is merge-aware: it preserves the host's governed toggle state and
never carries a relaxed always-on control forward. `--force-policy` re-baselines to the ADG
source. `npm run adg:doctor` fails when a host relaxed an always-on control or disabled a
toggleable control without a matching audit decision.

### Better LLM responses (structured and constrained outputs)

The governance MCP server (`scripts/adg-mcp-server.mjs`) defaults `context_packet` to the
compact TOON serialization, gives `classify_work` and `record_audit` strict output schemas
with `structuredContent`, refuses likely-secret input to `record_audit`, and adds a
read-only `control_state` tool that reports the controls block and always-on set. The
dashboard gains a read-only controls view with the toggle history. There is no mutating
toggle on the MCP server or the dashboard, by contract.

### Token reduction (measured)

All deltas are measured with `scripts/adg-tokens.mjs` (a deterministic, reproducible
estimate applied identically before and after, so the delta is a measurement, not an
assertion). See `docs/agent-guides/adg-1.0-baseline-tokens.json`.

| Surface | Before | After | Delta |
| --- | --- | --- | --- |
| MCP context_packet default (per call) | 5048 | 1386 | -73% (json -> toon) |
| agent:evals stdout | 1337 | 94 | -93% (compact summary; full report kept in data/agent-evals.json) |
| guardrail-check --quiet | 107 | 15 | -86% |
| validate-audit --quiet | 67 | 14 | -79% |

The context packet is also prefix-stable (the volatile `generatedAt` moved to a trailing
block), so a host's stable prefix is prompt-cache-eligible, where cache reads cost about
0.1x base input price.

### AI security and evals

The deterministic hook closed real bypasses found by an adversarial swarm: option-inserted
`git -c ... push`, separated `rm -r -f`, `find -delete`, pipe-to-shell, audit-log
truncation and in-place edit, recursive permission lockout (`chmod -R 000`), and shell
writes to the policy file. The eval gate now drives the real hook (not the abstract policy
table) and adds scenarios for indirect prompt injection, multi-agent propagation, and
toggle-abuse.

### Governance alignment assessment

`docs/governance-alignment.md` maps each ADG control to the OWASP LLM Top 10, ISO/IEC
42001, the IIA Three Lines Model (2020), and ISO 31000, with the machine-readable mapping
in `config/agentic/standards-map.json`. A new `governance-controls` release class requires
`live` evidence to sign off any feature that implements or changes an always-on control.

## Known limitations and post-1.0

These are tracked, documented deferrals, not silent gaps:

- Audit-chain external anchor: the chain plus the git-tracked sidecar prove the log has not
  shrunk or been internally rewritten since the trusted writer last ran, but they do not by
  themselves stop an attacker who can rewrite both the log and the sidecar. The real
  prevention layer is the deterministic hook (the always-on `auditAppendOnly` control) plus
  git history and code review. Committing the rolling-hash tip to git as an external anchor
  is a planned post-1.0 hardening.
- Context cache markers and broker pagination: explicit `cachePrefix` markers in
  `context-profiles.yaml` and `--range`/`--cursor` pagination on the context broker are
  post-1.0. The packet already builds a stable, cache-eligible prefix today.
- The MCP server identity version is a literal; reading it dynamically from the manifest is
  a post-1.0 drift-prevention cleanup.

## Upgrade notes

- The policy file is merge-managed by the installer. After `adg:update`, a host's governed
  toggles are preserved; use `--force-policy` only to deliberately re-baseline.
- `data/audit/audit-log.chain-state.json` is a git-tracked sidecar. Commit it alongside the
  audit log. A log that predates the chain validates under bootstrap tolerance; the first
  recorded event activates enforcement.

## Sources

Grounded in `docs/agent-guides/adg-1.0-research-brief.md` and the per-loop research,
including: Anthropic effective context engineering and prompt caching; arXiv 2501.10868
(JSONSchemaBench), 2503.13657 (MAST), 2411.16594 (LLM-as-a-judge survey); RFC 9162
(Certificate Transparency); the OWASP Top 10 for LLM Applications; ISO/IEC 42001; the IIA
Three Lines Model; and ISO 31000. Full citation list in the research brief and
`docs/governance-alignment.md`.
