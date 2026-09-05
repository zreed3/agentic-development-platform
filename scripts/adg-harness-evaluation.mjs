#!/usr/bin/env node
// Offline experiment planning and analysis only. Never invokes a model/provider.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
const defaultConfig = fileURLToPath(new URL('../config/agentic/harness-evaluation.json', import.meta.url));
export const loadConfig = () => JSON.parse(fs.readFileSync(defaultConfig, 'utf8'));
const canonical = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
const digest = value => crypto.createHash('sha256').update(canonical(value)).digest('hex');
const fail = message => { throw new Error(message); };
const metricNames = ['wallSeconds', 'inputTokens', 'outputTokens', 'cachedTokens', 'cost', 'retries', 'manualInterventions', 'falseDenials', 'gateDecisions'];
export function plan(config = loadConfig()) {
  const runs = [];
  for (const task of config.tasks) for (const model of config.models) for (const condition of Object.keys(config.conditions)) {
    for (let repeat = 1; repeat <= (config.repeatTaskIds.includes(task.id) ? config.repeats : 1); repeat++) {
      const identity = { taskId: task.id, model, condition, repeat };
      runs.push({ runId: digest({ seed: config.seed, ...identity }).slice(0, 20), ...identity, taskClass: task.class,
        taskDigest: digest(task), settings: Object.fromEntries(config.settingsSlots.map(key => [key, null])) });
    }
  }
  // Hash sorting gives a reproducible permutation without a dependency on a PRNG runtime.
  runs.sort((a, b) => digest({ seed: config.seed, id: a.runId }).localeCompare(digest({ seed: config.seed, id: b.runId })));
  return { schemaVersion: 1, status: 'not-run', configDigest: digest(config), seed: config.seed, plannedRuns: runs.length, runs };
}
function settingsValid(settings, config) {
  if (!settings || config.settingsSlots.some(k => settings[k] === undefined || settings[k] === null)) return false;
  if (['effectiveModel','reasoning','runtime','runtimeVersion','fixtureRef'].some(k => typeof settings[k] !== 'string' || !settings[k].trim())) return false;
  if (!/^[a-f0-9]{40,64}$/.test(settings.startingCommit)) return false;
  if (!Array.isArray(settings.toolAccess) || settings.toolAccess.some(t => typeof t !== 'string')) return false;
  if (!settings.permissions || typeof settings.permissions !== 'object' || Array.isArray(settings.permissions)) return false;
  if (!settings.resourceLimits || typeof settings.resourceLimits !== 'object') return false;
  return config.requiredResourceLimits.every(k => Number.isFinite(settings.resourceLimits[k]) && settings.resourceLimits[k] >= 0);
}
export function validateRecords(records, config = loadConfig()) {
  if (!Array.isArray(records)) fail('Records must be a JSON array.');
  const experiment = plan(config), expected = new Map(experiment.runs.map(r => [r.runId, r]));
  const seen = new Set(), effective = new Map(), fixtures = new Map();
  for (const record of records) {
    if (!record || typeof record !== 'object') fail('Invalid run record.');
    const run = expected.get(record.runId);
    if (!run) fail(`Unknown runId: ${record.runId}`);
    if (seen.has(record.runId)) fail(`Duplicate runId: ${record.runId}`);
    seen.add(record.runId);
    if (record.configDigest !== experiment.configDigest) fail('Record configDigest does not match frozen experiment.');
    for (const key of ['taskId','model','condition','repeat','taskDigest']) if (record[key] !== run[key]) fail(`Inconsistent ${key} for ${record.runId}`);
    if (!['completed','failed','incomplete'].includes(record.status)) fail('Run status must be completed, failed or incomplete.');
    if (!settingsValid(record.settings, config)) fail(`Missing or invalid effective settings for ${record.runId}`);
    const key = `${run.model}/${run.taskId}`;
    const fingerprint = canonical(record.settings);
    if (effective.has(key) && effective.get(key) !== fingerprint) fail(`Inconsistent effective settings across conditions/repeats: ${key}`);
    effective.set(key, fingerprint);
    const fixture = canonical({ commit: record.settings.startingCommit, fixture: record.settings.fixtureRef });
    if (fixtures.has(run.taskId) && fixtures.get(run.taskId) !== fixture) fail(`Inconsistent task fixture across models: ${run.taskId}`);
    fixtures.set(run.taskId, fixture);
    if (typeof record.evidenceRef !== 'string' || !record.evidenceRef.trim()) fail('Every attempt requires an evidenceRef, including failures.');
    if (record.status !== 'completed' && (typeof record.failureReason !== 'string' || !record.failureReason.trim())) fail('Failed/incomplete attempts require failureReason.');
    const metrics = record.metrics ?? {};
    for (const name of metricNames) if (metrics[name] != null && (!Number.isFinite(metrics[name]) || metrics[name] < 0)) fail(`Invalid metric: ${name}`);
    for (const name of metricNames.filter(n => !['wallSeconds','cost'].includes(n))) if (metrics[name] != null && !Number.isInteger(metrics[name])) fail(`Metric must be an integer: ${name}`);
    if (metrics.falseDenials != null && metrics.gateDecisions != null && metrics.falseDenials > metrics.gateDecisions) fail('falseDenials exceeds gateDecisions.');
    if (metrics.cost != null && metrics.currency !== 'USD') fail('Measured cost requires currency USD; perform and document conversion upstream.');
    if (['inputTokens','outputTokens','cachedTokens','cost'].some(k => metrics[k] != null) && (metrics.usageScope !== 'all-agents-and-evaluators' || typeof metrics.usageSource !== 'string' || !metrics.usageSource.trim())) fail('Usage must include all agents/evaluators and identify its measured source.');
    const grade = record.grade;
    if (record.status === 'completed' && !grade) fail('Completed runs require blinded grading.');
    if (grade) {
      const task = config.tasks.find(t => t.id === run.taskId);
      if (grade.blinded !== true || typeof grade.graderId !== 'string' || !grade.graderId.trim() || typeof grade.evidenceRef !== 'string' || !grade.evidenceRef.trim()) fail('Grade requires blinded grader and evidence.');
      if (typeof grade.criticalFailure !== 'boolean') fail('Grade requires criticalFailure boolean.');
      for (const dimension of config.rubric.dimensions) if (![0,1,2].includes(grade.dimensions?.[dimension])) fail(`Invalid grade dimension: ${dimension}`);
      for (const [field, criteria] of [['acceptance',task.acceptanceCriteria], ['negative',task.negativeCriteria]]) if (!Array.isArray(grade[field]) || grade[field].length !== criteria.length || grade[field].some(v => typeof v !== 'boolean')) fail(`Grade must cover every ${field} criterion.`);
    }
  }
  return { valid: true, records: records.length, planned: experiment.plannedRuns, notRun: experiment.plannedRuns - records.length };
}
const accepted = record => Boolean(record?.status === 'completed' && record.grade && !record.grade.criticalFailure && Object.values(record.grade.dimensions).every(v => v === 2) && record.grade.acceptance.every(Boolean) && record.grade.negative.every(Boolean));
const mean = values => values.length ? values.reduce((a,b) => a+b, 0) / values.length : null;
function interval(values, z) {
  if (values.length < 2) return null;
  const avg = mean(values), variance = values.reduce((sum,v) => sum + (v-avg)**2,0)/(values.length-1), margin = z * Math.sqrt(variance / values.length);
  return { low: avg-margin, high: avg+margin, method: 'normal-approximation over task means; exploratory pilot, not rare-event assurance' };
}
export function report(records, config = loadConfig()) {
  validateRecords(records, config);
  const experiment = plan(config), byId = new Map(records.map(r => [r.runId, r]));
  const groups = [], comparisons = [];
  const classes = ['all', ...new Set(config.tasks.map(t => t.class))];
  for (const model of config.models) for (const taskClass of classes) {
    const selection = experiment.runs.filter(r => r.model === model && (taskClass === 'all' || r.taskClass === taskClass));
    for (const condition of Object.keys(config.conditions)) {
      const slots = selection.filter(r => r.condition === condition), observed = slots.map(r => byId.get(r.runId)).filter(Boolean);
      const metrics = Object.fromEntries(metricNames.map(name => { const values = observed.map(r => r.metrics?.[name]).filter(v => v != null); return [name, { mean: mean(values), measuredRuns: values.length, missingRuns: slots.length-values.length }]; }));
      const count = observed.filter(accepted).length;
      groups.push({ model, taskClass, condition, planned: slots.length, attempted: observed.length, notRun: slots.length-observed.length, completed: observed.filter(r => r.status === 'completed').length, failed: observed.filter(r => r.status === 'failed').length, incomplete: observed.filter(r => r.status === 'incomplete').length, accepted: count, acceptedRateAttempted: observed.length ? count/observed.length : null, acceptedRatePlanned: observed.length ? count/slots.length : null, criticalFailures: observed.filter(r => r.grade?.criticalFailure).length, metrics });
    }
    for (const condition of Object.keys(config.conditions).filter(c => c !== 'native')) {
      const baseline = selection.filter(r => r.condition === 'native');
      const pairs = baseline.map(base => ({ base: byId.get(base.runId), candidate: byId.get(selection.find(r => r.taskId === base.taskId && r.repeat === base.repeat && r.condition === condition).runId), taskId: base.taskId })).filter(p => p.base && p.candidate);
      // Collapse repeats within each task before estimating uncertainty: repeats are not independent tasks.
      const taskMeans = extractor => [...new Set(pairs.map(p => p.taskId))].map(id => mean(pairs.filter(p => p.taskId === id).map(extractor).filter(v => v != null))).filter(v => v != null);
      const quality = taskMeans(p => Number(accepted(p.candidate))-Number(accepted(p.base)));
      const pairedMetrics = Object.fromEntries(metricNames.map(name => { const values = taskMeans(p => p.base.metrics?.[name] != null && p.candidate.metrics?.[name] != null ? p.candidate.metrics[name]-p.base.metrics[name] : null); return [name, { delta: mean(values), taskCount: values.length, interval: interval(values,config.thresholds.confidenceZ) }]; }));
      const qualityInterval = interval(quality, config.thresholds.confidenceZ);
      const complete = pairs.length === baseline.length;
      const criticalRegressions = pairs.filter(p => p.candidate.grade?.criticalFailure && !p.base.grade?.criticalFailure).length;
      const observedCriticalFailures = selection.filter(r => ['native', condition].includes(r.condition)).map(r => byId.get(r.runId)).filter(r => r?.grade?.criticalFailure).length;
      const ungraded = pairs.some(p => !p.base.grade || !p.candidate.grade);
      let recommendation = 'inconclusive';
      if (criticalRegressions > config.thresholds.criticalRegressionTolerance) recommendation = 'blocked-critical-regression';
      else if (observedCriticalFailures) recommendation = 'blocked-critical-failure';
      else if (!pairs.length) recommendation = 'not-run';
      else if (complete && !ungraded && qualityInterval) {
        if (qualityInterval.high < -config.thresholds.qualityTolerance) recommendation = 'candidate-hurts-quality';
        else if (qualityInterval.low > config.thresholds.qualityTolerance) recommendation = 'candidate-quality-benefit-signal';
        else if (qualityInterval.low >= -config.thresholds.qualityTolerance && qualityInterval.high <= config.thresholds.qualityTolerance) recommendation = 'prefer-simpler-native-on-quality';
      }
      // Efficiency benefits need complete paired measurements, accepted-quality noninferiority and no critical failures.
      const efficiency = ['wallSeconds','cost'].map(name => {
        if (!complete || pairs.some(p => p.base.metrics?.[name] == null || p.candidate.metrics?.[name] == null)) return { metric: name, relativeGain: null, meetsThreshold: null };
        const base = mean(pairs.map(p => p.base.metrics[name])), candidate = mean(pairs.map(p => p.candidate.metrics[name]));
        const gain = base > 0 ? (base-candidate)/base : null;
        return { metric: name, relativeGain: gain, meetsThreshold: gain == null ? null : gain >= config.thresholds.minimumEfficiencyGain };
      });
      if (recommendation === 'prefer-simpler-native-on-quality' && efficiency.some(e => e.meetsThreshold) && !pairs.some(p => p.candidate.grade?.criticalFailure || p.base.grade?.criticalFailure)) recommendation = 'candidate-efficiency-benefit-signal';
      comparisons.push({ model, taskClass, candidate: condition, baseline: 'native', plannedPairs: baseline.length, observedPairs: pairs.length, taskCount: quality.length, acceptedRateDelta: mean(quality), qualityInterval, criticalRegressions, observedCriticalFailures, recommendation, efficiency, metrics: pairedMetrics });
    }
  }
  return { schemaVersion: 1, configDigest: experiment.configDigest, status: records.length ? records.length === experiment.plannedRuns ? 'recorded' : 'partial' : 'not-run', planned: experiment.plannedRuns, recorded: records.length, notRun: experiment.plannedRuns-records.length, caveat: 'Offline pilot analysis. Grade claims and evidence references require independent review. Failures/incomplete attempts remain in denominators; missing observations are not outcomes. No model superiority or retirement conclusion follows automatically.', groups, comparisons };
}
export function markdown(result) {
  return `# Harness evaluation\n\nStatus: **${result.status}**. Recorded ${result.recorded}/${result.planned}; not run ${result.notRun}.\n\n${result.caveat}\n\n| Model | Class | Candidate vs native | Pairs | Accepted delta | Recommendation |\n|---|---|---|---|---|---|\n` + result.comparisons.map(r => `| ${r.model} | ${r.taskClass} | ${r.candidate} | ${r.observedPairs}/${r.plannedPairs} | ${r.acceptedRateDelta == null ? 'unavailable' : r.acceptedRateDelta.toFixed(3)} | ${r.recommendation} |`).join('\n')+'\n';
}
function main() {
  const [command = 'plan', ...args] = process.argv.slice(2);
  const value = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i+1]; };
  if (args.some((arg,i) => i % 2 === 0 && !['--records','--format','--out'].includes(arg)) || args.length % 2) fail('Usage: adg-harness-evaluation.mjs plan|validate|report [--records runs.json] [--format json|md] [--out path]');
  const format = value('--format') ?? 'json';
  if (!['json','md'].includes(format) || (format === 'md' && command !== 'report')) fail('Markdown is supported only for report.');
  const records = value('--records') ? JSON.parse(fs.readFileSync(value('--records'),'utf8')) : [];
  const result = command === 'plan' ? plan() : command === 'validate' ? validateRecords(records) : command === 'report' ? report(records) : fail(`Unknown command: ${command}`);
  const output = format === 'md' ? markdown(result) : JSON.stringify(result,null,2)+'\n';
  if (value('--out')) fs.writeFileSync(value('--out'),output,{flag:'wx'}); else process.stdout.write(output);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
