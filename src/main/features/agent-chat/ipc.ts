import { spawn } from 'node:child_process';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import type { FeatureContext } from '../../app/features';
import { findClaude } from '../agents/runtime';
import { shipSkills } from '../agents/ship-skills';
import { registerAgentChatChannels } from './channels';
import type { ChatProcess, SpawnChatProcess } from './driver';

/** A script shim (npm installs `claude.cmd`) that Windows starts only through its command interpreter. */
const WINDOWS_SCRIPT = /\.(cmd|bat)$/i;

function isFile(path: string): boolean {
  return statSync(path, { throwIfNoEntry: false })?.isFile() ?? false;
}

/** `resources/skills/` in the repository while developing; the same folder beside the installed app. */
function skillsSourceDir(): string {
  return app.isPackaged ? join(process.resourcesPath, 'skills') : join(app.getAppPath(), 'resources', 'skills');
}

/**
 * Starts `claude` with piped stdin and stdout. The arguments are the driver's fixed flags, never member input (the
 * messages go through stdin), so a `.cmd` shim may run through the shell with only its path quoted.
 */
const spawnChatProcess: SpawnChatProcess = (file, args, { cwd, env }) => {
  const viaShell = process.platform === 'win32' && WINDOWS_SCRIPT.test(file);
  const child = spawn(viaShell ? `"${file}"` : file, [...args], {
    cwd,
    env,
    shell: viaShell,
    stdio: ['pipe', 'pipe', 'ignore'],
    windowsHide: true,
  });
  child.stdout.setEncoding('utf8');
  // Writing after the process ended fails with EPIPE; the exit listener already reports the end.
  child.stdin.on('error', () => undefined);

  const exitListeners: Array<(exitCode: number | null) => void> = [];
  let ended = false;
  const end = (exitCode: number | null): void => {
    if (ended) return;
    ended = true;
    exitListeners.forEach((listener) => listener(exitCode));
  };
  child.on('exit', (code) => end(code));
  child.on('error', () => end(null));

  const chatProcess: ChatProcess = {
    onStdout: (listener) => child.stdout.on('data', listener),
    onExit: (listener) => exitListeners.push(listener),
    write: (data) => child.stdin.write(data),
    stop: () => {
      child.stdin.end();
      child.kill();
    },
  };
  return chatProcess;
};

export function register({ ipc }: FeatureContext): void {
  const driver = registerAgentChatChannels(ipc, {
    findClaude: () => findClaude(process.env, process.platform, isFile),
    shipSkills: (folder) => shipSkills({ sourceDir: skillsSourceDir(), folder, warn: console.warn }),
    spawnProcess: spawnChatProcess,
    env: process.env,
  });
  app.on('will-quit', () => driver.stopAll());
}
