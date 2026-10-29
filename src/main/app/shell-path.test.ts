import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LOGIN_SHELL_TIME_LIMIT_MS,
  MAX_SHELL_OUTPUT_CHARS,
  PATH_END_MARKER,
  PATH_START_MARKER,
  repairPathFromLoginShell,
  type ShellResult,
  type ShellRunner,
} from './shell-path';

const LAUNCHD_PATH = '/usr/bin:/bin:/usr/sbin:/sbin';
const LOGIN_PATH = [
  '/Users/sample/.local/bin',
  '/opt/homebrew/bin',
  '/Users/sample/.nvm/versions/node/v24.4.1/bin',
  '/usr/local/bin',
  '/usr/bin',
  '/bin',
  '/usr/sbin',
  '/sbin',
].join(':');

function printed(path: string): string {
  return `${PATH_START_MARKER}\n${path}\n${PATH_END_MARKER}\n`;
}

function shellAnswering(result: ShellResult): ShellRunner & ReturnType<typeof vi.fn> {
  return vi.fn(async () => result);
}

function repair(options: { platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv; runShell: ShellRunner }) {
  const env = options.env ?? { PATH: LAUNCHD_PATH, SHELL: '/bin/zsh' };
  const warn = vi.fn();
  const done = repairPathFromLoginShell({
    platform: options.platform ?? 'darwin',
    env,
    runShell: options.runShell,
    warn,
  });
  return { env, warn, done };
}

