// @adg/sdk — ADG governance for agent SDKs. Build ON the vendor loops, don't replace them.
//
//   import { withClaudeGovernance } from "@adg/sdk/claude";
//   for await (const m of query({ prompt, options: withClaudeGovernance(myOptions) })) { ... }
//
//   import { governTool, adgOutputGuardrail, modelSettingsFor } from "@adg/sdk/openai";
//
// Re-exports the host-agnostic core decisions too, so a custom loop can reuse them directly.

export {
  withClaudeGovernance,
  adgCanUseTool,
  adgClaudeHooks,
  governAgentModel,
} from "./claude.mjs";

export {
  governTool,
  adgOutputGuardrail,
  adgRunHooks,
  modelSettingsFor,
  loopCaps,
} from "./openai.mjs";

// Core decisions (vendor-neutral).
export { selectModel, loadModelPolicy } from "../core/select-model.mjs";
export { governorDecision } from "../core/governor.mjs";
export { backpressureDecision } from "../core/backpressure.mjs";
export { classifyToolUse } from "../core/policy-client.mjs";
