import { guardrails } from '$lib/server/data.js';

export function load() {
  const policy = guardrails();
  return {
    policyVersion: policy.policyVersion ?? null,
    defaultDecision: policy.defaultDecision ?? 'deny',
    riskClasses: policy.riskClasses ?? {},
    tools: policy.tools ?? []
  };
}
