import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { retire } from '../../scripts/adg-retire.mjs';
const roots = [];
const digest = text => createHash('sha256').update(text).digest('hex');
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'adg-retire-test-')); roots.push(root);
  const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
  write('scripts/adg-doctor.mjs', '// customized doctor\n');
  write('scripts/adg-work-classify.mjs', '// original classifier\n');
  write('.claude/settings.json', JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'node "${CLAUDE_PROJECT_DIR}/scripts/adg-guardrail-hook.mjs"' }, { type: 'command', command: 'native-security-check' }] }] }, permissions: { deny: ['Read(.env)', 'Bash(rm -rf *)'] }, model: 'native' }));
  write('AGENTS.md', '# Native\nRun pnpm test.\nADG: run adg:doctor.\n');
  write('data/audit/audit-log.jsonl', 'original audit bytes\n');
  write('package.json', JSON.stringify({ scripts: { 'adg:doctor': 'node scripts/adg-doctor.mjs', 'adg:guard': 'custom-local-check', verify: 'pnpm typecheck && pnpm test && npm run adg:doctor -- --target .', test: 'native-test', setup: 'node _adg-v2/scripts/backlog-db.mjs setup', 'adg:audit:record': 'node scripts/record-audit.mjs', 'native:node': 'node scripts/native-security.mjs' } }));
  const state = { schemaVersion: 1, system: 'Proofline', files: [ { target: 'scripts/adg-doctor.mjs', sha256: digest('original') }, { target: 'scripts/adg-work-classify.mjs', sha256: digest('// original classifier\n') }, { target: '.claude/settings.json', sha256: digest('original settings') } ], packageScripts: { 'adg:doctor': 'node scripts/adg-doctor.mjs', 'adg:guard': 'node scripts/adg-work-classify.mjs guard' } };
  write('config/agentic/adg-install-state.json', JSON.stringify(state));
  return { root, write, state };
}
try {
  const a = fixture();
  const before = fs.readFileSync(path.join(a.root, 'package.json'));
  const dry = retire({ target: a.root });
  assert.equal(dry.status, 'ready'); assert.equal(dry.applied, false); assert.deepEqual(fs.readFileSync(path.join(a.root, 'package.json')), before); assert.equal(fs.existsSync(path.join(a.root, 'docs')), false);
  const applied = retire({ target: a.root, apply: true });
  assert.equal(applied.status, 'retired');
  assert.equal(fs.readFileSync(path.join(a.root, applied.archive, 'scripts/adg-doctor.mjs'), 'utf8'), '// customized doctor\n');
  assert.equal(fs.existsSync(path.join(a.root, 'scripts/adg-doctor.mjs')), false);
  const pkg = JSON.parse(fs.readFileSync(path.join(a.root, 'package.json')));
  assert.equal(pkg.scripts.verify, 'pnpm typecheck && pnpm test'); assert.equal(pkg.scripts['adg:guard'], 'custom-local-check'); assert.equal(pkg.scripts.test, 'native-test'); assert.equal(pkg.scripts.setup, undefined); assert.equal(pkg.scripts['adg:audit:record'], undefined); assert.equal(pkg.scripts['native:node'], 'node scripts/native-security.mjs');
  const settings = JSON.parse(fs.readFileSync(path.join(a.root, '.claude/settings.json')));
  assert.equal(settings.hooks.PreToolUse[0].hooks.length, 1); assert.equal(settings.hooks.PreToolUse[0].hooks[0].command, 'native-security-check'); assert.deepEqual(settings.permissions.deny, ['Read(.env)', 'Bash(rm -rf *)']);
  assert.equal(fs.readFileSync(path.join(a.root, 'data/audit/audit-log.jsonl'), 'utf8'), 'original audit bytes\n');
  assert.match(fs.readFileSync(path.join(a.root, 'AGENTS.md'), 'utf8'), /Native\nRun pnpm test/);
  assert.equal(retire({ target: a.root, apply: true }).status, 'not-installed');
  for (const target of ['../escape', '.github/workflows/security.yml', 'scripts/../../escape']) {
    const b = fixture(); b.state.files[0].target = target; b.write('config/agentic/adg-install-state.json', JSON.stringify(b.state));
    assert.throws(() => retire({ target: b.root, apply: true }), /Invalid|Unsafe/); assert.equal(fs.existsSync(path.join(b.root, 'docs')), false);
  }
  const c = fixture(); c.write('package.json', JSON.stringify({ scripts: { ...c.state.packageScripts, verify: 'native-security && npm run adg:doctor' } }));
  assert.equal(retire({ target: c.root, apply: true }).status, 'blocked'); assert.equal(fs.existsSync(path.join(c.root, 'docs')), false);
  const d = fixture(); fs.symlinkSync(os.tmpdir(), path.join(d.root, 'docs')); assert.throws(() => retire({ target: d.root, apply: true }), /Symlink/);
  const e = fixture(); e.write('config/agentic/adg-install-state.json', '{broken'); assert.throws(() => retire({ target: e.root, apply: true })); assert.equal(fs.existsSync(path.join(e.root, 'docs')), false);
  console.log('PASS retirement: dry-run, original snapshots, custom assets, native scripts/security, exact chain, ambiguity, traversal, symlinks, malformed state, idempotence');
} finally { for (const root of roots) fs.rmSync(root, { recursive: true, force: true }); }
