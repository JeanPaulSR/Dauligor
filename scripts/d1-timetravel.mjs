#!/usr/bin/env node
// Wrapper around Cloudflare D1 Time Travel — point-in-time recovery for the
// remote database, free, up to 30 days. This is the FAST recovery path:
// no SQL dump needed, no schema clashes, transactional rollback of the
// entire DB to a prior bookmark. Use it when "I just made a bad change,
// undo it" is the goal.
//
// Usage:
//   node scripts/d1-timetravel.mjs info
//       Show the current bookmark + retention window for the remote DB.
//
//   node scripts/d1-timetravel.mjs bookmark <ISO-timestamp>
//       Resolve a timestamp (e.g. 2026-05-08T11:00:00Z) to a bookmark you
//       can restore. Useful BEFORE risky operations: capture "now" and
//       record it somewhere.
//
//   node scripts/d1-timetravel.mjs restore <bookmark> --confirm
//       Restore the remote DB to the given bookmark. Destroys all changes
//       made after the bookmark. Requires --confirm.
//
// References:
//   https://developers.cloudflare.com/d1/reference/time-travel/

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const WORKER_DIR = path.join(REPO_ROOT, 'worker');
const DB_NAME = 'dauligor-db';

const args = process.argv.slice(2);
const cmd = args[0];

function runWrangler(extra) {
  const all = ['wrangler', 'd1', 'time-travel', ...extra, DB_NAME];
  console.log(`Running: npx ${all.join(' ')}`);
  execFileSync('npx', all, { cwd: WORKER_DIR, stdio: 'inherit', shell: true });
}

if (cmd === 'info') {
  runWrangler(['info']);
} else if (cmd === 'bookmark') {
  const ts = args[1];
  if (!ts) {
    console.error('Usage: ... bookmark <ISO-timestamp>');
    console.error('  e.g. 2026-05-08T11:00:00Z');
    process.exit(1);
  }
  runWrangler(['info', `--timestamp=${ts}`]);
} else if (cmd === 'restore') {
  const bookmark = args[1];
  if (!bookmark || !args.includes('--confirm')) {
    console.error('Usage: ... restore <bookmark-id> --confirm');
    console.error('Refusing to restore without --confirm. This rolls back the REMOTE DB.');
    process.exit(1);
  }
  console.log(`About to restore REMOTE ${DB_NAME} to bookmark: ${bookmark}`);
  console.log('All writes after this bookmark will be lost. Press Ctrl-C in the next 5s to abort.');
  // Tiny pause so the warning is readable; not strictly necessary.
  const start = Date.now();
  while (Date.now() - start < 5000) {} // eslint-disable-line no-empty
  runWrangler(['restore', `--bookmark=${bookmark}`]);
} else {
  console.log('D1 Time Travel — wrappers around `wrangler d1 time-travel`.');
  console.log('Commands:');
  console.log('  info                            Current bookmark + retention window');
  console.log('  bookmark <ISO-timestamp>        Resolve a timestamp to a bookmark id');
  console.log('  restore <bookmark> --confirm    Roll the remote DB back to a bookmark');
  process.exit(cmd ? 1 : 0);
}
