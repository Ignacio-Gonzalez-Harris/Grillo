import { statSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import { spawn } from 'node-pty';
import type { FeatureContext } from '../../app/features';
import { registerAgentChannels } from './channels';
import { findClaude, type AgentRuntime } from './runtime';
import { shipSkills } from './ship-skills';

/** The terminal type Claude Code is told it runs in; xterm.js in the renderer understands it. */
const TERMINAL_NAME = 'xterm-256color';

function isFile(path: string): boolean {
  return statSync(path, { throwIfNoEntry: false })?.isFile() ?? false;
}

/** `resources/skills/` in the repository while developing; the same folder beside the installed app. */
function skillsSourceDir(): string {
  return app.isPackaged ? join(process.resourcesPath, 'skills') : join(app.getAppPath(), 'resources', 'skills');
}

let appRuntime: AgentRuntime | undefined;

/** The app's one agent runtime, for a feature that types into agents (the live session). Set once agents register. */
export function appAgentRuntime(): AgentRuntime {
  if (appRuntime === undefined) throw new Error('The agent runtime has not started yet');
  return appRuntime;
}

export function register({ ipc }: FeatureContext): void {
  const runtime = registerAgentChannels(ipc, {
    findClaude: () => findClaude(process.env, process.platform, isFile),
    shipSkills: (folder) => shipSkills({ sourceDir: skillsSourceDir(), folder, warn: console.warn }),
    spawnPty: (file, args, options) => spawn(file, args, { ...options, name: TERMINAL_NAME }),
    env: process.env,
  });
  appRuntime = runtime;
  app.on('will-quit', () => runtime.stopAll());
}
