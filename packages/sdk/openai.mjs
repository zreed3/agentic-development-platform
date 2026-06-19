// @adg/sdk — OpenAI Agents SDK governance adapter.
//
// Builds ON the OpenAI Agents SDK (`Runner.run`, guardrails, RunHooks, model_settings); it
// does NOT replace its loop. Imports NOTHING from `@openai/agents` — it only *produces* values
// the SDK consumes, so @adg/sdk stays zero-dependency.
//
// Mapping (ADG concern -> native SDK field):
//   action gate       -> governTool(fn): a tool wrapper that classifies before executing
//   governor (P3/P12) -> adgOutputGuardrail(): trips a tripwire on a release-gate violation
//   backpressure (P8) -> adgRunHooks().onToolEnd: surfaces a failed verification command
//   hard stop (P3)    -> Runner.run({ maxTurns }) is already built in; loopCaps() reads ours
//   model orchestrator-> modelSettingsFor(): { model, reasoning: { effort } } per run

import { classifyToolUse, queryViolations } from "../core/policy-client.mjs";
import { governorDecision } from "../core/governor.mjs";
import { backpressureDecision } from "../core/backpressure.mjs";
import { selectModel, loadModelPolicy } from "../core/select-model.mjs";
import { loadLoopBudget } from "../core/backlog-read.mjs";

/**
 * Wrap a tool's execute function with the ADG action gate. A denied call throws (the SDK
 * surfaces the error to the model as an observation) rather than executing.
 */
export function governTool(toolName, executeFn, { cwd, writeScope } = {}) {
  return async (input, runContext) => {
    const probe = input && (input.command || input.file_path || input.path) ? input : { command: JSON.stringify(input || {}) };
    const d = classifyToolUse({ tool: toolName, input: probe, cwd, writeScope });
    if (d.decision === "deny") throw new Error(`[ADG] tool '${toolName}' denied: ${d.reason}`);
    return executeFn(input, runContext);
  };
}

/**
 * Output guardrail: trips when the run ended with a release-class item signed off without a
 * `live` event. Shape matches an OpenAI Agents SDK guardrail result.
 */
export function adgOutputGuardrail({ cwd = process.cwd() } = {}) {
  const budget = loadLoopBudget(cwd);
  const mode = budget?.releaseGate?.mode || "block";
  return {
    name: "adg-release-gate",
    async execute() {
      const d = governorDecision({ violations: queryViolations(cwd), caps: budget?.caps || {}, mode });
      const tripwireTriggered = d.action === "block";
      return { tripwireTriggered, outputInfo: { reason: d.reason } };
    },
  };
}

/** Run hooks: backpressure on tool completion (P8). Shape matches OpenAI Agents SDK RunHooks. */
export function adgRunHooks() {
  return {
    async onToolEnd(_context, _agent, tool, result) {
      // OpenAI tool names vary; leave toolName unset so backpressure keys on the command
      // pattern alone (a shell/test invocation), not on a "Bash" tool name.
      const command = tool?.input?.command || tool?.arguments?.command;
      const output = typeof result === "string" ? result : JSON.stringify(result || "");
      const d = backpressureDecision({ command, output });
      if (d.surface) process.stderr.write(`[ADG backpressure] ${d.reason}\n`);
    },
  };
}

/**
 * Per-run model settings from an ADG lane/risk/role.
 * @returns {{model:string, reasoning:{effort:string}}}
 */
export function modelSettingsFor({ lane, risk, role, provider = "openai" } = {}, policy = loadModelPolicy()) {
  const r = selectModel({ lane, risk, role, provider }, policy);
  return { model: r.model, reasoning: { effort: r.effort } };
}

/** The hard-stop ceiling for Runner.run({ maxTurns }). */
export function loopCaps(cwd = process.cwd()) {
  const b = loadLoopBudget(cwd);
  return { maxTurns: b?.caps?.maxTurns ?? 60 };
}
