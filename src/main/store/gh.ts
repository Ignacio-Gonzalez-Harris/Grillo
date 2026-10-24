import { spawn } from 'node:child_process';
import { StoreError } from './store';

export interface RunOptions {
  cwd?: string;
  /** Written to the program's standard input, which is then closed. */
  input?: string;
  /** Added to the app's own environment. */
  env?: Record<string, string>;
}

export interface RunResult {
  /** Null when the program was ended by a signal. */
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Runs a program with its arguments, never through a shell, and resolves once it ends whatever its exit
 * code. Rejects with an error whose `code` is `ENOENT` when the program is not installed.
 */
export type ProcessRunner = (command: string, args: readonly string[], options?: RunOptions) => Promise<RunResult>;

export const runProcess: ProcessRunner = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      shell: false,
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
    child.on('error', reject);
    // A program that exits without reading its input breaks the pipe; its exit code already says what happened.
    child.stdin.on('error', () => undefined);
    child.on('close', (exitCode) => resolve({ exitCode, stdout, stderr }));
    child.stdin.end(options.input ?? '');
  });

export type GhErrorReason = 'not-installed' | 'not-signed-in' | 'api-error' | 'invalid-output';

/** A failed `gh` call. A `StoreError` of kind `backend`, so store callers still handle one error type. */
export class GhError extends StoreError {
  readonly reason: GhErrorReason;
  readonly exitCode: number | null;
  readonly stderr: string;

  constructor(reason: GhErrorReason, message: string, exitCode: number | null = null, stderr = '') {
    super('backend', message);
    this.name = 'GhError';
    this.reason = reason;
    this.exitCode = exitCode;
    this.stderr = stderr;
  }
}

/** Runs the GitHub CLI. Every failure is a `GhError`. */
export interface Gh {
  /** Returns standard output as text. */
  text(args: readonly string[], options?: RunOptions): Promise<string>;
  /** Parses standard output as JSON and hands it to `parse`, which returns the typed result or throws. */
  json<T>(args: readonly string[], parse: (value: unknown) => T, options?: RunOptions): Promise<T>;
}

const GH = 'gh';
/** gh's documented exit code for "this command requires authentication". */
const GH_AUTH_REQUIRED_EXIT_CODE = 4;
const SIGN_IN_HINT = /gh auth login/i;
/** gh must never wait for an answer nobody can type. */
const GH_ENV = { GH_PROMPT_DISABLED: '1' };

function startFailure(error: unknown): GhError {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === 'ENOENT') {
    return new GhError('not-installed', 'The GitHub CLI (gh) is not installed or not on PATH');
  }
  return new GhError('api-error', `The GitHub CLI (gh) could not start: ${String(error)}`);
}

function exitFailure(args: readonly string[], { exitCode, stderr }: RunResult): GhError {
  if (exitCode === GH_AUTH_REQUIRED_EXIT_CODE || SIGN_IN_HINT.test(stderr)) {
    return new GhError('not-signed-in', 'The GitHub CLI (gh) is not signed in: run gh auth login', exitCode, stderr);
  }
  return new GhError('api-error', `gh ${args.join(' ')} failed: ${stderr.trim()}`, exitCode, stderr);
}

export function createGh(runner: ProcessRunner = runProcess): Gh {
  async function text(args: readonly string[], options: RunOptions = {}): Promise<string> {
    let result: RunResult;
    try {
      result = await runner(GH, args, { ...options, env: { ...options.env, ...GH_ENV } });
    } catch (error) {
      throw startFailure(error);
    }
    if (result.exitCode !== 0) {
      throw exitFailure(args, result);
    }
    return result.stdout;
  }

  return {
    text,
    async json(args, parse, options) {
      const stdout = await text(args, options);
      try {
        return parse(JSON.parse(stdout));
      } catch (error) {
        throw new GhError('invalid-output', `gh ${args.join(' ')} returned unexpected output: ${String(error)}`);
      }
    },
  };
}
