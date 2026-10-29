import { statSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import type { Unsubscribe } from '../../../shared/ipc';
import type { FeatureContext } from '../../app/features';
import { findClaude } from '../agents/runtime';
import { shipSkills } from '../agents/ship-skills';
import { registerAgentChatChannels } from './channels';
import type { ChatDriver, ChatDriverEvents } from './driver';
import { createChatEventHub } from './event-hub';
import { createSpawnChatProcess } from './spawn-process';

function isFile(path: string): boolean {
  return statSync(path, { throwIfNoEntry: false })?.isFile() ?? false;
}

/** `resources/skills/` in the repository while developing; the same folder beside the installed app. */
function skillsSourceDir(): string {
  return app.isPackaged ? join(process.resourcesPath, 'skills') : join(app.getAppPath(), 'resources', 'skills');
}

const hub = createChatEventHub();
let appDriver: ChatDriver | undefined;

/** The app's one chat driver, which the agent runtime starts its chat tabs on. Set once agent chat registers. */
export function appChatDriver(): ChatDriver {
  if (appDriver === undefined) throw new Error('The agent chat driver has not started yet');
  return appDriver;
}

/** Hears every event of the app's chat driver, whether or not it has started yet. */
export function observeAppChatDriver(listener: ChatDriverEvents): Unsubscribe {
  return hub.observe(listener);
}

export function register({ ipc }: FeatureContext): void {
  const driver = registerAgentChatChannels(
    ipc,
    {
      findClaude: () => findClaude(process.env, process.platform, isFile),
      shipSkills: (folder) => shipSkills({ sourceDir: skillsSourceDir(), folder, warn: console.warn }),
      spawnProcess: createSpawnChatProcess(),
      env: process.env,
    },
    hub.events,
  );
  appDriver = driver;
  app.on('will-quit', () => driver.stopAll());
}
