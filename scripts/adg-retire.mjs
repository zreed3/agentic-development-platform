#!/usr/bin/env node
// Reversible retirement of an install-state-managed ADG installation.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const STATE = 'config/agentic/adg-install-state.json';
const hash = x => createHash('sha256').update(x).digest('hex');
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const supported = /^(?:config\/agentic\/[\w.-]+|scripts\/(?:adg-[\w.-]+|guardrail-check\.mjs|audit-chain\.mjs|record-audit\.mjs|validate-audit\.mjs|asset-lint\.mjs)|docs\/adg\/.+|tools\/adg-asset-lint\/.+|apps\/adg-dashboard\/.+|\.claude\/commands\/adg-[\w.-]+|\.claude\/settings\.json|CLAUDE\.md)$/;
function safe(root, rel) {
  if (typeof rel !== 'string' || !rel || rel.includes('\\') || path.isAbsolute(rel) || rel.split('/').some(p => !p || p === '.' || p === '..')) throw new Error(`Unsafe path: ${rel}`);
  let current = root;
  for (const part of rel.split('/')) {
    current = path.join(current, part);
    if (fs.existsSync(current) || fs.lstatSync(current, { throwIfNoEntry: false })) {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink()) throw new Error(`Symlink refused: ${rel}`);
    }
  }
  return current;
}
function read(root, rel) {
  const p = safe(root, rel);
  if (!fs.existsSync(p)) return null;
  if (!fs.statSync(p).isFile()) throw new Error(`Expected file: ${rel}`);
  return fs.readFileSync(p);
}
export function retire({ target, apply = false }) {
  if (!target) throw new Error('--target is required');
  const root = fs.realpathSync(target);
  const raw = read(root, STATE);
  if (!raw) return { target: root, status: 'not-installed', applied: false, changes: [], blockers: [] };
  const state = JSON.parse(raw);
  if (!object(state) || state.schemaVersion !== 1 || state.system !== 'Proofline' || !Array.isArray(state.files) || !object(state.packageScripts)) throw new Error('Invalid ADG install state');
  const seen = new Set();
  for (const entry of state.files) {
    if (!object(entry) || !supported.test(entry.target) || seen.has(entry.target) || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error(`Invalid managed entry: ${entry?.target}`);
    safe(root, entry.target); seen.add(entry.target);
  }
  for (const [key, value] of Object.entries(state.packageScripts)) {
    if (!key || typeof value !== 'string' || !value) throw new Error('Invalid managed package scripts');
  }
  const changes = new Map(), blockers = [], retained = [], removedScripts = new Set();
  const put = (rel, after, reason) => { const before = read(root, rel); if (before && (after === null || !before.equals(Buffer.from(after)))) changes.set(rel, { before, after, reason }); };
  for (const entry of state.files) {
    if (['CLAUDE.md', '.claude/settings.json'].includes(entry.target)) continue;
    const before = read(root, entry.target);
    if (before) put(entry.target, null, hash(before) === entry.sha256 ? 'archive managed asset' : 'archive customized managed asset');
  }
  // Merged permissions have no origin marker. Keep them all, including deny rules.
  const settingsRaw = read(root, '.claude/settings.json');
  if (settingsRaw && seen.has('.claude/settings.json')) {
    const settings = JSON.parse(settingsRaw);
    if (!object(settings) || (settings.hooks !== undefined && !object(settings.hooks))) throw new Error('Invalid Claude settings');
    const exact = new Set(['node "${CLAUDE_PROJECT_DIR}/scripts/adg-guardrail-hook.mjs"', 'node scripts/adg-guardrail-hook.mjs']);
    for (const [event, registrations] of Object.entries(settings.hooks ?? {})) {
      if (!Array.isArray(registrations)) throw new Error('Invalid hook registrations');
      settings.hooks[event] = registrations.map(reg => {
        if (!object(reg) || !Array.isArray(reg.hooks)) throw new Error('Invalid hook registration');
        return { ...reg, hooks: reg.hooks.filter(h => {
          if (!object(h)) throw new Error('Invalid hook');
          if (typeof h.command === 'string' && h.command.includes('adg-guardrail-hook') && !exact.has(h.command)) blockers.push(`Ambiguous hook: ${h.command}`);
          return !(h.type === 'command' && exact.has(h.command));
        }) };
      }).filter(reg => reg.hooks.length);
    }
    if (JSON.stringify(settings) !== JSON.stringify(JSON.parse(settingsRaw))) put('.claude/settings.json', JSON.stringify(settings, null, 2) + '\n', 'remove exact ADG hooks; retain permissions');
  }
  const pkgRaw = read(root, 'package.json');
  if (pkgRaw) {
    const pkg = JSON.parse(pkgRaw);
    if (!object(pkg) || (pkg.scripts !== undefined && !object(pkg.scripts))) throw new Error('Invalid package.json');
    const removed = removedScripts;
    for (const [key, expected] of Object.entries(state.packageScripts)) {
      if (pkg.scripts?.[key] === expected) { delete pkg.scripts[key]; removed.add(key); }
      else if (pkg.scripts?.[key] !== undefined) retained.push(`customized package script: ${key}`);
    }
    // Legacy full-copy installations used dedicated commands outside install-state.
    // Recognize only observed, standalone ADG entrypoints and known subcommands;
    // never interpret shell chains or remove a generic native Node command.
    const legacyCommands = new Set([
      'node scripts/record-audit.mjs',
      ...['setup', 'validate', 'export', 'list', 'next'].map(x => `node _adg-v2/scripts/backlog-db.mjs ${x}`),
      ...['feature', 'item', 'audit', 'loop'].map(x => `node _adg-v2/scripts/agent-context.mjs ${x}`),
      ...['graph', 'validate'].map(x => `node _adg-v2/scripts/adg-elicitation.mjs ${x}`),
      ...['install', 'update', 'status'].map(x => `node _adg-v2/scripts/adg-install.mjs ${x}`),
    ]);
    for (const [key, command] of Object.entries(pkg.scripts ?? {})) {
      if (typeof command !== 'string') throw new Error('Invalid package script');
      if (legacyCommands.has(command) && (command !== 'node scripts/record-audit.mjs' || key === 'adg:audit:record')) {
        delete pkg.scripts[key]; removed.add(key);
      }
    }
    for (const [key, command] of Object.entries(pkg.scripts ?? {})) {
      if (typeof command !== 'string') throw new Error('Invalid package script');
      // Only this exact observed ADG suffix has a safe, known native remainder.
      const suffix = ' && npm run adg:doctor -- --target .';
      if (command.endsWith(suffix) && removed.has('adg:doctor')) {
        const native = command.slice(0, -suffix.length);
        if (/^(?:pnpm (?:typecheck|test|lint|build))(?: && pnpm (?:typecheck|test|lint|build))*$/.test(native)) pkg.scripts[key] = native;
      }
      const next = pkg.scripts[key];
      for (const rel of changes.keys()) if (next.includes(rel)) blockers.push(`Shared/customized script ${key} references retired ${rel}`);
      for (const removedKey of removed) if (new RegExp(`(?:npm run|pnpm|yarn) ${removedKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s|$)`).test(next)) blockers.push(`Shared script ${key} references retired ${removedKey}`);
    }
    if (JSON.stringify(pkg) !== JSON.stringify(JSON.parse(pkgRaw))) put('package.json', JSON.stringify(pkg, null, 2) + '\n', 'remove exact managed scripts; retain native checks');
  }
  for (const rel of ['AGENTS.md', 'CLAUDE.md']) {
    const before = read(root, rel);
    if (before && /\b(?:ADG|Proofline)\b|adg:|_adg-v2/.test(before.toString()) && !before.toString().startsWith('<!-- adg-retired -->')) {
      put(rel, '<!-- adg-retired -->\n> ADG tooling is retired in this checkout. Instructions below that require ADG, Proofline, SQL backlog, or ADG audit/context commands are historical and no longer apply. Native project requirements, security boundaries, tests, and non-ADG instructions remain active. Existing audit logs remain append-only: never rewrite or delete prior events. Preserve decisions and working context in Markdown and Git. Original instructions are archived under docs/adg-preserved.\n\n' + before, 'supersede retired ADG directives; preserve native instructions');
    }
  }
  // Bound the integration scan to executable CI and hook configuration. A caller
  // must resolve shared consumers explicitly before retiring their entrypoints.
  const integrationFiles = [];
  function scanDirectory(rel, depth = 0) {
    const directory = safe(root, rel);
    if (!fs.existsSync(directory)) return;
    if (depth > 5) throw new Error(`Integration directory too deep: ${rel}`);
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const child = `${rel}/${entry.name}`;
      safe(root, child);
      if (entry.isDirectory()) scanDirectory(child, depth + 1);
      else if (entry.isFile()) {
        integrationFiles.push(child);
        if (integrationFiles.length > 200) throw new Error('Integration scan exceeds 200 files');
      }
    }
  }
  scanDirectory('.github/workflows');
  scanDirectory('.husky');
  for (const rel of ['.claude/settings.json', '.claude/settings.local.json', '.codex/config.toml', '.codex/hooks.json', '.mcp.json', 'lefthook.yml', 'lefthook.yaml', '.pre-commit-config.yaml']) {
    if (read(root, rel)) integrationFiles.push(rel);
  }
  for (const rel of integrationFiles) {
    const planned = changes.get(rel);
    if (planned?.after === null) continue;
    const content = planned ? Buffer.from(planned.after) : read(root, rel);
    if (content.length > 1024 * 1024) throw new Error(`Integration file exceeds 1 MiB: ${rel}`);
    const text = content.toString('utf8');
    for (const [retired, change] of changes) {
      if (change.after === null && text.includes(retired)) blockers.push(`Integration ${rel} references retired ${retired}`);
    }
    for (const key of removedScripts) {
      const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`(?:npm run|pnpm(?: run)?|yarn(?: run)?) ${escaped}(?=\\s|[\"']|$)`).test(text)) blockers.push(`Integration ${rel} references retired script ${key}`);
    }
  }
  put(STATE, null, 'archive install provenance');
  safe(root, 'docs/adg-preserved');
  const report = { target: root, status: blockers.length ? 'blocked' : 'ready', applied: false, changes: [...changes].map(([file, x]) => ({ file, action: x.after === null ? 'archive' : 'update', reason: x.reason })), retained, blockers: [...new Set(blockers)] };
  if (!apply || blockers.length) return report;
  // Preflight every source before making any directories or writes.
  for (const [rel, change] of changes) if (!read(root, rel)?.equals(change.before)) throw new Error(`Changed during preflight: ${rel}`);
  const archiveRel = `docs/adg-preserved/retirement-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`;
  const archive = safe(root, archiveRel);
  fs.mkdirSync(archive, { recursive: true });
  // Snapshot every touched original before any mutation. Files retain original bytes.
  for (const [rel, change] of changes) {
    const dest = path.join(archive, rel); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, change.before, { flag: 'wx', mode: fs.statSync(safe(root, rel)).mode });
  }
  fs.writeFileSync(path.join(archive, 'README.md'), '# Retired ADG installation\n\nThese files are historical context, not active instructions. Original bytes and install provenance are preserved. Native project CI and security requirements remain active. Audit logs and SQL data remain at their original paths. Existing audit logs remain append-only: never rewrite or delete prior events. No model capability makes security controls inherently obsolete.\n\n' + report.changes.map(x => `- ${x.file}: ${x.reason}`).join('\n') + '\n', { flag: 'wx' });
  for (const [rel, change] of changes) {
    const dest = safe(root, rel);
    if (change.after === null) fs.unlinkSync(dest); else fs.writeFileSync(dest, change.after);
  }
  return { ...report, status: 'retired', applied: true, archive: archiveRel };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2); let target, apply = false, dryRun = false;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--target' && args[i + 1]) target = args[++i];
      else if (args[i] === '--apply') apply = true;
      else if (args[i] === '--dry-run') dryRun = true;
      else throw new Error(`Unknown argument: ${args[i]}`);
    }
    if (apply && dryRun) throw new Error('--apply and --dry-run conflict');
    const result = retire({ target, apply }); console.log(JSON.stringify(result, null, 2)); if (result.blockers.length) process.exitCode = 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
