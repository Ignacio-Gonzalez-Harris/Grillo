import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import electronBinary from 'electron';
import { describe, expect, it } from 'vitest';

// Starting Electron is slower than a unit test, so this one test gets its own explicit budget.
const ELECTRON_START_BUDGET_MS = 30_000;

describe('native modules in Electron', () => {
  it(
    "node-pty loads in Electron's runtime and runs a command in a terminal",
    () => {
      const stdout = execFileSync(String(electronBinary), [join(__dirname, 'fixtures', 'pty-echo.cjs')], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        encoding: 'utf8',
        timeout: ELECTRON_START_BUDGET_MS,
      });

      const result = JSON.parse(stdout);
      expect(result.electron).toEqual(expect.any(String));
      expect(result).toMatchObject({ exitCode: 0, sawMarker: true });
    },
    ELECTRON_START_BUDGET_MS,
  );

  // Kept in this file on purpose: the electron package downloads its binary on first import, so a second test file
  // importing it in parallel on a fresh CI runner races that download and corrupts the binary.
  it(
    "the whisper.cpp binding loads in Electron's runtime",
    () => {
      const stdout = execFileSync(String(electronBinary), [join(__dirname, 'fixtures', 'whisper-load.cjs')], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        encoding: 'utf8',
        timeout: ELECTRON_START_BUDGET_MS,
      });

      expect(JSON.parse(stdout)).toEqual({ electron: expect.any(String), hasWhisperContext: true });
    },
    ELECTRON_START_BUDGET_MS,
  );
});
