import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultUserDataFolder } from './model';

describe('default app data folder', () => {
  const homeFolder = join('/made-up', 'home', 'ana');

  it.each([
    ['win32', { APPDATA: join('/made-up', 'roaming') }, join('/made-up', 'roaming', 'Grillo')],
    ['win32', {}, join(homeFolder, 'AppData', 'Roaming', 'Grillo')],
    ['darwin', {}, join(homeFolder, 'Library', 'Application Support', 'Grillo')],
    ['linux', {}, join(homeFolder, '.config', 'Grillo')],
  ] as const)('matches Electron on %s (%j)', (platform, env, expected) => {
    expect(defaultUserDataFolder({ platform, env, homeFolder })).toBe(expected);
  });
});
