#!/usr/bin/env node
// Explicit-path historical context export. Never modifies source records or statuses.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const BACKLOG = new Set('metadata labels epics features feature_dependencies feature_labels feature_items feature_persona_workflows routes integrations audit_events backlog_item_events backlog_item_claims tools adg_anti_success_criteria adg_experience_contracts adg_functional_requirements adg_journey_matrix adg_scenarios backlog_item_current_status feature_current_status persona_workflows'.split(' '));
const ELICITATION = new Set('elicitation_features elicitation_rbac_stories elicitation_user_stories elicitation_use_cases elicitation_requirements elicitation_criteria elicitation_experience_contracts elicitation_scenarios elicitation_journey_matrix elicitation_gaps elicitation_graph_nodes elicitation_graph_edges'.split(' '));
const INPUTS = [['data/backlog.sqlite', 'sqlite'], ['data/elicitation.sqlite', 'sqlite'], ['data/seed/backlog.seed.json', 'json'], ['config/agentic/elicitation.json', 'json'], ['data/audit/audit-log.jsonl', 'jsonl'], ['AGENTS.md', 'instruction'], ['CLAUDE.md', 'instruction'], ['.claude/CLAUDE.md', 'instruction']];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const quote = name => '"' + name.replaceAll('"', '""') + '"';
const escape = value => String(typeof value === 'string' ? value : JSON.stringify(value)).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replace(/[\\`*_\[\]#|]/g, '\\$&').replaceAll('\r', '').replaceAll('\n', '<br>');
function safe(filename) {
  const absolute = path.resolve(filename); let current = path.parse(absolute).root;
  for (const part of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (fs.lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error(`Symlink refused: ${current}`);
  }
  return absolute;
}
function sqlite(filename, sql, json = true, readOnly = true) {
  const result = spawnSync('sqlite3', ['-batch', '-bail', ...(readOnly ? ['-readonly'] : []), ...(json ? ['-json'] : []), filename], { input: sql + '\n', encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`SQLite preservation failed: ${result.error?.message || result.stderr}`);
  return json ? JSON.parse(result.stdout || '[]') : result.stdout;
}
function tables(filename, allow) {
  const names = sqlite(filename, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;").map(row => row.name);
  const unknown = names.filter(name => !allow.has(name));
  if (unknown.length) throw new Error(`Unknown tables require preservation review: ${unknown.join(', ')}`);
  return names;
}
export function preserveContext({ target, output } = {}) {
  if (!target) throw new Error('--target is required');
  const root = fs.realpathSync(target), destination = safe(output ? path.resolve(root, output) : path.join(root, 'docs/adg-preserved'));
  if (!fs.statSync(root).isDirectory()) throw new Error('Target must be a directory');
  const artifacts = [], files = new Map();
  function save(label, bytes, suffix) {
    bytes = Buffer.from(bytes); const name = `${label}-${hash(bytes)}${suffix}`;
    files.set(name, bytes); return name;
  }
  for (const [rel, kind] of INPUTS) {
    const source = safe(path.join(root, rel));
    if (!fs.existsSync(source)) continue;
    if (!fs.statSync(source).isFile()) throw new Error(`Expected regular file: ${rel}`);
    const label = rel.replace(/[^a-zA-Z0-9-]/g, '-');
    if (kind === 'instruction') {
      const raw = fs.readFileSync(source);
      artifacts.push({ source: rel, kind, source_sha256: hash(raw), original: save(`original-${label}`, raw, '.md') }); continue;
    }
    let markdown = `# Preserved ADG context\n\nSource repository: ${escape(root)}\n\nSource path: ${escape(rel)}\n\nHistorical records only; status values are not new verification or release claims.\n`;
    const counts = {};
    const record = (title, row) => {
      markdown += `\n### ${escape(title)}\n\n`;
      if (row && typeof row === 'object' && !Array.isArray(row)) for (const [key, value] of Object.entries(row)) markdown += `- **${escape(key)}:** ${escape(value)}\n`;
      else markdown += escape(row) + '\n';
    };
    let original, sourceHash, method;
    if (kind === 'sqlite') {
      safe(source + '-wal'); safe(source + '-shm');
      const allow = rel.includes('backlog') ? BACKLOG : ELICITATION;
      tables(source, allow); // Fail closed before copying or querying unknown application tables.
      const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'adg-preserve-'));
      try {
        const snapshot = path.join(temporary, 'snapshot.sqlite');
        sqlite(source, `.backup '${snapshot.replaceAll("'", "''")}'`, false);
        // Backup inherits WAL mode; materialize a standalone snapshot before read-only queries.
        sqlite(snapshot, 'PRAGMA journal_mode=DELETE;', true, false);
        const names = tables(snapshot, allow);
        for (const name of names) {
          const columns = sqlite(snapshot, `PRAGMA table_info(${quote(name)});`).map(row => row.name);
          const total = sqlite(snapshot, `SELECT count(*) AS n FROM ${quote(name)};`)[0].n;
          let exported = 0; markdown += `\n## ${escape(name)}\n`;
          for (let offset = 0; offset < total; offset += 100) {
            const rows = sqlite(snapshot, `SELECT ${columns.map(quote).join(', ')} FROM ${quote(name)} ORDER BY ${columns.map(quote).join(', ')} LIMIT 100 OFFSET ${offset};`);
            if (!rows.length) throw new Error(`Incomplete export: ${name}`);
            for (const row of rows) { exported++; record(row.id ?? exported, row); }
          }
          if (exported !== total) throw new Error(`Count mismatch: ${name}`);
          counts[name] = exported;
        }
        original = fs.readFileSync(snapshot); sourceHash = hash(original);
        method = 'SQLite read-only backup: consistent snapshot including committed WAL; not byte-identical to the source database file';
      } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
    } else {
      original = fs.readFileSync(source); sourceHash = hash(original);
      if (kind === 'jsonl') {
        counts.records = 0; counts.blank_lines = 0;
        for (const [index, line] of original.toString('utf8').split('\n').entries()) {
          if (!line.trim()) { counts.blank_lines++; continue; }
          let row; try { row = JSON.parse(line); } catch { throw new Error(`Malformed JSON: ${rel}:${index + 1}; retirement must stop`); }
          record(`Source line ${index + 1}`, row); counts.records++;
        }
      } else {
        const data = JSON.parse(original.toString('utf8')); counts.records = 0;
        for (const [key, value] of Object.entries(data)) {
          if (Array.isArray(value)) { counts[key] = value.length; for (const [index, row] of value.entries()) { record(`${key} ${row?.id ?? index + 1}`, row); counts.records++; } }
          else { record(key, value); counts.records++; }
        }
      }
    }
    markdown += `\n## Export counts\n\n${escape(counts)}\n`;
    artifacts.push({ source: rel, kind, counts, ...(kind === 'sqlite' ? { snapshot_sha256: sourceHash, snapshot_method: method } : { source_sha256: sourceHash }), original: save(`original-${label}`, original, path.extname(rel)), markdown: save(label, markdown, '.md'), content_sha256: hash(markdown) });
  }
  const manifest = save('manifest', JSON.stringify({ format: 1, repository: root, artifacts, notes: ['Only explicit ADG paths were read. Originals and historical statuses are unchanged.', 'SQLite queries use batches of 100; exports verify row counts. JSON inputs are parsed in memory.', 'Review preserved context for private information before committing.'] }, null, 2) + '\n', '.json');
  const index = save('README', `# ADG context preservation\n\nHistorical snapshot from ${escape(root)}. Keep earlier hash-addressed snapshots for provenance.\n\n` + artifacts.map(a => `- ${escape(a.source)}: ${a.markdown ? `[readable context](${a.markdown}); ` : ''}[original](${a.original})${a.counts ? ` — ${escape(a.counts)}` : ''}`).join('\n') + `\n\n[Provenance manifest](${manifest})\n`, '.md');
  // Preflight the complete output set before any output writes. Edited artifacts block retirement.
  for (const [name, bytes] of files) {
    const dest = safe(path.join(destination, name));
    if (fs.existsSync(dest) && (!fs.statSync(dest).isFile() || !fs.readFileSync(dest).equals(bytes))) throw new Error(`Refusing to overwrite modified preservation artifact: ${dest}`);
  }
  fs.mkdirSync(destination, { recursive: true });
  for (const [name, bytes] of files) { const dest = safe(path.join(destination, name)); if (!fs.existsSync(dest)) fs.writeFileSync(dest, bytes, { flag: 'wx' }); }
  return { repository: root, output: destination, manifest, index, sources: artifacts.length, counts: Object.fromEntries(artifacts.filter(a => a.counts).map(a => [a.source, a.counts])) };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2), options = {};
    for (let i = 0; i < args.length; i++) { if (['--target', '--output'].includes(args[i]) && args[i + 1]) options[args[i].slice(2)] = args[++i]; else throw new Error(`Unknown argument: ${args[i]}`); }
    console.log(JSON.stringify(preserveContext(options), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
