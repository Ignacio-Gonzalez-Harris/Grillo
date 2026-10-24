import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';

/** The dev server's port when GRILLO_DEV_PORT is not set (CLAUDE.md section 3, port rule). */
export const DEFAULT_DEV_PORT = 5173;
const HIGHEST_PORT = 65535;

/** The renderer dev server's port: GRILLO_DEV_PORT, so two worktrees never fight over one port. */
export function devPort(env: Record<string, string | undefined> = process.env): number {
  const value = env['GRILLO_DEV_PORT'];
  if (value === undefined || value === '') {
    return DEFAULT_DEV_PORT;
  }
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > HIGHEST_PORT) {
    throw new Error(`GRILLO_DEV_PORT must be a port number between 1 and ${HIGHEST_PORT}, got '${value}'`);
  }
  return port;
}

export default defineConfig({
  main: {
    resolve: {
      alias: { '@features': resolve('src/main/features') },
    },
    build: {
      rolldownOptions: { input: { index: resolve('src/main/app/index.ts') } },
    },
  },
  preload: {
    build: {
      rolldownOptions: { input: { index: resolve('src/preload/index.ts') } },
    },
  },
  renderer: {
    server: { port: devPort(), strictPort: true },
    build: {
      rolldownOptions: { input: { index: resolve('src/renderer/index.html') } },
    },
  },
});
