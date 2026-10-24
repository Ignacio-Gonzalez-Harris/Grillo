import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import { defaultUserDataFolder, speechModelPathIn } from './src/main/features/transcription/model';

// `*.model.test.ts` files transcribe real speech with the model the app downloads. They are part of the suite only
// on a machine where that model file exists (CI never downloads it); elsewhere the name pattern leaves them out.
const speechModelPath = speechModelPathIn(
  defaultUserDataFolder({ platform: process.platform, env: process.env, homeFolder: homedir() }),
);
const testsNeedingTheSpeechModel = existsSync(speechModelPath) ? [] : ['**/*.model.test.ts'];

export default defineConfig({
  resolve: {
    alias: {
      // Main discovers features under `@features/*/ipc.ts`. In tests that folder is a fixture,
      // so the discovery test runs the real discovery code without touching src/main/features/.
      '@features': resolve('src/main/app/__fixtures__/features'),
      // The renderer discovers screens under `@screens/*/index.ts`; in tests that folder is a fixture too.
      '@screens': resolve('src/renderer/app/__fixtures__/screens'),
    },
  },
  test: {
    include: ['**/*.test.ts'],
    exclude: ['**/node_modules/**', 'out/**', 'dist/**', '.claude/**', ...testsNeedingTheSpeechModel],
    environment: 'node',
  },
});
