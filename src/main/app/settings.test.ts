import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSettings, SETTINGS_FILE_NAME } from './settings';

describe('settings', () => {
  let appDataFolder: string;
  let settingsFile: string;

  beforeEach(() => {
    appDataFolder = mkdtempSync(join(tmpdir(), 'grillo-settings-'));
    settingsFile = join(appDataFolder, SETTINGS_FILE_NAME);
  });

  afterEach(() => {
    rmSync(appDataFolder, { recursive: true, force: true });
  });

  it('returns the default when the settings file does not exist yet', () => {
    expect(createSettings(settingsFile).get('updates.mode', 'ask')).toBe('ask');
  });

  it.each(['constructor', 'toString', '__proto__', 'hasOwnProperty'])(
    'returns the default for a key never set, even one named like a built-in (%s)',
    (key) => {
      expect(createSettings(settingsFile).get(key, 'ask')).toBe('ask');
    },
  );

  it('keeps a value it was given across restarts', () => {
    createSettings(settingsFile).set('updates.mode', 'automatic');

    expect(createSettings(settingsFile).get('updates.mode', 'ask')).toBe('automatic');
  });

  it('creates the app data folder when it is missing', () => {
    const nestedFile = join(appDataFolder, 'not-yet-created', SETTINGS_FILE_NAME);

    createSettings(nestedFile).set('updates.mode', 'never');

    expect(JSON.parse(readFileSync(nestedFile, 'utf8'))).toEqual({ 'updates.mode': 'never' });
  });

  it.each([
    ['broken JSON', '{"updates.mode": '],
    ['JSON that is not an object', '["automatic"]'],
  ])('falls back to defaults on a corrupt file (%s) and keeps a copy of it', (_kind, corruptContent) => {
    writeFileSync(settingsFile, corruptContent);

    const settings = createSettings(settingsFile);
    expect(settings.get('updates.mode', 'ask')).toBe('ask');

    settings.set('updates.mode', 'never');
    expect(JSON.parse(readFileSync(settingsFile, 'utf8'))).toEqual({ 'updates.mode': 'never' });
    expect(readFileSync(`${settingsFile}.corrupt`, 'utf8')).toBe(corruptContent);
  });
});
