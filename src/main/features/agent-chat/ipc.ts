import { statSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import type { FeatureContext } from '../../app/features';
import { findClaude } from '../agents/runtime';
import { shipSkills } from '../agents/ship-skills';
import { registerAgentChatChannels } from './channels';
import { createSpawnChatProcess } from './spawn-process';

function isFile(path: string): boolean {
  return statSync(path, { throwIfNoEntry: false })?.isFile() ?? false;
}

/** `resources/skills/` in the repository while developing; the same folder beside the installed app. */
function skillsSourceDir(): string {
  return app.isPackaged ? join(process.resourcesPath, 'skills') : join(app.getAppPath(), 'resources', 'skills');
}

export function register({ ipc }: FeatureContext): void {
  const driver = registerAgentChatChannels(ipc, {
    findClaude: () => findClaude(process.env, process.platform, isFile),
    shipSkills: (folder) => shipSkills({ sourceDir: skillsSourceDir(), folder, warn: console.warn }),
    spawnProcess: createSpawnChatProcess(),
    env: process.env,
  });
  app.on('will-quit', () => driver.stopAll());
}
