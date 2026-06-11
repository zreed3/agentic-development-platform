import {
  backlogSummary,
  statusCounts,
  releaseGateViolations,
  auditEvents,
  evals,
  doraMetrics,
  guardrails
} from '$lib/server/data.js';

export function load() {
  const summary = backlogSummary();
  const counts = statusCounts();
  const events = auditEvents();
  const evalReport = evals();
  const dora = doraMetrics();
  const policy = guardrails();
  const violations = releaseGateViolations();

  return {
    featureCount: summary.length,
    taskCount: summary.reduce((n, f) => n + (f.task_count ?? 0), 0),
    counts,
    violations: violations.length,
    recentEvents: events.slice(0, 8),
    eventCount: events.length,
    evals: evalReport
      ? { passed: evalReport.passed, failed: evalReport.failed, total: evalReport.scenarioCount }
      : null,
    dora,
    policyVersion: policy.policyVersion ?? null,
    toolCount: Array.isArray(policy.tools) ? policy.tools.length : 0
  };
}
