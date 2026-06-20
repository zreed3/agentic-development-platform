# ADG 1.0 ultra-loop log

Running record of the three self-converging loops taking ADG 0.9.1 to 1.0. Each loop:
research swarm, use-case and gap swarm, build swarm, judge panel, then a green
ci:governance, one consolidated audit event, and a completeness critic feeding the next
loop. Grounded in docs/agent-guides/adg-1.0-research-brief.md. Style rule: no em dashes.

Token measurement method: scripts/adg-tokens.mjs (deterministic, reproducible; same
method both sides, so deltas are measured, not asserted). Baseline in
docs/agent-guides/adg-1.0-baseline-tokens.json.

## Loop 1 (complete)

Research and gap swarm: 12 agents (6 research opus/sonnet mix, 5 adversarial gap-hunters,
1 opus synthesizer), 909k subagent tokens, live web access, verified sources. The
adversarial gap-hunters found 5 real, reproducible hook bypasses (each with a repro).

Build (7 change units, parent-integrated for a coherent gate):
- U1 toggleable controls in the single policy source + tamper-evident validator.
- U2 governed toggle CLI (refuses always-on, requires reason/risk/rollback, writes an
  append-only audit decision event), 11/11 negative tests.
- U3 hook hardening: reads the policy controls (fail-closed), pins the always-on floor in
  code, closes 5 bypasses (git -c push, separated rm -r -f, find -delete, curl|bash,
  audit-log tamper), adds billing + control-file guard. 27/27 hook tests.
- U4 evals drive the real hook + 3 new scenarios (indirect injection, multi-agent
  propagation, toggle-abuse); compact stdout.
- U5 MCP TOON default + outputSchema/structuredContent + secret redaction.
- U6 context packet prefix-stable (generatedAt to a trailing _meta block).
- U7 alignment assessment doc + standards map (OWASP LLM Top 10, ISO 42001, Three Lines,
  ISO 31000, ADG-CTRL-007).

Judge panel: 7 units, 3 opus judges each, distinct lenses, refute-by-default, randomised.
Result: 21/21 approve, 0 weakensInvariant, all measured wins re-verified by the judges
running the commands themselves. All 7 units shipped.

Measured wins (Loop 1):
- agent:evals stdout 1337 to 94 est tokens (-93%) while growing from 5 to 8 scenarios.
- MCP context_packet default 5048 to 1386 est tokens (-73% per call).
- ci:governance stdout 27876 to 27195 est tokens despite adding 2 gate steps.
- context packet prefix-stable (enables prompt-cache reuse; cache reads about 0.1x base
  input price).

Gate: npm run ci:governance green (exit 0), 27 steps. Audit: AUD-20260615023513-bcb2bc
(decision, tier test). Deny-by-default and append-only audit strengthened, not weakened.

### Completeness critic -> Loop 2 input

Consolidation is the least-complete axis and dominates Loop 2. Keystone finding: the
installer ships neither guardrails.json nor the Codex hook, so a host has no policy source
to read and toggleable controls are inert there (scripts/adg-install.mjs:68; the host hook
loadControls() returns null without the file).

Ranked Loop 2 list:
1. L2-1 ship guardrails.json (controls block) to hosts (keystone; prerequisite for 2-5).
2. L2-2 add --client codex and --client both to the installer.
3. L2-3 doctor: install + drift-check the controls block (relaxed always-on = FAIL).
4. L2-6 audit-log rolling hash chain (tamper-evidence); validator hard-fails on a break.
5. L2-4 read-only controls-state + toggle-history on the dashboard.
6. L2-5 read-only control_state MCP tool (never a mutating toggle).
7. L2-7 release class pinning audit-append-only / destructive-deny as non-signable-off.
8. L2-8 broaden hook destructive coverage (shred, git clean -fdx, chmod -R 000, ...).
9. L2-9 --quiet/--summary one-line mode across gate subcommands.
10. L2-10 full-gate as a subagent pass/fail roll-up path.
11. L2-11 context-profiles cachePrefix markers + broker pagination/range.

Carry-forward guardrails: never add a mutating toggle to MCP or the dashboard; never
rewrite earlier audit lines to repair a hash chain (append a correction); always-on floor
stays pinned in code; quiet modes change output only; pagination must not become a
bulk-read bypass.

## Loop 2 (complete)

Research + adversarial design-review swarm (8 agents, live web): pulled RFC 9162, the
research.swtch.com transparent-logs essay, and GoLogX to ground the hash chain, and
design-reviewed the four riskiest planned changes BEFORE building. The reviews caught
four real flaws pre-build (update clobbering host toggles, raw-line vs canonical hashing,
the codex hookPath escaping the host, an MCP toggle-surface risk), all folded into the
specs as mustDo constraints.

Build (7 change units, gate green):
- U2-1 audit-log rolling hash chain (scripts/audit-chain.mjs shared canonicalizer;
  record-audit appends prevHash/hash with a single fs.appendFileSync, never rewrites;
  validate-audit hard-fails on edit/delete/reorder/insert in the chained region). 8/8.
