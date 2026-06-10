---
title: Dual-Harness Governance — Codex and Claude Code, One Policy
status: active
classification: internal
category: reference
---

# Dual-Harness Governance

ADG is published as **one plugin with two adapters** so Codex and Claude Code can
run in the **same repo** and follow the **same rules**.

## One source of rules, two adapters

| Shared (single source of truth) | Used by |
|---|---|
| `config/agentic/guardrails.json` — deny-by-default risk classes | both |
| `AGENTS.md` rulebook → generated `CLAUDE.md` (`npm run claude:generate`) | both (identical text) |
| `plugins/adg-governance/agentic-plugin.manifest.json` — neutral commands + risk classes | both |
| `plugins/adg-governance/skills/` — portable skills | both |
| `plugins/adg-governance/hooks/adg-guardrail-hook.mjs` — the enforcement script | Claude now; Codex via adapter |

The neutral manifest's `adapters` array binds each harness:

- **`.codex-plugin/plugin.json`** — the Codex adapter (skills + commands + interface).
- **`.claude-plugin/plugin.json`** — the Claude Code adapter (skills + commands + the
  PreToolUse hook).

Because `CLAUDE.md` is **generated from `AGENTS.md`**, the two harnesses cannot
read different rulebooks — that is the structural guarantee of "same rules."

## Enforcement: same rules, harness-appropriate teeth

Honest about the asymmetry:

- **Claude Code** enforces **deterministically**: the `PreToolUse` hook
  (`hooks/adg-guardrail-hook.mjs`) hard-blocks destructive commands and raw reads
  of generated context hazards (exit 2), and asks on secrets / production /
  migration. The rules become *physically enforced* at the tool gate.
- **Codex** enforces through its **approval policy** plus the shared
  `guardrails.json` and the skills/commands that carry the same risk classes.
  A harness-neutral adapter (`.codex-plugin/hooks/adg-codex-pretool.mjs`) already
  wraps the **same** `adg-guardrail-hook.mjs`: it normalises a pre-tool event
  (tolerating `tool_name`/`toolName`/`name` and `tool_input`/`input`/`arguments`),
  runs the shared hook, and emits a uniform `{decision, reason}` with a matching exit
  code (`2` = deny, `0` = ask/allow). When Codex exposes a pre-tool hook surface,
  wiring it to this adapter gives Codex the same deterministic gate Claude Code
  enforces — one policy script, both harnesses. Until then, Codex follows the same
  *rules*, with the *teeth* coming from its approval prompts.

## Using both in one repo

1. Install the marketplace once: `claude plugin marketplace add <repo>` then
   `claude plugin install adg-governance` (Claude Code). Or, for a copy-install
   tracked in `adg-install-state.json`, run `npm run adg:install -- --target <repo>
   --client claude`, which lays down the PreToolUse guardrail hook,
   `.claude/settings.json` (hook + deny-by-default permissions), the slash commands,
   the conformance doctor, and a `CLAUDE.md` generated from the host's `AGENTS.md`.
2. Install/refresh the Codex adapter with the existing `npm run adg:install --
   --target <repo>` flow.
3. Run `npm run claude:generate` so `CLAUDE.md` mirrors `AGENTS.md`; `npm run
   claude:check` (and, later, the conformance doctor) fails if they drift.
4. Both adapters now resolve every action against the one `guardrails.json`.

There is no conflict running both: they read separate per-harness rulebook files
(`AGENTS.md` for Codex, the generated `CLAUDE.md` for Claude Code) that are
guaranteed identical, share the skills and policy, and only the Claude adapter
registers a hook.
