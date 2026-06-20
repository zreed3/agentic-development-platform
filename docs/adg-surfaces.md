# ADG Surfaces

ADG v2.0 reaches the user through four surfaces, all driven by **one deterministic core** and
**one policy**. Parity means the same capability behaves identically whether invoked from an
editor, the terminal, or code.

## The four surfaces

| Surface | How it's reached | What it exposes |
|---|---|---|
| **Claude Code** (desktop + CLI) | `plugins/adg-governance/.claude-plugin` | PreToolUse guardrail + Stop/PostToolUse/UserPromptSubmit/PreCompact/SessionStart hooks; slash commands; read-only dashboard |
| **Codex** (app + CLI) | `plugins/adg-governance/.codex-plugin` | harness-neutral pretool / stop / post-tool adapters over the same hooks; skills |
| **Terminal** | `@adg/cli` (`packages/cli`, the `adg` binary) | `init`, `install/update/status`, `classify/guard`, `models/tiers`, `context`, `doctor`, `guardrails/toggle`, `audit-*` |
| **Programmatic** | `@adg/sdk` (`packages/sdk`) | `withClaudeGovernance` (Claude Agent SDK), `governTool`/`adgOutputGuardrail`/`modelSettingsFor` (OpenAI Agents SDK) |

## Capability → surface matrix

| Capability | Claude Code | Codex | `adg` CLI | `@adg/sdk` |
|---|---|---|---|---|
| Action gate (deny-by-default, write-scope) | PreToolUse hook | pretool adapter | (via install) | `canUseTool` / `governTool` |
| Governor (termination, verifier-as-authority) | Stop hook | stop adapter | — | Stop hook / output guardrail |
| Backpressure (failed checks as observations) | PostToolUse hook | post-tool adapter | — | PostToolUse / RunHooks |
| Context / pin / rehydrate | UserPromptSubmit/PreCompact/SessionStart | (additive adapters) | — | hooks |
| Model orchestration (tier + effort) | `/adg-models` | skill | `adg models` | `governAgentModel`/`modelSettingsFor` |
| Lane classification | `/adg-classify` | skill | `adg classify` | — |
| Context packet | `/adg-context` | skill | `adg context` | `@adg/core` contextBroker |
| Install / onboarding | `/adg-init` | — | `adg init` | — |
| Conformance doctor | (script) | (script) | `adg doctor` | — |

## Slash commands (Claude Code)

`/adg-classify`, `/adg-context`, `/adg-verify`, `/adg-completeness-critic`, **`/adg-models`**
(new), **`/adg-init`** (new). Each shells the same script the CLI and CI run, so the editor,
the terminal, and CI enforce identical behaviour.

## One core, one policy

Every surface resolves to the deterministic hook binaries and the policy files
(`guardrails.json`, `models.json`, `loop-budget.json`). There is no surface-specific policy —
see `docs/adg-adapter-contract.md` for the uniform decision contract and
`docs/adg-distribution.md` for how each surface is installed.
