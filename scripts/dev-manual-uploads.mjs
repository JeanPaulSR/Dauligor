// Branch-specific dev stack for `manual-uploads`.
//
// Mirrors scripts/dev-proposal.mjs / dev-sysapp.mjs. The default stack
// (app :3000, worker :8787), system-applications (:3001 / :8788), and
// proposal-system (:3002 / :8789) are machine-global, so each branch runs an
// isolated stack on its own ports to coexist:
//
//   app (Express + Vite)      → http://localhost:3003
//   worker (wrangler dev)     → http://localhost:8790   (D1 + R2 sandbox)
//   wrangler inspector        → :9232
//
// The Express process is pointed at the branch worker via R2_WORKER_URL so it
// reads THIS checkout's local D1 (worker/.wrangler). Seed that local D1 from
// remote FIRST (read-only on remote — the documented bootstrap):
//
//   cd worker
//   npx wrangler d1 export dauligor-db --remote --output=./remote-snapshot.sql
//   npx wrangler d1 execute dauligor-db --local --file=./remote-snapshot.sql
//   rm ./remote-snapshot.sql
//
// Ports are overridable: APP_PORT / WORKER_PORT / WORKER_INSPECTOR_PORT.
//
//   node scripts/dev-manual-uploads.mjs
//
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP_PORT = process.env.APP_PORT || '3003';
const WORKER_PORT = process.env.WORKER_PORT || '8790';
const INSPECTOR_PORT = process.env.WORKER_INSPECTOR_PORT || '9232';

console.log(
  `[dev-manual-uploads] app http://localhost:${APP_PORT}  ` +
    `worker http://localhost:${WORKER_PORT}  (inspector ${INSPECTOR_PORT})`,
);

const worker = spawn(
  'npx',
  [
    'wrangler', 'dev', '--port', WORKER_PORT, '--inspector-port', INSPECTOR_PORT,
    // Dev-only: make the worker its own image host so uploaded images return a
    // local URL the worker's public /images serve route can render (in prod,
    // images.dauligor.com serves R2 directly). Overrides the wrangler.toml var.
    '--var', `R2_PUBLIC_URL:http://localhost:${WORKER_PORT}`,
  ],
  { cwd: path.join(rootDir, 'worker'), stdio: 'inherit', shell: true, env: process.env },
);

// NOTE: no-watch (`tsx server.ts`, NOT `tsx watch`). In a worktree the
// node_modules junction points at the parent repo, so Vite's `.vite-temp`
// config churn under that shared node_modules makes `tsx watch` restart in an
// endless loop. No-watch is the stable test-server mode for worktrees — restart
// this launcher to pick up source edits. (The sibling launchers use `tsx watch`
// from the parent checkout where this doesn't bite.)
const app = spawn('npx', ['tsx', 'server.ts'], {
  cwd: rootDir,
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, PORT: APP_PORT, R2_WORKER_URL: `http://localhost:${WORKER_PORT}` },
});

const shutdown = () => {
  worker.kill();
  app.kill();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
worker.on('exit', (code) => console.log(`[dev-manual-uploads] worker exited (${code})`));
app.on('exit', (code) => console.log(`[dev-manual-uploads] app exited (${code})`));
