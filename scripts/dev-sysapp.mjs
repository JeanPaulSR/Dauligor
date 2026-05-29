// Branch-specific dev stack for `system-applications`.
//
// Other agents run the default stack (app :3000, worker :8787, wrangler
// inspector :9229). Those ports are machine-global, so two stacks collide.
// This launcher runs an isolated stack on its own ports so they coexist:
//
//   app (Express + Vite)      → http://localhost:3001
//   worker (wrangler dev)     → http://localhost:8788   (D1 + R2 sandbox)
//   wrangler inspector        → :9230
//
// The Express process is pointed at the branch worker via R2_WORKER_URL so
// it reads THIS checkout's local D1 (worker/.wrangler), which is already
// separate from the worktree agents' databases — no DB copy needed.
//
// Ports are overridable: APP_PORT / WORKER_PORT / WORKER_INSPECTOR_PORT.
//
//   node scripts/dev-sysapp.mjs
//
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP_PORT = process.env.APP_PORT || '3001';
const WORKER_PORT = process.env.WORKER_PORT || '8788';
const INSPECTOR_PORT = process.env.WORKER_INSPECTOR_PORT || '9230';

console.log(
  `[dev-sysapp] app http://localhost:${APP_PORT}  ` +
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
worker.on('exit', (code) => console.log(`[dev-sysapp] worker exited (${code})`));
app.on('exit', (code) => console.log(`[dev-sysapp] app exited (${code})`));
