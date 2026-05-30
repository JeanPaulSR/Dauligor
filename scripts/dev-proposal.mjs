// Branch-specific dev stack for `proposal-system`.
//
// Mirrors scripts/dev-sysapp.mjs. The default stack (app :3000, worker :8787)
// and system-applications' (:3001 / :8788) are machine-global, so each branch
// runs an isolated stack on its own ports to coexist:
//
//   app (Express + Vite)      → http://localhost:3002
//   worker (wrangler dev)     → http://localhost:8789   (D1 + R2 sandbox)
//   wrangler inspector        → :9231
//
// The Express process is pointed at the branch worker via R2_WORKER_URL so it
// reads THIS checkout's local D1 (worker/.wrangler) — already separate from the
// other worktrees' databases, and already has the scaling_column / feature /
// subclass_preview migrations applied. No DB copy needed.
//
// Ports are overridable: APP_PORT / WORKER_PORT / WORKER_INSPECTOR_PORT.
//
//   node scripts/dev-proposal.mjs
//
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP_PORT = process.env.APP_PORT || '3002';
const WORKER_PORT = process.env.WORKER_PORT || '8789';
const INSPECTOR_PORT = process.env.WORKER_INSPECTOR_PORT || '9231';

console.log(
  `[dev-proposal] app http://localhost:${APP_PORT}  ` +
    `worker http://localhost:${WORKER_PORT}  (inspector ${INSPECTOR_PORT})`,
);

const worker = spawn(
  'npx',
  ['wrangler', 'dev', '--port', WORKER_PORT, '--inspector-port', INSPECTOR_PORT],
  { cwd: path.join(rootDir, 'worker'), stdio: 'inherit', shell: true, env: process.env },
);

const app = spawn('npx', ['tsx', 'watch', 'server.ts'], {
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
worker.on('exit', (code) => console.log(`[dev-proposal] worker exited (${code})`));
app.on('exit', (code) => console.log(`[dev-proposal] app exited (${code})`));