- U2-2 consolidation: installer ships the single policy source + validator + governed
  toggle + audit recorder/chain to hosts; merge-aware update preserves host toggles and
  never carries a relaxed always-on forward; --force-policy re-baselines.
- U2-3 codex client (--client codex/both), Codex adapter host-hook path fixed plus a
  symlink isMain bug that made the CLI silently no-op under symlinked install paths.
- U2-4 doctor controls-drift (relaxed always-on or unaudited disable = FAIL).
- U2-5 read-only control_state MCP tool.
- U2-6 broadened destructive coverage (chmod -R 000) + Bash-branch policy-write guard.
- U2-7 --quiet one-line gate validators (guardrail-check 107->15, validate-audit 67->14).

Judge panel: 7 units, 3 opus judges each, refute-by-default. 20/21 approve, 0
weakensInvariant; all 7 units shipped. The 1 reject was a token-delta lens on a non-token
security unit (lens mismatch, majority shipped). Judges verified append-only is
STRENGTHENED (single append, no line rewritten, checked byte-for-byte).

Gate: npm run ci:governance green (exit 0), ~31 steps. Audit: AUD-20260615032749-1572d1
(decision, tier test) -- this event is the chain anchor (prevHash = GENESIS); the real
log now validates with 1 chained event. Deny-by-default and append-only strengthened.

### Completeness critic -> Loop 3 (release loop)

Release mechanics are mandatory. Exact version surface to move to 1.0.0: package.json,
config/agentic/delivery-lanes.json (moves installer + work-classify), the plugin /
marketplace / MCP track (agentic-plugin.manifest.json, both plugin.json, marketplace.json
x2, adg-mcp-server.mjs), and the test-adg-install.mjs version assertion (must move with
delivery-lanes.json). Plus: AGENTS.md 1.0 update + claude:generate regen, README pass,
docs/release-notes-1.0.md, and a consolidated release audit event. Completeness items:
release-class pinning of always-on invariants, and the read-only dashboard controls view.
Deferred post-1.0 (documented): audit-chain external git tip-anchor; context cachePrefix
and broker pagination. Risk: 1.0 prose must not soften "always-on" or "append-only".

## Loop 3 (complete) -- the release loop

Between loops 2 and 3, the audit-chain was hardened out of band with a git-tracked
high-water-mark sidecar (data/audit/audit-log.chain-state.json) that closes the
strip-all-hashes, tip-truncation, and pre-chain-edit attacks a Loop 2 judge had flagged;
the chain test grew to 15 cases and the real log validates with the sidecar enforcing.

Research + gap swarm (6 agents, live web): researched release-class / evidence-gate
patterns and verified the version surface is exhaustive (the swarm caught extra strings
the critic missed: apps/dashboard/package.json, the policyVersion, package-lock).

Build (R1-R6, gate green):
- R1 version 1.0.0 across the full surface (package.json, delivery-lanes.json which drives
  the installer + work-classify, the MCP server, all plugin/marketplace manifests, the
  dashboard, the install-test assertion, and the synced lock). Historical lineage refs
  deliberately retained.
- R2 AGENTS.md documents the 1.0 controls, audit chain, and codex client (em-dash-free
  additions, invariant language present-tense), CLAUDE.md regenerated via claude:generate.
- R3 (C1) governance-controls release class: a feature touching an always-on control
  cannot be signed off without live evidence; proven by an extended evidence-tier-gate
  test (tightening-only, no downgrade path).
- R4 README 1.0 pass + R5 docs/release-notes-1.0.md with an honest known-limitations
  section (audit-chain git anchor, cachePrefix/pagination deferred).
- R6 (C2) read-only dashboard controls view (controls route + readers + nav + installer
  file set); strictly read-only, builds clean.

Judge panel: 5 units, 3 opus judges each, refute-by-default, with an explicit
invariant-prose-softening lens. 14/15 approve, 0 weakensInvariant (no doc softened
deny-by-default / always-on / append-only; the release class only tightens; the dashboard
stays read-only). The 1 reject was a quality-lens nit about pre-existing rulebook em
dashes, not generated content. All 5 units shipped.

Gate: npm run ci:governance green (exit 0). Release: AUD-20260615040439-cea067 (decision,
status released, tier test) -- the 3rd chained event.

## 1.0 measured deltas (reproducible via scripts/adg-tokens.mjs)

- MCP context_packet default: 5048 -> 1386 est tokens per call (-73%, json -> toon).
- agent:evals stdout: 1337 -> 94 est tokens (-93%) while scenarios grew 5 -> 8 (3 driving
  the real hook).
- guardrail-check --quiet: 107 -> 15; validate-audit --quiet: 67 -> 14.
- context packet prefix-stable: per-call tokens unchanged, stable prefix now cacheable.

Quality deltas: 5 real hook bypasses closed (git -c push, separated rm -r -f, find
-delete, pipe-to-shell, audit-log tamper) plus chmod -R 000 and policy shell-writes; evals
now exercise the real enforcement hook; the append-only log is tamper-evident (hash chain
+ sidecar); one install ships one policy source to two harnesses; toggling is governed and
audited; the governance alignment assessment maps every control to OWASP LLM Top 10, ISO
42001, the Three Lines model, and ISO 31000.
