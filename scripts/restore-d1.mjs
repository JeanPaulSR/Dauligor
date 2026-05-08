#!/usr/bin/env node
// Restore a backup .sql file produced by scripts/backup-d1.mjs into D1.
//
// SAFE BY DEFAULT: restores into LOCAL D1. Remote restore requires both
// `--remote` and `--confirm` to prevent accidental prod overwrites.
//
// Usage:
//   node scripts/restore-d1.mjs --list
//   node scripts/restore-d1.mjs --file dauligor-remote-20260508-1130.sql
//   node scripts/restore-d1.mjs --latest                 # restore newest backup to LOCAL
//   node scripts/restore-d1.mjs --file <name> --remote --confirm
//
// Note: wrangler d1 execute does NOT drop tables before applying. The dump
// from `wrangler d1 export` contains CREATE TABLE statements (unless
// --schema-only/--no-schema was used), which will fail on existing tables.
// To restore against a populated DB, you typically want to:
//   1. Restore into a freshly nuked local DB (delete worker/.wrangler/state).
//   2. For remote, prefer Cloudflare Time Travel (free, 30-day window).
//      See scripts/d1-timetravel.mjs.
// This script verifies the SHA256 sidecar before applying.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const WORKER_DIR = path.join(REPO_ROOT, 'worker');
const BACKUP_DIR = path.join(REPO_ROOT, 'backups');
const DB_NAME = 'dauligor-db';

const args = process.argv.slice(2);

if (args.includes('--list')) {
  if (!existsSync(BACKUP_DIR)) {
    console.log('No backups/ directory yet. Run npm run backup:d1 first.');
    process.exit(0);
  }
  const files = readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => {
      const full = path.join(BACKUP_DIR, f);
      const st = statSync(full);
      return { name: f, size: st.size, mtime: st.mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
  if (!files.length) {
    console.log('No backups/*.sql files yet.');
    process.exit(0);
  }
  console.log('Available backups (newest first):');
  for (const f of files) {
    const dt = new Date(f.mtime).toISOString().replace('T', ' ').slice(0, 16);
    const kb = (f.size / 1024).toFixed(1).padStart(7, ' ');
    console.log(`  ${dt}  ${kb} KB  ${f.name}`);
  }
  process.exit(0);
}

const fileIdx = args.indexOf('--file');
const useLatest = args.includes('--latest');
let chosen = null;

if (useLatest) {
  if (!existsSync(BACKUP_DIR)) {
    console.error('No backups/ directory. Run npm run backup:d1 first.');
    process.exit(1);
  }
  const files = readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => ({ name: f, mtime: statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  if (!files.length) {
    console.error('No backup files found in backups/.');
    process.exit(1);
  }
  chosen = files[0].name;
} else if (fileIdx >= 0) {
  chosen = args[fileIdx + 1];
}

if (!chosen) {
  console.error('Usage: node scripts/restore-d1.mjs (--list | --latest | --file <name>) [--remote --confirm]');
  process.exit(1);
}

const filePath = path.isAbsolute(chosen) ? chosen : path.join(BACKUP_DIR, chosen);
if (!existsSync(filePath)) {
  console.error(`Backup file not found: ${filePath}`);
  process.exit(1);
}

const shaPath = `${filePath}.sha256`;
if (existsSync(shaPath)) {
  const expected = readFileSync(shaPath, 'utf8').trim().split(/\s+/)[0];
  const actual = createHash('sha256').update(readFileSync(filePath)).digest('hex');
  if (expected !== actual) {
    console.error(`SHA256 mismatch for ${path.basename(filePath)}.`);
    console.error(`  expected: ${expected}`);
    console.error(`  actual:   ${actual}`);
    console.error('Refusing to restore a tampered/corrupt backup.');
    process.exit(1);
  }
  console.log(`[restore] SHA256 OK (${actual.slice(0, 12)}...)`);
} else {
  console.warn(`[restore] No SHA256 sidecar at ${path.basename(shaPath)} — proceeding without integrity check.`);
}

const isRemote = args.includes('--remote');
const confirmed = args.includes('--confirm');

if (isRemote && !confirmed) {
  console.error('Refusing to restore to REMOTE D1 without --confirm. This overwrites production data.');
  console.error('If you really mean it, re-run with: --remote --confirm');
  console.error('Prefer `npm run timetravel -- restore` for fast point-in-time recovery instead.');
  process.exit(1);
}

const target = isRemote ? '--remote' : '--local';
const wranglerArgs = ['wrangler', 'd1', 'execute', DB_NAME, target, `--file=${filePath}`];
console.log(`[restore] Applying ${path.basename(filePath)} to ${isRemote ? 'REMOTE' : 'LOCAL'} ${DB_NAME}`);
console.log(`[restore] Running: npx ${wranglerArgs.join(' ')}`);

try {
  execFileSync('npx', wranglerArgs, {
    cwd: WORKER_DIR,
    stdio: 'inherit',
    shell: true,
  });
  console.log('[restore] Done.');
} catch (err) {
  console.error('[restore] Wrangler execute failed.');
  console.error('  Common cause: target DB already has the tables, so CREATE TABLE clashes.');
  console.error('  For local: delete worker/.wrangler/state/v3/d1/*/db.sqlite and re-run.');
  console.error('  For remote: use `npm run timetravel -- restore` instead.');
  process.exit(1);
}
