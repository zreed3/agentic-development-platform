import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
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
  write('data/audit/audit-log.jsonl', '{"summary":"original audit bytes"}\n');
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
  assert.equal(fs.readFileSync(path.join(a.root, 'data/audit/audit-log.jsonl'), 'utf8'), '{"summary":"original audit bytes"}\n');
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
  const f = fixture();
  const cli = spawnSync(process.execPath, [fileURLToPath(new URL('../../scripts/adg-retire.mjs', import.meta.url)), '--target', f.root, '--apply', '--dry-run'], { encoding: 'utf8' });
  assert.equal(cli.status, 1); assert.match(cli.stderr, /conflict/); assert.equal(fs.existsSync(path.join(f.root, 'docs')), false);
  for (const [file, text] of [['.github/workflows/check.yml', 'run: node scripts/adg-doctor.mjs'], ['.husky/pre-push', 'npm run adg:doctor'], ['.codex/config.toml', 'command = "pnpm run adg:doctor"']]) {
    const g = fixture(); g.write(file, text);
    const result = retire({ target: g.root, apply: true });
    assert.equal(result.status, 'blocked'); assert.ok(result.blockers.some(x => x.includes('Integration'))); assert.equal(fs.existsSync(path.join(g.root, 'docs')), false);
  }
  const h = fixture(); h.write('.github/workflows/check.yml', 'run: pnpm test');
  assert.equal(retire({ target: h.root }).status, 'ready');
  const invalidContext = fixture(); invalidContext.write('data/audit/audit-log.jsonl', 'malformed audit input\n');
  assert.equal(retire({ target: invalidContext.root }).status, 'ready');
  assert.equal(fs.existsSync(path.join(invalidContext.root, 'docs')), false);
  assert.throws(() => retire({ target: invalidContext.root, apply: true }), /Malformed JSON/);
  assert.ok(fs.existsSync(path.join(invalidContext.root, 'scripts/adg-doctor.mjs')));
  assert.ok(fs.existsSync(path.join(invalidContext.root, 'config/agentic/adg-install-state.json')));
  assert.equal(fs.existsSync(path.join(invalidContext.root, 'docs')), false);
  const unknownContext = fixture();
  const unknownDb = spawnSync('sqlite3', [path.join(unknownContext.root, 'data/backlog.sqlite'), 'CREATE TABLE customer_notes(id TEXT);']);
  assert.equal(unknownDb.status, 0);
  assert.throws(() => retire({ target: unknownContext.root, apply: true }), /Unknown tables/);
  assert.ok(fs.existsSync(path.join(unknownContext.root, 'scripts/adg-doctor.mjs')));
  assert.equal(fs.existsSync(path.join(unknownContext.root, 'docs')), false);
  const concurrent = fixture(), originalWrite = fs.writeFileSync;
  let editedDuringPreservation = false;
  try {
    fs.writeFileSync = function (filename, ...args) {
      const result = originalWrite.call(this, filename, ...args);
      if (!editedDuringPreservation && path.basename(String(filename)).startsWith('manifest-')) {
        editedDuringPreservation = true;
        originalWrite(path.join(concurrent.root, 'scripts/adg-doctor.mjs'), '// concurrent user edit\n');
      }
      return result;
    };
    assert.throws(() => retire({ target: concurrent.root, apply: true }), /Changed during preservation/);
  } finally { fs.writeFileSync = originalWrite; }
  assert.equal(editedDuringPreservation, true);
  assert.equal(fs.readFileSync(path.join(concurrent.root, 'scripts/adg-doctor.mjs'), 'utf8'), '// concurrent user edit\n');
  assert.ok(fs.existsSync(path.join(concurrent.root, 'config/agentic/adg-install-state.json')));
  console.log('PASS retirement: dry-run, original snapshots, custom assets, native scripts/security, exact chain, ambiguity, traversal, symlinks, malformed state, idempotence');
} finally { for (const root of roots) fs.rmSync(root, { recursive: true, force: true }); }
