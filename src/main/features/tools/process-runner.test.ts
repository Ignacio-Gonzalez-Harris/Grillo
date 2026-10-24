import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createProcessRunner, findExecutable } from './process-runner';

describe('findExecutable', () => {
  const cases: {
    title: string;
    platform: NodeJS.Platform;
    env: Record<string, string>;
    files: string[];
    name: string;
    expected: string | null;
  }[] = [
    {
      title: 'finds a Windows program through PATHEXT, whatever the case of the Path variable',
      platform: 'win32',
      env: { Path: 'C:\\Windows;C:\\Tools', PATHEXT: '.COM;.EXE;.CMD' },
      files: ['C:\\Tools\\gh.EXE'],
      name: 'gh',
      expected: 'C:\\Tools\\gh.EXE',
    },
    {
      title: 'takes the first directory on PATH that has the program',
      platform: 'win32',
      env: { PATH: 'C:\\First;C:\\Second', PATHEXT: '.EXE;.CMD' },
      files: ['C:\\Second\\claude.EXE', 'C:\\First\\claude.CMD'],
      name: 'claude',
      expected: 'C:\\First\\claude.CMD',
    },
    {
      title: 'finds Claude Code in the native installer folder on Windows when PATH predates the install',
      platform: 'win32',
      env: { PATH: 'C:\\Windows', PATHEXT: '.EXE' },
      files: ['C:\\Users\\member\\.local\\bin\\claude.EXE'],
      name: 'claude',
      expected: 'C:\\Users\\member\\.local\\bin\\claude.EXE',
    },
    {
      title: 'finds gh in the Homebrew folder on a Mac, where an app started from Finder gets a short PATH',
      platform: 'darwin',
      env: { PATH: '/usr/bin:/bin' },
      files: ['/opt/homebrew/bin/gh'],
      name: 'gh',
      expected: '/opt/homebrew/bin/gh',
    },
    {
      title: 'returns null when no search directory has the program',
      platform: 'darwin',
      env: { PATH: '/usr/bin:/bin' },
      files: [],
      name: 'gh',
      expected: null,
    },
  ];

  for (const { title, platform, env, files, name, expected } of cases) {
    it(title, () => {
      const home = platform === 'win32' ? 'C:\\Users\\member' :'/Users/member';
      const found = findExecutable(name, { platform, env, home, isFile: (path) => files.includes(path) });
      expect(found).toBe(expected);
    });
  }
});

/** The test's own environment with PATH replaced, under whatever case the platform spells it. */
function envWithPath(directory: string): Record<string, string | undefined> {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== 'PATH'));
  return { ...env, PATH: directory };
}

describe('createProcessRunner, running real child processes', () => {
  const nodeDirectory = dirname(process.execPath);
  let scratch: string | undefined;

  afterEach(() => {
    if (scratch) {
      rmSync(scratch, { recursive: true, force: true });
      scratch = undefined;
    }
  });

  it('reports a command found in no search directory as not found', async () => {
    const runner = createProcessRunner({ env: envWithPath(nodeDirectory) });
    await expect(runner.run('grillo-no-such-tool', ['--version'])).resolves.toEqual({ found: false });
  });

  it('returns the exit code, standard output and standard error of a found command', async () => {
    const runner = createProcessRunner({ env: envWithPath(nodeDirectory) });
    const script = 'process.stdout.write("out"); process.stderr.write("err"); process.exit(3)';

    await expect(runner.run('node', ['-e', script])).resolves.toEqual({
      found: true,
      exitCode: 3,
      stdout: 'out',
      stderr: 'err',
    });
  });

  it('runs a script shim (a .cmd file on Windows, an executable script elsewhere)', async () => {
    scratch = mkdtempSync(join(tmpdir(), 'grillo-tools-'));
    if (process.platform === 'win32') {
      writeFileSync(join(scratch, 'fake-tool.cmd'), '@echo off\r\necho shim %1\r\n');
    } else {
      writeFileSync(join(scratch, 'fake-tool'), '#!/bin/sh\necho shim "$1"\n');
      chmodSync(join(scratch, 'fake-tool'), 0o755);
    }
    const runner = createProcessRunner({ env: envWithPath(scratch) });

    const result = await runner.run('fake-tool', ['hello']);

    expect(result).toMatchObject({ found: true, exitCode: 0 });
    expect(result.found && result.stdout.trim()).toBe('shim hello');
  });

  it('stops a command that outlives the time limit and reports no exit code', async () => {
    const runner = createProcessRunner({ env: envWithPath(nodeDirectory), timeoutMs: 200 });

    const result = await runner.run('node', ['-e', 'setTimeout(() => {}, 10000)']);

    expect(result).toMatchObject({ found: true, exitCode: null });
  });
});