describe('repairPathFromLoginShell', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('on macOS merges the login shell PATH in front of the launchd PATH, once each', async () => {
    const runShell = shellAnswering({ exitCode: 0, stdout: printed(LOGIN_PATH) });
    const { env, warn, done } = repair({ runShell });
    await done;

    expect(env.PATH).toBe(LOGIN_PATH);
    expect(warn).not.toHaveBeenCalled();
  });

  it('keeps an inherited entry the login shell lacks, after the login shell entries', async () => {
    const runShell = shellAnswering({ exitCode: 0, stdout: printed('/opt/homebrew/bin:/usr/bin') });
    const { env, done } = repair({ runShell, env: { PATH: '/usr/bin:/Applications/Sample.app/bin', SHELL: '/bin/zsh' } });
    await done;

    expect(env.PATH).toBe('/opt/homebrew/bin:/usr/bin:/Applications/Sample.app/bin');
  });

  it('ignores what rc files print around the markers, drops duplicates, empty and relative entries', async () => {
    const stdout = [
      'Welcome back, sample!',
      'Last login: Thu Oct 29 09:00:00 on ttys001',
      PATH_START_MARKER,
      '/opt/homebrew/bin::/opt/homebrew/bin:.:bin:/Users/sample/.volta/bin:',
      PATH_END_MARKER,
      'logout banner',
    ].join('\n');
    const runShell = shellAnswering({ exitCode: 0, stdout });
    const { env, warn, done } = repair({ runShell });
    await done;

    expect(env.PATH).toBe(`/opt/homebrew/bin:/Users/sample/.volta/bin:${LAUNCHD_PATH}`);
    expect(warn).not.toHaveBeenCalled();
  });

  it('asks the member login shell, interactive and login, to print PATH between the markers', async () => {
    const runShell = shellAnswering({ exitCode: 0, stdout: printed(LOGIN_PATH) });
    const { done } = repair({ runShell, env: { PATH: LAUNCHD_PATH, SHELL: '/opt/homebrew/bin/fish' } });
    await done;

    expect(runShell).toHaveBeenCalledTimes(1);
    const [shell, args, options] = runShell.mock.calls[0];
    expect(shell).toBe('/opt/homebrew/bin/fish');
    expect(args[0]).toBe('-ilc');
    expect(args[1]).toContain(PATH_START_MARKER);
    expect(args[1]).toContain(PATH_END_MARKER);
    expect(options.timeoutMs).toBe(LOGIN_SHELL_TIME_LIMIT_MS);
  });

  it.each([
    ['unset', undefined],
    ['empty', ''],
    ['not an absolute path', 'zsh'],
  ])('falls back to /bin/zsh when SHELL is %s', async (_case, shellVariable) => {
    const runShell = shellAnswering({ exitCode: 0, stdout: printed(LOGIN_PATH) });
    const { env, done } = repair({ runShell, env: { PATH: LAUNCHD_PATH, SHELL: shellVariable } });
    await done;

    expect(runShell.mock.calls[0][0]).toBe('/bin/zsh');
    expect(env.PATH).toBe(LOGIN_PATH);
  });

  it('fills PATH when Grillo inherited none at all', async () => {
    const runShell = shellAnswering({ exitCode: 0, stdout: printed('/opt/homebrew/bin:/usr/bin') });
    const { env, done } = repair({ runShell, env: { SHELL: '/bin/zsh' } });
    await done;

    expect(env.PATH).toBe('/opt/homebrew/bin:/usr/bin');
  });

  const veryLong = `${PATH_START_MARKER}\n/opt/homebrew/bin${':/x'.repeat(MAX_SHELL_OUTPUT_CHARS)}\n${PATH_END_MARKER}`;
  const failures: Array<[string, () => Promise<ShellResult>]> = [
    ['exits non-zero', async () => ({ exitCode: 1, stdout: printed(LOGIN_PATH) })],
    ['is killed by its time limit', async () => ({ exitCode: null, stdout: '' })],
    ['cannot start', async () => Promise.reject(new Error('spawn /bin/zsh ENOENT'))],
    ['prints nothing', async () => ({ exitCode: 0, stdout: '' })],
    ['prints no marker', async () => ({ exitCode: 0, stdout: 'Welcome back!\n' })],
    ['prints the start marker only', async () => ({ exitCode: 0, stdout: `${PATH_START_MARKER}\n/opt/homebrew/bin\n` })],
    ['prints the end marker before the start', async () => ({ exitCode: 0, stdout: `${PATH_END_MARKER}\n/opt/homebrew/bin\n${PATH_START_MARKER}` })],
    ['prints the markers twice', async () => ({ exitCode: 0, stdout: printed('/a/bin') + printed('/b/bin') })],
    ['prints an empty PATH', async () => ({ exitCode: 0, stdout: printed('') })],
    ['prints garbage with no absolute folder', async () => ({ exitCode: 0, stdout: printed('not a path at all') })],
    ['prints a PATH over several lines', async () => ({ exitCode: 0, stdout: printed('/opt/homebrew/bin\n/usr/bin') })],
    ['prints a NUL character', async () => ({ exitCode: 0, stdout: printed('/opt/home\0brew/bin') })],
    ['prints very long output', async () => ({ exitCode: 0, stdout: veryLong })],
    ['answers something that is not a result', async () => null as unknown as ShellResult],
  ];

  it.each(failures)(
    'leaves PATH unchanged and warns once when the login shell %s',
    async (_case, answer) => {
      const { env, warn, done } = repair({ runShell: vi.fn(answer) });
      await done;

      expect(env.PATH).toBe(LAUNCHD_PATH);
      expect(warn).toHaveBeenCalledTimes(1);
    },
  );

  it('never waits past its time limit for a shell that hangs, then leaves PATH unchanged and warns once', async () => {
    vi.useFakeTimers();
    const neverAnswers: ShellRunner = () => new Promise<ShellResult>(() => {});
    const { env, warn, done } = repair({ runShell: neverAnswers });
    let finished = false;
    void done.then(() => {
      finished = true;
    });

    await vi.advanceTimersByTimeAsync(LOGIN_SHELL_TIME_LIMIT_MS);

    expect(finished).toBe(true);
    expect(env.PATH).toBe(LAUNCHD_PATH);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it.each(['win32', 'linux'] as const)('changes nothing and starts no shell on %s', async (platform) => {
    const runShell = shellAnswering({ exitCode: 0, stdout: printed(LOGIN_PATH) });
    const env = { PATH: 'C:\\Windows\\system32;C:\\Users\\sample\\.local\\bin', SHELL: '/bin/zsh' };
    const { warn, done } = repair({ platform, runShell, env });
    await done;

    expect(runShell).not.toHaveBeenCalled();
    expect(env.PATH).toBe('C:\\Windows\\system32;C:\\Users\\sample\\.local\\bin');
    expect(warn).not.toHaveBeenCalled();
  });
});
