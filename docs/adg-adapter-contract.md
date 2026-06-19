# ADG Adapter Contract

ADG enforces its loop decisions through a small set of **deterministic hook binaries** (the
single source of truth). Each harness reaches those decisions through a thin **adapter** that
(1) normalizes the harness's native event shape, (2) spawns the shared hook, and (3) emits a
**uniform decision** on stdout plus a mirroring exit code. One policy, many harnesses.

This is how ADG "builds on" each harness rather than replacing it: the adapter speaks the
harness's event language at the edges, but the decision in the middle is always the same
binary.

## The uniform decision shape

```jsonc
// action gate (pre-tool)            adapter: adg-codex-pretool.mjs   -> hook: adg-guardrail-hook.mjs
{ "decision": "deny",    "reason": "..." }   // exit 2  — block the tool call
{ "decision": "ask",     "reason": "..." }   // exit 0  — confirm before running
{ "decision": "allow" }                       // exit 0

// termination (stop)                adapter: adg-codex-stop.mjs      -> hook: adg-governor-hook.mjs
{ "decision": "block",   "reason": "..." }   // exit 2  — refuse turn-end (model continues)
{ "decision": "allow" }                       // exit 0

// backpressure (post-tool)          adapter: adg-codex-posttool.mjs  -> hook: adg-backpressure-hook.mjs
{ "decision": "observe", "context": "[ADG backpressure] ..." }  // exit 0 — feed back an observation
{ "decision": "allow" }                       // exit 0
```

## Event normalization

Adapters tolerate field-name variants so any harness can feed them:

| Canonical | Accepted aliases |
|---|---|
| `tool_name` | `toolName`, `name`, `tool` |
| `tool_input` | `toolInput`, `input`, `arguments`, `args` |
| `tool_response` | `toolResponse`, `tool_result`, `result`, `output` |
| `stop_hook_active` | `stopHookActive` |
| `session_id` | `sessionId` |

## Fail direction (must match the underlying hook)

- **Action gate / pre-tool** — FAILS CLOSED for mutating tools (`Bash, Edit, Write, MultiEdit,
  NotebookEdit`): a missing or broken gate denies rather than silently allows. Reads fail open.
- **Governor / stop** — FAILS OPEN: it is a quality gate, never a security floor, and must
  never trap the agent. Any non-2 exit → `allow`.
- **Backpressure / post-tool** — FAILS OPEN: additive observation only.

## Adapter map

| Harness event | Adapter | Underlying hook (source of truth) |
|---|---|---|
| pre-tool / PreToolUse | `.codex-plugin/hooks/adg-codex-pretool.mjs` | `hooks/adg-guardrail-hook.mjs` |
| stop / Stop / SubagentStop | `.codex-plugin/hooks/adg-codex-stop.mjs` | `hooks/adg-governor-hook.mjs` |
| post-tool / PostToolUse | `.codex-plugin/hooks/adg-codex-posttool.mjs` | `hooks/adg-backpressure-hook.mjs` |
| user-prompt / session-start / pre-compact | (context injectors; additive) | `hooks/adg-context-hook.mjs` etc. |

## In-process alternative (the SDK)

For programmatic callers, `@adg/sdk` (`packages/sdk/`) and `@adg/core/policy-client` provide
the same decisions in-process — the action gate still delegates to `adg-guardrail-hook.mjs`,
while the governor/backpressure/context decisions are imported as pure functions from
`@adg/core`. Same contract, no subprocess for the pure decisions.

## Host packaging

The action-gate adapter and hook ship to host repos today (see `scripts/adg-install.mjs`,
`sharedEnforcementFiles`). The lifecycle adapters and their hooks are packaged for host
installs in Phase 6 (distribution); until then they run from the ADG repo.
