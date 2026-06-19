// @adg/sdk — Claude Agent SDK governance adapter.
//
// Builds ON the Claude Agent SDK (`query({ prompt, options })`); it does NOT replace its loop.
// This module imports NOTHING from `@anthropic-ai/claude-agent-sdk` — it only *produces*
// values the SDK consumes (`canUseTool`, `hooks` callbacks, `agents` / `AgentDefinition`),
// so @adg/sdk stays zero-dependency and works wherever the vendor SDK is installed.
//
// Mapping (ADG concern -> native SDK field):
//   action gate (PolicyEngine) -> options.canUseTool   (delegates to the hardened hook)
//   governor (termination, P3/P12) -> options.hooks.Stop / SubagentStop
//   backpressure (P8)              -> options.hooks.PostToolUse
//   context / pin / rehydrate      -> options.hooks.UserPromptSubmit / PreCompact / SessionStart
//   model orchestrator             -> AgentDefinition.model + AgentDefinition.effort

import { classifyToolUse, queryViolations } from "../core/policy-client.mjs";
import { governorDecision } from "../core/governor.mjs";
import { backpressureDecision } from "../core/backpressure.mjs";
import { buildSteeringHeader, buildPinContext, buildRehydrateContext } from "../core/loop-context.mjs";
import { selectModel, loadModelPolicy } from "../core/select-model.mjs";
import { queryActiveItem, readAuditTip, readLastAudit, loadLoopBudget } from "../core/backlog-read.mjs";

function ctx(text) {
  // The additionalContext contract the SDK injects into the model's next input.
  return text ? { hookSpecificOutput: { additionalContext: text } } : {};
}

/**
 * The ADG action gate, as a Claude Agent SDK `canUseTool` callback. Delegates to the
 * deterministic hook so the SDK enforces exactly the harness policy. Wraps any prior
 * canUseTool: ADG `deny` is final; ADG `ask` defers to the prior callback (or denies headless).
 */
export function adgCanUseTool(prior, { cwd, writeScope } = {}) {
  return async (toolName, input, options) => {
    const d = classifyToolUse({ tool: toolName, input, cwd, writeScope });
    if (d.decision === "deny") return { behavior: "deny", message: `[ADG] ${d.reason}` };
    if (d.decision === "ask") {
      if (typeof prior === "function") return prior(toolName, input, options);
      return { behavior: "deny", message: `[ADG] confirmation required and no interactive approver is wired: ${d.reason}` };
    }
    if (typeof prior === "function") return prior(toolName, input, options);
    return { behavior: "allow", updatedInput: input };
  };
}

/** The ADG lifecycle hooks, as Claude Agent SDK programmatic hook callbacks. */
export function adgClaudeHooks({ cwd = process.cwd() } = {}) {
  const budget = loadLoopBudget(cwd);
  const mode = budget?.releaseGate?.mode || "block";
  const caps = budget?.caps || {};
  return {
    Stop: [
      {
        callback: async (event) => {
          const d = governorDecision({
            stopHookActive: Boolean(event?.stop_hook_active),
            violations: queryViolations(cwd),
            caps,
            mode,
          });
          return d.action === "block" ? { decision: "block", reason: d.reason } : {};
        },
      },
    ],
    PostToolUse: [
      {
        callback: async (event) => {
          const resp = event?.tool_response || event?.tool_result || {};
          const exitCode = [resp.exit_code, resp.exitCode, resp.returnCode, resp.code].find((v) => Number.isFinite(v));
          const output = [resp.stdout, resp.stderr, resp.output].filter(Boolean).join("\n");
          const d = backpressureDecision({ toolName: event?.tool_name, command: event?.tool_input?.command, exitCode, output });
          return d.surface ? ctx(`[ADG backpressure] ${d.reason}`) : {};
        },
      },
    ],
    UserPromptSubmit: [{ callback: async () => ctx(buildSteeringHeader({ activeItem: queryActiveItem(cwd) })) }],
    PreCompact: [{ callback: async () => ctx(buildPinContext({ activeItem: queryActiveItem(cwd), auditHead: readAuditTip(cwd) })) }],
    SessionStart: [{ callback: async () => ctx(buildRehydrateContext({ activeItem: queryActiveItem(cwd), lastAudit: readLastAudit(cwd) })) }],
  };
}

/** Merge ADG hook callbacks into an existing hooks map without dropping the caller's. */
function mergeHooks(prior = {}, adg = {}) {
  const out = { ...prior };
  for (const [event, matchers] of Object.entries(adg)) {
    out[event] = [...(prior[event] || []), ...matchers];
  }
  return out;
}

/**
 * Map an ADG lane/risk/role to a Claude `AgentDefinition` fragment ({ model, effort }).
 * Spread it into an AgentDefinition so each subagent runs the cheapest tier clearing its risk
 * floor. e.g. `{ ...governAgentModel({lane:'L3'}), description, prompt }`.
 */
export function governAgentModel({ lane, risk, role } = {}, policy = loadModelPolicy()) {
  const { model, effort } = selectModel({ lane, risk, role }, policy);
  return { model, effort };
}

/**
 * The headline convenience: patch a Claude Agent SDK `Options` object with the full ADG
 * governance layer (action gate + all lifecycle hooks). Returns a NEW options object.
 */
export function withClaudeGovernance(options = {}, { cwd = process.cwd(), writeScope } = {}) {
  return {
    ...options,
    canUseTool: adgCanUseTool(options.canUseTool, { cwd, writeScope }),
    hooks: mergeHooks(options.hooks, adgClaudeHooks({ cwd })),
  };
}
