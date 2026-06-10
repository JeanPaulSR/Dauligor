// Branch-specific dev stack for `monster-browser`.
//
// Mirrors scripts/dev-manual-uploads.mjs / dev-proposal.mjs / dev-sysapp.mjs.
// The default stack (main checkout: app :3000, worker :8787) plus the sibling
// branch stacks (system-applications :3001/:8788, proposal-system :3002/:8789,
// manual-uploads :3003/:8790, character-creator :3005/:8792) are machine-global,
// so each branch runs an isolated stack on its OWN ports to coexist. This branch:
//
//   app (Express + Vite)      → http://localhost:3006
//   worker (wrangler dev)     → http://localhost:8793   (D1 + R2 sandbox)
//   wrangler inspector        → :9234
//
// ⚠ Do NOT use :3000 — that's the main checkout's default stack.
//
// The Express process is pointed at the branch worker via R2_WORKER_URL so it
// reads THIS checkout's local D1 (worker/.wrangler). The monsters migration
// (20260609-1600) is already applied to this local D1. Seed the REST of the
// schema (sources / spells / etc., needed for FK resolution + spell linking)
// from remote FIRST — read-only on remote, the documented bootstrap:
//
//   cd worker
//   npx wrangler d1 export dauligor-db --remote --output=./remote-snapshot.sql
//   npx wrangler d1 execute dauligor-db --local --file=./remote-snapshot.sql
//   npx wrangler d1 execute dauligor-db --local --file=./migrations/20260609-1600_create_monsters.sql
//   rm ./remote-snapshot.sql
//
// (the remote snapshot has every table EXCEPT monsters — which lives only on
// this branch — so re-applying the monsters migration after the seed is the
// IF-NOT-EXISTS no-op that guarantees the table is present.)
//
// Also copy the parent repo's `.env` + `worker/.dev.vars` into this worktree if
// absent (the junctioned node_modules does not carry them).
//
// Ports are overridable: APP_PORT / WORKER_PORT / WORKER_INSPECTOR_PORT.
//
//   node scripts/dev-monster-browser.mjs
//
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP_PORT = process.env.APP_PORT || '3006';
const WORKER_PORT = process.env.WORKER_PORT || '8793';
const INSPECTOR_PORT = process.env.WORKER_INSPECTOR_PORT || '9234';
// Unique HMR ws port for THIS stack. Vite's default is :24678, shared across
// every worktree stack — whichever starts first owns it and the rest log a
// failed-ws error. server.ts reads HMR_PORT and binds the client ws here.
const HMR_PORT = process.env.HMR_PORT || '24693';

console.log(
  `[dev-monster-browser] app http://localhost:${APP_PORT}  ` +
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
// this launcher to pick up source edits.
const app = spawn('npx', ['tsx', 'server.ts'], {
  cwd: rootDir,
  stdio: 'inherit',
  shell: true,
  // HMR_PORT gives this stack its OWN HMR ws port (server.ts honors it inline —
  // the config-file `server.hmr` is overridden by middlewareMode), so running
  // several worktree stacks at once doesn't collide on Vite's default :24678.
  env: { ...process.env, PORT: APP_PORT, R2_WORKER_URL: `http://localhost:${WORKER_PORT}`, HMR_PORT },
});

const shutdown = () => {
  worker.kill();
  app.kill();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
worker.on('exit', (code) => console.log(`[dev-monster-browser] worker exited (${code})`));
app.on('exit', (code) => console.log(`[dev-monster-browser] app exited (${code})`));
