import { exec, execFile } from 'node:child_process';
import { statSync } from 'node:fs';
import { homedir } from 'node:os';
import { posix, win32 } from 'node:path';

/** What running a command gave: not found at all, or how it ended. `exitCode` is null when it was stopped. */
export type RunResult = { found: false } | { found: true; exitCode: number | null; stdout: string; stderr: string };

/** The one way the tools feature runs a command; tests swap in a fake so no real tool ever runs. */
export interface ProcessRunner {
  run(command: string, args: readonly string[]): Promise<RunResult>;
}

type Env = Record<string, string | undefined>;

export interface SearchOptions {
  platform: NodeJS.Platform;
  env: Env;
  home: string;
  isFile: (path: string) => boolean;
}

const DEFAULT_PATHEXT = '.COM;.EXE;.BAT;.CMD';
/** A script shim that Windows runs only through its command interpreter (npm installs these). */
const WINDOWS_SCRIPT = /\.(cmd|bat)$/i;
/** Long enough for a slow first start of a tool; short enough that a hung tool never blocks setup. */
const DEFAULT_TIMEOUT_MS = 15_000;

function pathKey(env: Env): string {
  return Object.keys(env).find((key) => key.toUpperCase() === 'PATH') ?? 'PATH';
}

function pathSeparator(platform: NodeJS.Platform): string {
  return platform === 'win32' ? ';' : ':';
}

/**
 * Where an installer puts a tool even when this process's PATH does not say so yet: an app started
 * from the Mac Finder gets a short PATH, and on Windows the PATH Grillo started with predates any
 * install the member does while Grillo is open (before pressing "Check again").
 */
function installFolders(platform: NodeJS.Platform, env: Env, home: string): string[] {
  if (platform === 'win32') {
    const folders = [win32.join(home, '.local', 'bin')];
    if (env['ProgramFiles']) folders.push(win32.join(env['ProgramFiles'], 'GitHub CLI'));
    if (env['LOCALAPPDATA']) folders.push(win32.join(env['LOCALAPPDATA'], 'Microsoft', 'WinGet', 'Links'));
    return folders;
  }
  return ['/opt/homebrew/bin', '/usr/local/bin', posix.join(home, '.local', 'bin')];
}

/** PATH first, in order, then the install folders it lacks. */
export function searchDirectories(platform: NodeJS.Platform, env: Env, home: string): string[] {
  const onPath = (env[pathKey(env)] ?? '').split(pathSeparator(platform)).filter((directory) => directory !== '');
  return [...new Set([...onPath, ...installFolders(platform, env, home)])];
}

/** The full path of the program `name` would start, or null when no search directory has it. */
export function findExecutable(name: string, { platform, env, home, isFile }: SearchOptions): string | null {
  const join = platform === 'win32' ? win32.join : posix.join;
  const extensions = platform === 'win32' ? (env['PATHEXT'] ?? DEFAULT_PATHEXT).split(';').filter(Boolean) : [''];
  for (const directory of searchDirectories(platform, env, home)) {
    for (const extension of extensions) {
      const candidate = join(directory, `${name}${extension}`);
      if (isFile(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}

/** Characters the Windows command interpreter would act on rather than pass to the script. */
const CMD_SPECIAL = /["%^&|<>!]/;

/**
 * The command line for a `.cmd` shim, which only the command interpreter can run. The arguments are
 * the fixed ones this feature passes, never user input; anything the interpreter would act on is refused.
 */
function windowsCommandLine(file: string, args: readonly string[]): string {
  const parts = [file, ...args];
  if (parts.some((part) => CMD_SPECIAL.test(part))) {
    throw new Error(`Refusing to run '${parts.join(' ')}' through the Windows command interpreter`);
  }
  return parts.map((part) => (/\s/.test(part) ? `"${part}"` : part)).join(' ');
}

function isFileOnDisk(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

export interface ProcessRunnerOptions {
  env?: Env;
  timeoutMs?: number;
}

/** Runs real commands. It finds them first, so "not installed" is a plain answer rather than a spawn error. */
export function createProcessRunner({
  env = process.env,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: ProcessRunnerOptions = {}): ProcessRunner {
  const platform = process.platform;
  const home = homedir();
  // The tool may start helpers of its own, so it gets the same search directories.
  const childEnv = { ...env, [pathKey(env)]: searchDirectories(platform, env, home).join(pathSeparator(platform)) };

  return {
    run(command, args) {
      const file = findExecutable(command, { platform, env, home, isFile: isFileOnDisk });
      if (!file) {
        return Promise.resolve({ found: false });
      }
      const options = { env: childEnv, timeout: timeoutMs, windowsHide: true, encoding: 'utf8' as const };
      return new Promise((resolve) => {
        const done = (error: { code?: unknown } | null, stdout: string, stderr: string): void => {
          const code = error ? error.code : 0;
          resolve({ found: true, exitCode: typeof code === 'number' ? code : null, stdout, stderr });
        };
        if (platform === 'win32' && WINDOWS_SCRIPT.test(file)) {
          exec(windowsCommandLine(file, args), options, done);
        } else {
          execFile(file, args, options, done);
        }
      });
    },
  };
}
