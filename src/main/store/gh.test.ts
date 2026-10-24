import { describe, expect, it } from 'vitest';
import { createGh, GhError, runProcess, type ProcessRunner, type RunResult } from './gh';
import { StoreError } from './store';

interface Call {
  command: string;
  args: readonly string[];
  env: Record<string, string> | undefined;
}

function fakeRunner(result: RunResult | Error): { runner: ProcessRunner; calls: Call[] } {
  const calls: Call[] = [];
  const runner: ProcessRunner = async (command, args, options) => {
    calls.push({ command, args, env: options?.env });
    if (result instanceof Error) {
      throw result;
    }
    return result;
  };
  return { runner, calls };
}

function ok(stdout: string): RunResult {
  return { exitCode: 0, stdout, stderr: '' };
}

const parseLogin = (value: unknown): string => {
  const login = (value as { login?: unknown } | null)?.login;
  if (typeof login !== 'string') {
    throw new Error('no login');
  }
  return login;
};

async function ghFailure(promise: Promise<unknown>): Promise<GhError> {
  const error = await promise.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(GhError);
  return error as GhError;
}

function missingProgram(): Error {
  return Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' });
}

describe('gh runner', () => {
  it('runs gh with prompts disabled and returns the parsed, typed JSON', async () => {
    const { runner, calls } = fakeRunner(ok('{"login":"ada-example"}\n'));

    const login = await createGh(runner).json(['api', 'user'], parseLogin);

    expect(login).toBe('ada-example');
    expect(calls).toEqual([{ command: 'gh', args: ['api', 'user'], env: { GH_PROMPT_DISABLED: '1' } }]);
  });

  it('returns plain output as text', async () => {
    const { runner } = fakeRunner(ok('main\n'));

    await expect(createGh(runner).text(['repo', 'view', '--json', 'name'])).resolves.toBe('main\n');
  });

  it.each([
    ['empty output', ''],
    ['text that is not JSON', 'Logged in to github.com'],
    ['cut-off JSON', '{"login":'],
    ['JSON null', 'null'],
    ['JSON of the wrong shape', '{"login":42}'],
  ])('refuses %s as invalid output', async (_case, stdout) => {
    const { runner } = fakeRunner(ok(stdout));

    const error = await ghFailure(createGh(runner).json(['api', 'user'], parseLogin));

    expect(error.reason).toBe('invalid-output');
  });

  it.each([
    ['gh is not installed', missingProgram(), 'not-installed'],
    ['gh exits with its authentication code', { exitCode: 4, stdout: '', stderr: 'auth required' }, 'not-signed-in'],
    [
      'gh asks for a sign-in',
      { exitCode: 1, stdout: '', stderr: 'To get started with GitHub CLI, please run:  gh auth login' },
      'not-signed-in',
    ],
    ['the API refuses', { exitCode: 1, stdout: '', stderr: 'HTTP 404: Not Found' }, 'api-error'],
    ['gh cannot start', Object.assign(new Error('spawn gh EACCES'), { code: 'EACCES' }), 'api-error'],
  ] as const)('reports "%s" as a typed error', async (_case, result, reason) => {
    const { runner } = fakeRunner(result);

    const error = await ghFailure(createGh(runner).text(['api', 'user']));

    expect(error.reason).toBe(reason);
  });

  it('keeps the exit code and the error output, and is the one error type store callers handle', async () => {
    const { runner } = fakeRunner({ exitCode: 1, stdout: '', stderr: 'HTTP 404: Not Found\n' });

    const error = await ghFailure(createGh(runner).text(['api', 'repos/example-org/missing']));

    expect(error).toBeInstanceOf(StoreError);
    expect(error.kind).toBe('backend');
    expect(error.exitCode).toBe(1);
    expect(error.stderr).toBe('HTTP 404: Not Found\n');
    expect(error.message).toContain('HTTP 404: Not Found');
  });
});

describe('the real process runner', () => {
  it('captures output, exit code and stdin of a real program run without a shell', async () => {
    const script = 'process.stdin.pipe(process.stdout); process.stderr.write("warn"); process.exitCode = 3;';

    const result = await runProcess(process.execPath, ['-e', script], { input: 'hello & "quoted"' });

    expect(result).toEqual({ exitCode: 3, stdout: 'hello & "quoted"', stderr: 'warn' });
  });

  it('passes extra environment variables and rejects with ENOENT for a missing program', async () => {
    const result = await runProcess(process.execPath, ['-e', 'process.stdout.write(process.env.GRILLO_TEST ?? "")'], {
      env: { GRILLO_TEST: 'set' },
    });
    expect(result.stdout).toBe('set');

    await expect(runProcess('grillo-no-such-program', [])).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
