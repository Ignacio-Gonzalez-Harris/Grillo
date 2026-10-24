import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import electronBinary from 'electron';
import { describe, expect, it } from 'vitest';

// Starting Electron is slower than a unit test, so this one test gets its own explicit budget.
const ELECTRON_START_BUDGET_MS = 30_000;

describe('whisper.cpp binding in Electron', () => {
  it(
    "loads in Electron's runtime on this system",
    () => {
      const stdout = execFileSync(String(electronBinary), [join(__dirname, '__fixtures__', 'load-whisper-binding.cjs')], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        encoding: 'utf8',
        timeout: ELECTRON_START_BUDGET_MS,
      });

      expect(JSON.parse(stdout)).toEqual({ electron: expect.any(String), hasWhisperContext: true });
    },
    ELECTRON_START_BUDGET_MS,
  );
});
