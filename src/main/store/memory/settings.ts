import type { Settings } from '../../app/settings';

/** Settings kept in memory only: what the in-memory store uses when no settings file is given. */
export function createMemorySettings(): Settings {
  const values = new Map<string, unknown>();
  return {
    get: (key, defaultValue) => (values.has(key) ? structuredClone(values.get(key)) : defaultValue) as typeof defaultValue,
    set: (key, value) => {
      values.set(key, structuredClone(value));
    },
  };
}
