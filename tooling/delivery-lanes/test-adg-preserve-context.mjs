import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { preserveContext } from '../../scripts/adg-preserve-context.mjs';
const roots = [];
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'adg-preserve-test-')); roots.push(root);
  const write = (rel, text) => { const filename = path.join(root, rel); fs.mkdirSync(path.dirname(filename), { recursive: true }); fs.writeFileSync(filename, text); };
  write('AGENTS.md', '# Native\n\nImportant instruction.\n');
  write('data/audit/audit-log.jsonl', '{"id":"a1","summary":"first"}\n{"id":"a1","summary":"first"}\n');
  return { root, write };
}
function sql(root, text) {
  const db = path.join(root, 'data/backlog.sqlite');
  const run = spawnSync('sqlite3', [db], { input: text, encoding: 'utf8' }); assert.equal(run.status, 0, run.stderr); return db;
}
try {
  const a = fixture();
  const db = sql(a.root, 'CREATE TABLE feature_items(id TEXT, title TEXT); WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x < 205) INSERT INTO feature_items SELECT printf("ITEM-%03d",x),"Preserve me" FROM n;');
  const before = fs.readFileSync(db), audit = fs.readFileSync(path.join(a.root, 'data/audit/audit-log.jsonl'));
  const first = preserveContext({ target: a.root });
  assert.equal(first.counts['data/backlog.sqlite'].feature_items, 205); assert.equal(first.counts['data/audit/audit-log.jsonl'].records, 2);
  const manifest = JSON.parse(fs.readFileSync(path.join(first.output, first.manifest)));
  const dbArtifact = manifest.artifacts.find(x => x.kind === 'sqlite');
  const markdown = fs.readFileSync(path.join(first.output, dbArtifact.markdown), 'utf8');
  assert.match(markdown, /ITEM-001/); assert.match(markdown, /ITEM-205/); assert.match(markdown, /data\/backlog.sqlite/);
  assert.deepEqual(fs.readFileSync(db), before); assert.deepEqual(fs.readFileSync(path.join(a.root, 'data/audit/audit-log.jsonl')), audit);
  assert.deepEqual(preserveContext({ target: a.root }), first);
  fs.appendFileSync(path.join(first.output, dbArtifact.markdown), 'Human edit\n');
  assert.throws(() => preserveContext({ target: a.root }), /overwrite modified/);
  assert.match(fs.readFileSync(path.join(first.output, dbArtifact.markdown), 'utf8'), /Human edit/);
  const b = fixture(); sql(b.root, 'CREATE TABLE customer_notes(id TEXT); INSERT INTO customer_notes VALUES("private");');
  assert.throws(() => preserveContext({ target: b.root }), /Unknown tables/); assert.equal(fs.existsSync(path.join(b.root, 'docs')), false);
  const c = fixture(); c.write('config/agentic/elicitation.json', '{broken');
  assert.throws(() => preserveContext({ target: c.root })); assert.equal(fs.existsSync(path.join(c.root, 'docs')), false);
  const d = fixture(); fs.symlinkSync(a.root, path.join(d.root, 'docs'));
  assert.throws(() => preserveContext({ target: d.root }), /Symlink/);
  const e = fixture(); fs.unlinkSync(path.join(e.root, 'AGENTS.md')); fs.symlinkSync(path.join(a.root, 'AGENTS.md'), path.join(e.root, 'AGENTS.md'));
  assert.throws(() => preserveContext({ target: e.root }), /Symlink/); assert.equal(fs.existsSync(path.join(e.root, 'docs')), false);
  const f = fixture(); f.write('data/audit/audit-log.jsonl', '{"id":1}\ninvalid\n');
  assert.throws(() => preserveContext({ target: f.root }), /Malformed JSON/); assert.equal(fs.existsSync(path.join(f.root, 'docs')), false);
  const g = fixture(), walDb = path.join(g.root, 'data/backlog.sqlite');
  const writer = spawn('sqlite3', [walDb], { stdio: ['pipe', 'pipe', 'pipe'] });
  try {
    const ready = new Promise((resolve, reject) => { let output = ''; writer.stdout.on('data', data => { output += data; if (output.includes('READY')) resolve(); }); writer.on('error', reject); writer.on('exit', code => reject(new Error(`Writer exited early: ${code}`))); });
    writer.stdin.write('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE features(id TEXT); INSERT INTO features VALUES("WAL-ONLY");\n.print READY\n');
    await ready;
    assert.ok(fs.statSync(walDb + '-wal').size > 0);
    const walBefore = fs.readFileSync(walDb + '-wal'), databaseBefore = fs.readFileSync(walDb);
    const preserved = preserveContext({ target: g.root });
    assert.equal(preserved.counts['data/backlog.sqlite'].features, 1);
    assert.deepEqual(fs.readFileSync(walDb), databaseBefore); assert.deepEqual(fs.readFileSync(walDb + '-wal'), walBefore);
    const meta = JSON.parse(fs.readFileSync(path.join(preserved.output, preserved.manifest)));
    const snap = path.join(preserved.output, meta.artifacts.find(x => x.kind === 'sqlite').original);
    const result = spawnSync('sqlite3', ['-readonly', snap, 'SELECT id FROM features;'], { encoding: 'utf8' });
    assert.equal(result.stdout.trim(), 'WAL-ONLY');
  } finally { writer.stdin.end(); await once(writer, 'exit'); }
  console.log('PASS context preservation: 205-row batches, counts/IDs, immutable originals, duplicate audit records, idempotence, edited outputs, unknown tables, incomplete input, source/output symlinks, committed WAL snapshot');
} finally { for (const root of roots) fs.rmSync(root, { recursive: true, force: true }); }
