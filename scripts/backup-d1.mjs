#!/usr/bin/env node
// Dump the remote D1 database (`dauligor-db`) to a timestamped .sql file
// under backups/, with a SHA256 sidecar for tamper detection.
//
// Usage:
//   node scripts/backup-d1.mjs                # backup remote (default)
//   node scripts/backup-d1.mjs --local        # backup local .wrangler state
//   node scripts/backup-d1.mjs --schema-only  # schema, no data
//   node scripts/backup-d1.mjs --data-only    # data, no schema
//   node scripts/backup-d1.mjs --prune-days 30  # also delete backups older than N days
//   node scripts/backup-d1.mjs --push-r2      # also upload to private R2 backup bucket
//
// Output: backups/dauligor-{remote|local}-YYYYMMDD-HHmm.sql (+ .sha256)
// R2 object key (with --push-r2): backups/dauligor-{remote|local}-YYYYMMDD-HHmm.sql
//   in the `dauligor-backups` bucket (private — no public hostname).

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const WORKER_DIR = path.join(REPO_ROOT, 'worker');
const BACKUP_DIR = path.join(REPO_ROOT, 'backups');
const DB_NAME = 'dauligor-db';

const args = process.argv.slice(2);
const isLocal = args.includes('--local');
const schemaOnly = args.includes('--schema-only');
const dataOnly = args.includes('--data-only');
const pruneIdx = args.indexOf('--prune-days');
const pruneDays = pruneIdx >= 0 ? parseInt(args[pruneIdx + 1], 10) : null;
const pushR2 = args.includes('--push-r2');
const R2_BACKUP_BUCKET = 'dauligor-backups';

if (schemaOnly && dataOnly) {
  console.error('Error: --schema-only and --data-only are mutually exclusive.');
  process.exit(1);
}

mkdirSync(BACKUP_DIR, { recursive: true });

const now = new Date();
const stamp =
  now.getFullYear().toString() +
  String(now.getMonth() + 1).padStart(2, '0') +
  String(now.getDate()).padStart(2, '0') +
  '-' +
  String(now.getHours()).padStart(2, '0') +
  String(now.getMinutes()).padStart(2, '0');

const target = isLocal ? 'local' : 'remote';
const suffix = schemaOnly ? '-schema' : dataOnly ? '-data' : '';
const filename = `dauligor-${target}-${stamp}${suffix}.sql`;
const outPath = path.join(BACKUP_DIR, filename);

// `-y` skips wrangler's "Ok to proceed?" prompt. Without it, a stray
// keystroke during the export window can answer the prompt and abort
// the backup — bad for unattended scheduled runs.
const wranglerArgs = [
  'wrangler',
  'd1',
  'export',
  DB_NAME,
  isLocal ? '--local' : '--remote',
  '-y',
  `--output=${outPath}`,
];
if (schemaOnly) wranglerArgs.push('--no-data');
if (dataOnly) wranglerArgs.push('--no-schema');

console.log(`[backup] Dumping ${target} D1 (${DB_NAME}) -> ${filename}`);
console.log(`[backup] Running: npx ${wranglerArgs.join(' ')}`);

try {
  execFileSync('npx', wranglerArgs, {
    cwd: WORKER_DIR,
    stdio: 'inherit',
    shell: true, // wrangler is a .cmd on Windows
  });
} catch (err) {
  console.error('[backup] Wrangler export failed.');
  process.exit(1);
}

const sql = readFileSync(outPath);
const sha = createHash('sha256').update(sql).digest('hex');
writeFileSync(`${outPath}.sha256`, `${sha}  ${filename}\n`, 'utf8');

const sizeKb = (sql.length / 1024).toFixed(1);
console.log(`[backup] OK  ${filename}  (${sizeKb} KB)`);
console.log(`[backup] sha256: ${sha}`);

if (pushR2) {
  const r2Key = `backups/${filename}`;
  const r2ShaKey = `backups/${filename}.sha256`;
  const upload = (localPath, key, contentType) => {
    console.log(`[backup] R2 upload  ${R2_BACKUP_BUCKET}/${key}`);
    execFileSync(
      'npx',
      [
        'wrangler',
        'r2',
        'object',
        'put',
        `${R2_BACKUP_BUCKET}/${key}`,
        '--remote',
        '-y',
        `--file=${localPath}`,
        `--content-type=${contentType}`,
      ],
      { cwd: WORKER_DIR, stdio: 'inherit', shell: true }
    );
  };
  try {
    upload(outPath, r2Key, 'application/sql');
    upload(`${outPath}.sha256`, r2ShaKey, 'text/plain');
    console.log(`[backup] R2 upload OK -> r2://${R2_BACKUP_BUCKET}/${r2Key}`);
  } catch (err) {
    console.error('[backup] R2 upload failed. Local backup is still on disk.');
    process.exitCode = 2; // non-fatal: keep going to prune step
  }
}

if (pruneDays !== null && Number.isFinite(pruneDays) && pruneDays > 0) {
  const cutoff = Date.now() - pruneDays * 24 * 60 * 60 * 1000;
  const removed = [];
  for (const entry of readdirSync(BACKUP_DIR)) {
    const full = path.join(BACKUP_DIR, entry);
    const st = statSync(full);
    if (st.isFile() && st.mtimeMs < cutoff) {
      unlinkSync(full);
      removed.push(entry);
    }
  }
  if (removed.length) {
    console.log(`[backup] Pruned ${removed.length} file(s) older than ${pruneDays} days:`);
    for (const r of removed) console.log(`         - ${r}`);
  } else {
    console.log(`[backup] No files older than ${pruneDays} days to prune.`);
  }
}
