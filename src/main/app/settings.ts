import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** The one settings file, kept in the app data folder (`app.getPath('userData')`). */
export const SETTINGS_FILE_NAME = 'settings.json';

/** Values must survive a JSON round trip. */
export interface Settings {
  get<T>(key: string, defaultValue: T): T;
  set<T>(key: string, value: T): void;
}

type Values = Record<string, unknown>;

function isValues(parsed: unknown): parsed is Values {
  return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed);
}

/**
 * Reads the file once. A missing file means "all defaults". A corrupt file also means "all
 * defaults", and a copy of it is kept beside it as `<file>.corrupt` before the next write replaces it.
 */
function readValues(filePath: string): Values {
  if (!existsSync(filePath)) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf8'));
    if (isValues(parsed)) {
      return parsed;
    }
  } catch {
    // Unreadable JSON is handled like any other corrupt content below.
  }
  copyFileSync(filePath, `${filePath}.corrupt`);
  return {};
}

/** Writes to a temporary file first, so a crash mid-write never leaves a half-written settings file. */
function writeValues(filePath: string, values: Values): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(values, null, 2)}\n`, 'utf8');
  renameSync(temporaryPath, filePath);
}

export function createSettings(filePath: string): Settings {
  const values = readValues(filePath);
  return {
    get(key, defaultValue) {
      return Object.hasOwn(values, key) ?(values[key] as typeof defaultValue) : defaultValue;
    },
    set(key, value) {
      values[key] = value;
      writeValues(filePath, values);
    },
  };
}
