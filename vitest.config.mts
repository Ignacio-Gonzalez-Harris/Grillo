import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // Main discovers features under `@features/*/ipc.ts`. In tests that folder is a fixture,
      // so the discovery test runs the real discovery code without touching src/main/features/.
      '@features': resolve('src/main/app/__fixtures__/features'),
    },
  },
  test: {
    include: ['**/*.test.ts'],
    exclude: ['**/node_modules/**', 'out/**', 'dist/**', '.claude/**'],
    environment: 'node',
  },
});
