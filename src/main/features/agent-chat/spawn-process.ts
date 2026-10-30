import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptions } from 'node:child_process';
import type { ChatProcess, SpawnChatProcess } from './driver';

/** A script shim (npm installs `claude.cmd`) that Windows starts only through its command interpreter. */
const WINDOWS_SCRIPT = /\.(cmd|bat)$/i;

/** The part of Node's `spawn` used here; tests pass a fake child. */
export type SpawnChild = (file: string, args: string[], options: SpawnOptions) => ChildProcessWithoutNullStreams;

/**
 * Starts `claude` with piped stdin, stdout and stderr (its own error text, which says why it failed to start). The arguments are the driver's fixed flags, never member input (the
 * messages go through stdin), so a `.cmd` shim may run through the shell with only its path quoted.
 */
export function createSpawnChatProcess(
  spawnChild: SpawnChild = spawn as unknown as SpawnChild,
  platform: NodeJS.Platform = process.platform,
): SpawnChatProcess {
  return (file, args, { cwd, env }) => {
    const viaShell = platform === 'win32' && WINDOWS_SCRIPT.test(file);
    const child = spawnChild(viaShell ? `"${file}"` : file, [...args], {
      cwd,
      env,
      shell: viaShell,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    // Always read the error text, listened to or not: a full pipe would stall Claude Code.
    const errorListeners: Array<(chunk: string) => void> = [];
    const errorText = (chunk: string): void => errorListeners.forEach((listener) => listener(chunk));
    child.stderr.on('data', errorText);
    // Writing after the process ended fails with EPIPE; the exit listener already reports the end.
    child.stdin.on('error', () => undefined);

    const exitListeners: Array<(exitCode: number | null) => void> = [];
    let ended = false;
    const end = (exitCode: number | null): void => {
      if (ended) return;
      ended = true;
      exitListeners.forEach((listener) => listener(exitCode));
    };
    // `close`, not `exit`: the last stdout line can arrive after the process has exited, and `close` waits for it.
    child.on('close', (code: number | null) => end(code));
    // A process that could not start has no error text of its own: Node's reason stands in for it.
    child.on('error', (error: Error) => {
      if (!ended) errorText(`${error.message}\n`);
      end(null);
    });

    const chatProcess: ChatProcess = {
      onStdout: (listener) => child.stdout.on('data', listener),
      onStderr: (listener) => errorListeners.push(listener),
      onExit: (listener) => exitListeners.push(listener),
      write: (data) => child.stdin.write(data),
      stop: () => {
        child.stdin.end();
        child.kill();
      },
    };
    return chatProcess;
  };
}
