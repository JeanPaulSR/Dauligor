import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify - file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      fs: {
        // When this checkout is a git worktree under .claude/worktrees/<name>/,
        // node_modules lives in the parent repo (3 dirs up). Allow Vite to
        // serve assets from there so font/asset URLs under /@fs/.../node_modules/...
        // don't 403. Harmless when running from the main repo too.
        allow: [path.resolve(__dirname), path.resolve(__dirname, '../../..')],
      },
    },
  };
});
