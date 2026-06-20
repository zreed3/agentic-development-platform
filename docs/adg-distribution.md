# ADG Distribution

ADG meets users inside a host they already run, and proves value in one command. The same
deterministic core is reachable from every surface.

## Channels

| Channel | Command | Audience |
|---|---|---|
| Zero-onboarding init | `npx @adg/cli init` | first-time / trial |
| Global CLI | `npm i -g @adg/cli` → `adg …` | terminal users |
| Claude Code plugin | marketplace: `adg-governance` (`plugins/adg-governance/.claude-plugin`) | Claude Code (desktop + CLI) |
| Codex plugin | `codex plugin add adg` (`plugins/adg-governance/.codex-plugin`) | Codex (app + CLI) |
| Programmatic SDK | `npm i @adg/sdk` | agent builders (Claude Agent SDK / OpenAI Agents SDK) |
| One-line installer | `curl -fsSL <host>/install.sh \| sh` | CI / scripted | 

## `adg init` — the zero-onboarding flow

```sh
npx @adg/cli init            # in your repo
# or target another repo:
adg init --target /path/to/repo --client claude|codex|both
```

It (1) **detects the host** (`.claude`/`CLAUDE.md` → claude, `.codex`/`AGENTS.md` → codex),
(2) **installs the deterministic guard** via the tested installer, and (3) **classifies your
actual pending changes** so the first output you see is a real lane decision, not a config
dump. No docs-first onboarding.

## The `adg` CLI

One entrypoint over the deterministic scripts — `init`, `install`/`update`/`status`,
`classify`/`guard`, `models`/`tiers`, `context`, `doctor`, `guardrails`/`toggle`,
`audit-record`/`audit-validate`. Run `adg help` for the full map. The CLI is a thin
dispatcher: every command is the same script the plugins and CI run, so the terminal, the
editors, and CI enforce identical behaviour.

## Surface parity (one core, many front doors)

```
Surfaces:   Claude Code (desktop+CLI)   Codex (app+CLI)   Terminal `adg`   @adg/sdk
Adapters:   .claude-plugin              .codex-plugin     packages/cli     packages/sdk
Core:       @adg/core  (policy client · governor · backpressure · model selection · context)
Source of   the deterministic hook binaries (one policy; see docs/adg-adapter-contract.md)
truth:
```

## Packaging note (in progress)

The action-gate hook + Codex pretool adapter ship to host repos today
(`scripts/adg-install.mjs`, `sharedEnforcementFiles`). Host-packaging the new lifecycle
hooks (governor / backpressure / context injectors) requires bundling their `@adg/core`
imports into self-contained files; that installer change is tracked as a reviewed follow-up
(see `docs/adg-2.0-overhaul-plan.md`), so it lands with the install-test suite kept green
rather than unattended.
