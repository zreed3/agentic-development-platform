import assert from 'node:assert/strict';
import { loadConfig, plan, validateRecords, report, markdown } from '../../scripts/adg-harness-evaluation.mjs';
const config = loadConfig(), matrix = plan(config);
assert.equal(config.tasks.length, 20);
assert.equal(matrix.runs.length, 180);
assert.deepEqual(plan(config), matrix);
assert.notDeepEqual(plan({...config,seed:2}).runs.map(r => r.taskId), matrix.runs.map(r => r.taskId));
function record(run, patch = {}) {
  return { ...run, configDigest: matrix.configDigest, status:'completed', evidenceRef:'fixture://test/trace',
    settings:{ effectiveModel:run.model+'-effective-test',reasoning:'high',runtime:'test-runtime',runtimeVersion:'1',toolAccess:['shell'],permissions:{filesystem:'isolated-fixture'},resourceLimits:{wallSeconds:900,inputTokens:100000,outputTokens:20000,maxSubagents:4},startingCommit:'a'.repeat(40),fixtureRef:'fixture://'+run.taskId },
    grade:{blinded:true,graderId:'test-grader',evidenceRef:'fixture://test/checks',criticalFailure:false,dimensions:Object.fromEntries(config.rubric.dimensions.map(k=>[k,2])),acceptance:[true],negative:[true]}, ...patch };
}
const empty = report([]);
assert.equal(empty.status,'not-run');
assert.ok(empty.groups.every(g=>g.acceptedRateAttempted===null && g.metrics.inputTokens.mean===null));
assert.ok(empty.comparisons.every(c=>c.recommendation==='not-run' && c.acceptedRateDelta===null));
assert.match(markdown(empty), /not-run/);
assert.ok(markdown(empty).includes('\n\nStatus:'));
assert.ok(!markdown(empty).includes(String.raw`\n`));
const run = record(matrix.runs[0]);
assert.equal(validateRecords([run]).valid,true);
let result = report([run]);
assert.equal(result.status,'partial');
assert.equal(result.groups.find(g=>g.model===run.model && g.condition===run.condition && g.taskClass==='all').metrics.inputTokens.mean,null);
assert.throws(()=>validateRecords([run,run]),/Duplicate/);
assert.throws(()=>validateRecords([{...run,taskId:'T999'}]),/Inconsistent/);
assert.throws(()=>validateRecords([{...run,configDigest:'stale'}]),/configDigest/);
assert.throws(()=>validateRecords([{...run,settings:{...run.settings,effectiveModel:null}}]),/settings/);
assert.throws(()=>validateRecords([{...run,metrics:{inputTokens:100}}]),/Usage/);
assert.throws(()=>validateRecords([{...run,metrics:{inputTokens:1.5}}]),/integer/);
assert.throws(()=>validateRecords([{...run,metrics:{falseDenials:2,gateDecisions:1}}]),/exceeds/);
const sibling = matrix.runs.find(r=>r.model===run.model && r.taskId===run.taskId && r.runId!==run.runId);
assert.throws(()=>validateRecords([run,record(sibling,{settings:{...run.settings,reasoning:'low'}})]),/Inconsistent effective/);
const otherModel = matrix.runs.find(r=>r.model!==run.model && r.taskId===run.taskId);
const wrongFixture = record(otherModel); wrongFixture.settings.startingCommit='b'.repeat(40);
assert.throws(()=>validateRecords([run,wrongFixture]),/fixture/);
const sameGroup = matrix.runs.filter(r=>r.model===run.model && r.condition===run.condition && r.runId!==run.runId);
result=report([run,record(sameGroup[0],{status:'failed',failureReason:'test failure',grade:null}),record(sameGroup[1],{status:'incomplete',failureReason:'time limit',grade:null})]);
const group = result.groups.find(g=>g.model===run.model&&g.condition===run.condition&&g.taskClass==='all');
assert.equal(group.attempted,3);assert.equal(group.failed,1);assert.equal(group.incomplete,1);assert.equal(group.acceptedRateAttempted,1/3);assert.equal(group.acceptedRatePlanned,1/30);
const all=matrix.runs.map(r=>record(r,{metrics:{wallSeconds:r.condition==='native'?100:50}}));
result=report(all);
assert.equal(result.status,'recorded');
assert.ok(result.comparisons.every(c=>c.recommendation==='candidate-efficiency-benefit-signal'));
assert.ok(result.comparisons.every(c=>c.metrics.inputTokens.delta===null && c.efficiency.find(e=>e.metric==='cost').relativeGain===null));
const critical = all.find(r=>r.model==='astra'&&r.condition==='minimal'&&r.taskId==='T17');
critical.grade.criticalFailure=true; critical.grade.dimensions.security=0; critical.grade.negative=[false];
result=report(all);
assert.equal(result.comparisons.find(c=>c.model==='astra'&&c.taskClass==='all'&&c.candidate==='minimal').recommendation,'blocked-critical-regression');
assert.equal(result.comparisons.find(c=>c.model==='astra'&&c.taskClass==='boundary'&&c.candidate==='minimal').recommendation,'blocked-critical-regression');

const loneCritical = record(matrix.runs.find(r=>r.model==='astra'&&r.condition==='minimal'&&r.taskId==='T17'));
loneCritical.grade.criticalFailure=true;
assert.equal(report([loneCritical]).comparisons.find(c=>c.model==='astra'&&c.taskClass==='all'&&c.candidate==='minimal').recommendation,'blocked-critical-failure');
const nativeCritical = all.find(r=>r.model==='astra'&&r.condition==='native'&&r.taskId==='T17'&&r.repeat===critical.repeat);
nativeCritical.grade.criticalFailure=true;
assert.equal(report(all).comparisons.find(c=>c.model==='astra'&&c.taskClass==='all'&&c.candidate==='minimal').recommendation,'blocked-critical-failure');
console.log('Harness evaluation tests passed: deterministic 180-run plan; empty/missing usage; failed/incomplete denominators; invalid/duplicate/settings rejection; critical regression blocks benefit.');
