# @adg/sdk

ADG governance for agent SDKs. **Builds ON** the Anthropic Claude Agent SDK and the OpenAI
Agents SDK — it does not replace their loops. Zero runtime dependencies; the vendor SDKs are
optional peers. The adapters import nothing from the vendor packages — they only *produce*
values those SDKs consume, so this works wherever the vendor SDK is installed.

## Claude Agent SDK

```js
import { query } from "@anthropic-ai/claude-agent-sdk";
import { withClaudeGovernance, governAgentModel } from "@adg/sdk/claude";

const options = withClaudeGovernance({
  systemPrompt: { type: "preset", preset: "claude_code" },
  agents: {
    planner: { description: "decompose the feature", prompt: "...", ...governAgentModel({ lane: "L3", role: "planner" }) },
    worker:  { description: "implement one item",    prompt: "...", ...governAgentModel({ lane: "L1" }) },
  },
});

for await (const msg of query({ prompt: "build feature S07", options })) {
  // ...
}
```

`withClaudeGovernance` patches the `Options` with:

| ADG concern | Native SDK field it sets |
|---|---|
| action gate (deny-by-default, write-scope) | `options.canUseTool` — delegates to the hardened hook |
| governor — termination + verifier-as-authority | `options.hooks.Stop` / `SubagentStop` |
| backpressure — failed checks as observations | `options.hooks.PostToolUse` |
| context / pin / rehydrate | `options.hooks.UserPromptSubmit` / `PreCompact` / `SessionStart` |
| model orchestrator (per subagent) | `AgentDefinition.model` + `.effort` via `governAgentModel()` |

It preserves any `canUseTool` and `hooks` you already passed.

## OpenAI Agents SDK

```js
import { Agent, Runner } from "@openai/agents";
import { governTool, adgOutputGuardrail, adgRunHooks, modelSettingsFor, loopCaps } from "@adg/sdk/openai";

const agent = new Agent({
  name: "builder",
  tools: [/* wrap each tool's execute with governTool(name, fn) */],
  outputGuardrails: [adgOutputGuardrail()],
  modelSettings: modelSettingsFor({ lane: "L2" }),
});

await Runner.run(agent, input, { hooks: adgRunHooks(), maxTurns: loopCaps().maxTurns });
```

| ADG concern | Native SDK field |
|---|---|
| action gate | `governTool(name, fn)` tool wrapper (denies → throws, surfaced as an observation) |
| governor (release gate) | `adgOutputGuardrail()` — tripwire on a violation |
| backpressure | `adgRunHooks().onToolEnd` |
| hard stop | `Runner.run({ maxTurns: loopCaps().maxTurns })` (built into the SDK) |
| model orchestrator | `modelSettingsFor({ lane, risk, role })` → `{ model, reasoning: { effort } }` |

## Why delegation, not re-implementation

The action gate runs the **same deterministic hook binary** the harness installs, via a
subprocess. One source of truth, identical enforcement, no policy drift. An in-process pure
engine (`@adg/core` Phase 0) is a planned performance optimization, not a second copy of the
policy.
