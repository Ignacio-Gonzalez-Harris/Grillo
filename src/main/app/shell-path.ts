import { spawn } from 'node:child_process';

/**
 * A Mac app opened from the Dock or Finder inherits launchd's short PATH (`/usr/bin:/bin:/usr/sbin:/sbin`), not the
 * one the member's Terminal builds in their shell start-up files. So at startup Grillo asks the member's login shell
 * for its PATH once and merges it into `process.env.PATH`, which every child process Grillo starts inherits.
 */

/** What a login shell answered: its exit code (null when it was killed) and what it printed. */
export interface ShellResult {
  exitCode: number | null;
  stdout: string;
}

/** Starts `shell` with `args` and resolves with what it printed; kills it after `timeoutMs`. */
export type ShellRunner = (
  shell: string,
  args: string[],
  options: { timeoutMs: number; env: NodeJS.ProcessEnv },
) => Promise<ShellResult>;

export const PATH_START_MARKER = '__GRILLO_PATH_START__';
export const PATH_END_MARKER = '__GRILLO_PATH_END__';
/** Start-up files that load a version manager (nvm) can take a second or two; a hung shell is given up on after this. */
export const LOGIN_SHELL_TIME_LIMIT_MS = 5000;
/** More output than this is not a PATH answer; the shell is stopped and its answer ignored. */
export const MAX_SHELL_OUTPUT_CHARS = 64 * 1024;
/** macOS's default login shell, used when SHELL is missing or not an absolute path. */
const FALLBACK_SHELL = '/bin/zsh';
const PATH_SEPARATOR = ':';

// One command every common login shell (zsh, bash, sh, fish) runs the same way: three lines, PATH in the middle.
const PRINT_PATH_COMMAND = `printf '%s\\n' ${PATH_START_MARKER} "$PATH" ${PATH_END_MARKER}`;
// Keeps oh-my-zsh from asking about an update, and its tmux plugin from taking over, while nobody can answer.
const QUIET_SHELL_ENV = { DISABLE_AUTO_UPDATE: 'true', ZSH_TMUX_AUTOSTARTED: 'true', ZSH_TMUX_AUTOSTART: 'false' };

class UnreadableAnswer extends Error {}

/** The folders between the markers, or an UnreadableAnswer naming what is wrong with the output. */
function pathFromOutput(stdout: string): string[] {
  if (stdout.length > MAX_SHELL_OUTPUT_CHARS) {
    throw new UnreadableAnswer(`it printed more than ${MAX_SHELL_OUTPUT_CHARS} characters`);
  }
  const lines = stdout.split(/\r?\n/);
  const start = lines.indexOf(PATH_START_MARKER);
  const end = lines.indexOf(PATH_END_MARKER);
  if (start === -1 || end === -1 || lines.lastIndexOf(PATH_START_MARKER) !== start || lines.lastIndexOf(PATH_END_MARKER) !== end) {
    throw new UnreadableAnswer('it did not print the PATH between the markers exactly once');
  }
  if (end !== start + 2) {
    throw new UnreadableAnswer('it did not print the PATH as one line between the markers');
  }
  const folders = lines[start + 1].split(PATH_SEPARATOR).filter(isAbsoluteFolder);
  if (folders.length === 0) {
    throw new UnreadableAnswer('its PATH held no absolute folder');
  }
  return folders;
}

// An empty or relative entry would make every child process look in its own working folder; never added.
function isAbsoluteFolder(entry: string): boolean {
  return entry.startsWith('/') && !entry.includes('\0');
}

/** The login shell's folders first, as in the member's Terminal, then any inherited folder it lacks; each once. */
function mergedPath(loginFolders: string[], inheritedPath: string | undefined): string {
  const inherited = (inheritedPath ?? '').split(PATH_SEPARATOR).filter((entry) => entry !== '');
  return [...new Set([...loginFolders, ...inherited])].join(PATH_SEPARATOR);
}

function loginShell(env: NodeJS.ProcessEnv): string {
  const shell = env['SHELL'];
  return shell?.startsWith('/') ? shell : FALLBACK_SHELL;
}

function giveUpAfter(timeoutMs: number): { expired: Promise<never>; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new UnreadableAnswer(`it did not answer within ${timeoutMs} ms`)), timeoutMs);
  });
  return { expired, cancel: () => clearTimeout(timer) };
}

/**
 * On macOS, merges the member's login-shell PATH into `env.PATH`. Any failure (the shell exits non-zero, hangs past
 * the time limit, cannot start or prints something unreadable) leaves `env.PATH` exactly as it was and calls `warn`
 * once. Never rejects, and never waits past the time limit. Elsewhere it does nothing: Windows already inherits the
 * user's PATH.
 */
export async function repairPathFromLoginShell(options: {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  runShell: ShellRunner;
  warn: (message: string) => void;
}): Promise<void> {
  const { platform, env, runShell, warn } = options;
  if (platform !== 'darwin') {
    return;
  }
  const shell = loginShell(env);
  const timeLimit = giveUpAfter(LOGIN_SHELL_TIME_LIMIT_MS);
  try {
    const answer = await Promise.race([
      runShell(shell, ['-ilc', PRINT_PATH_COMMAND], {
        timeoutMs: LOGIN_SHELL_TIME_LIMIT_MS,
        env: { ...env, ...QUIET_SHELL_ENV },
      }),
      timeLimit.expired,
    ]);
    if (answer?.exitCode !== 0) {
      throw new UnreadableAnswer(`it exited with ${answer?.exitCode ?? 'no code (it was stopped)'}`);
    }
    env['PATH'] = mergedPath(pathFromOutput(answer.stdout ?? ''), env['PATH']);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    warn(`Grillo kept the PATH it was started with: the login shell ${shell} could not give its PATH, because ${reason}.`);
  } finally {
    timeLimit.cancel();
  }
}

/** The real runner: starts the shell with no terminal attached, stops it at the time limit or on too much output. */
export const runLoginShell: ShellRunner = (shell, args, { timeoutMs, env }) =>
  new Promise((resolve, reject) => {
    const child = spawn(shell, args, {
      env,
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: timeoutMs,
      killSignal: 'SIGKILL',
    });
    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
      if (stdout.length > MAX_SHELL_OUTPUT_CHARS) {
        child.kill('SIGKILL');
      }
    });
    child.on('error', reject);
    child.on('close', (exitCode) => resolve({ exitCode, stdout }));
  });
