import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'adg-preservation-'));
const host = path.join(parent, 'host');
fs.mkdirSync(host);
const file = r => path.join(host, r);
const read = r => JSON.parse(fs.readFileSync(file(r), 'utf8'));
const write = (r, value) => fs.writeFileSync(file(r), JSON.stringify(value, null, 2) + '\n');
function run(extra = [], expected = 0) {
  const result = spawnSync(process.execPath, [path.join(root, 'scripts/adg-install.mjs'), 'update', '--target', host, '--client', 'claude', '--format', 'json', ...extra], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, expected, result.stderr || result.stdout);
  return expected === 0 ? JSON.parse(result.stdout) : result.stderr;
}
function snapshot(dir = host) {
  return Object.fromEntries(fs.readdirSync(dir, { recursive: true }).sort().filter(r => fs.lstatSync(path.join(dir,r)).isFile()).map(r => [r, fs.readFileSync(path.join(dir,r), 'utf8')]));
}
try {
  write('package.json', { name: 'host', scripts: { test: 'host-test' } });
  fs.writeFileSync(file('AGENTS.md'), '# Host guidance\n');
  fs.writeFileSync(file('CLAUDE.md'), '# Unique context\nKeep the accounting invariant.\n');
  fs.mkdirSync(file('.claude'));
  write('.claude/settings.json', { custom: { keep: true }, hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo host-stop' }] }] }, permissions: { allow: ['Bash(host-test)'], deny: ['Read(private-host-file)'] } });
  const first = run();
  assert.equal(fs.readFileSync(file(first.preservedClaudeNotes), 'utf8'), '# Unique context\nKeep the accounting invariant.\n');
  assert.equal(read('.claude/settings.json').custom.keep, true);
  assert.deepEqual(read('.claude/settings.json').permissions.allow, ['Bash(host-test)']);
  assert.ok(read('.claude/settings.json').permissions.deny.includes('Read(private-host-file)'));
  assert.equal(read('.claude/settings.json').hooks.Stop[0].hooks[0].command, 'echo host-stop');
  assert.equal(read('package.json').scripts.test, 'host-test');
  assert.equal(first.version, JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version);

  const policy = read('config/agentic/guardrails.json');
  policy.defaultDecision = 'allow';
  policy.riskClasses['code-change'].requiresConfirmation = true;
  policy.tools.push({ name: 'host.read', riskClass: 'read-only', allowed: true, mode: 'read', requiredEvidence: [] });
  policy.tools[0].allowed = false;
  policy.redactFields.push('hostPrivateField');
  policy.controls.definitions.destructiveDeny.enabled = false;
  policy.controls.definitions.destructiveDeny.alwaysOn = false;
  policy.controls.definitions.assetLint.config.hostSetting = 'keep';
  write('config/agentic/guardrails.json', policy);
  run();
  const merged = read('config/agentic/guardrails.json');
  assert.equal(merged.defaultDecision, 'deny');
  assert.equal(merged.riskClasses['code-change'].requiresConfirmation, true);
  assert.equal(merged.tools.find(t => t.name === 'host.read').allowed, true);
  assert.equal(merged.tools[0].allowed, false);
  assert.ok(merged.redactFields.includes('hostPrivateField'));
  assert.equal(merged.controls.definitions.destructiveDeny.enabled, true);
  assert.equal(merged.controls.definitions.destructiveDeny.alwaysOn, true);
  assert.equal(merged.controls.definitions.assetLint.config.hostSetting, 'keep');
  const settingsBefore = fs.readFileSync(file('.claude/settings.json'), 'utf8');
  run();
  assert.equal(fs.readFileSync(file('.claude/settings.json'), 'utf8'), settingsBefore);
  const beforeDryRun = snapshot();
  run(['--dry-run']);
  assert.deepEqual(snapshot(), beforeDryRun);

  const classifierPath = 'scripts/adg-work-classify.mjs';
  const original = fs.readFileSync(file(classifierPath), 'utf8');
  fs.appendFileSync(file(classifierPath), '\n// host customization\n');
  const beforeConflict = snapshot();
  assert.match(run([], 1), /no files changed/);
  assert.deepEqual(snapshot(), beforeConflict);
  const forced = run(['--force']);
  assert.ok(forced.backups.some(b => b.target === classifierPath));
  assert.equal(fs.readFileSync(file(classifierPath), 'utf8'), original);

  const savedPolicy = fs.readFileSync(file('config/agentic/guardrails.json'), 'utf8');
  fs.writeFileSync(file('config/agentic/guardrails.json'), '{bad json');
  const malformedBefore = snapshot();
  assert.match(run([], 1), /malformed/);
  assert.deepEqual(snapshot(), malformedBefore);
  fs.writeFileSync(file('config/agentic/guardrails.json'), savedPolicy);

  const unverifiedState = read('config/agentic/adg-install-state.json');
  unverifiedState.files.push({ target: 'important-notes.md' });
  fs.writeFileSync(file('important-notes.md'), 'Preserve unverified ownership.\n');
  write('config/agentic/adg-install-state.json', unverifiedState);
  const unverified = run();
  assert.ok(unverified.pruned.some(f => f.target === 'important-notes.md' && f.status === 'stale-unverified'));
  assert.equal(fs.readFileSync(file('important-notes.md'), 'utf8'), 'Preserve unverified ownership.\n');
  const state = read('config/agentic/adg-install-state.json');
  const unsafe = structuredClone(state);
  unsafe.files.push({ target: '../outside.md' });
  write('config/agentic/adg-install-state.json', unsafe);
  const traversalBefore = snapshot();
  assert.match(run([], 1), /Unsafe managed path/);
  assert.deepEqual(snapshot(), traversalBefore);
  write('config/agentic/adg-install-state.json', state);

  const savedPackage = fs.readFileSync(file('package.json'), 'utf8');
  for (const badPackage of [[], { scripts: 'bad' }, { scripts: null }]) {
    write('package.json', badPackage);
    const before = snapshot();
    assert.match(run([], 1), /object-valued scripts/);
    assert.deepEqual(snapshot(), before);
  }
  fs.writeFileSync(file('package.json'), savedPackage);
  const savedSettings = fs.readFileSync(file('.claude/settings.json'), 'utf8');
  write('.claude/settings.json', { ...JSON.parse(savedSettings), disableAllHooks: true });
  const disabledBefore = snapshot();
  assert.match(run([], 1), /disableAllHooks/);
  assert.deepEqual(snapshot(), disabledBefore);
  fs.writeFileSync(file('.claude/settings.json'), savedSettings);
  const outside = path.join(parent, 'outside.json');
  fs.writeFileSync(outside, savedSettings);
  fs.unlinkSync(file('.claude/settings.json'));
  fs.symlinkSync(outside, file('.claude/settings.json'));
  assert.match(run([], 1), /symlink destination/);
  assert.equal(fs.readFileSync(outside, 'utf8'), savedSettings);
  fs.unlinkSync(file('.claude/settings.json'));
  fs.writeFileSync(file('.claude/settings.json'), savedSettings);
  run(['--client', 'base']);
  assert.equal(read('.claude/settings.json').custom.keep, true);
  assert.equal(read('.claude/settings.json').hooks.Stop[0].hooks[0].command, 'echo host-stop');
  assert.equal(read('.claude/settings.json').hooks.PreToolUse, undefined);
  assert.ok(!fs.existsSync(file('scripts/adg-guardrail-hook.mjs')));
  console.log('Installer preservation: settings, notes, policy floor, custom tools, conflicts, dry-run, malformed input, traversal and symlink checks passed');
} finally {
  fs.rmSync(parent, { recursive: true, force: true });
}
