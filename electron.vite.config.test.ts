import { describe, expect, it } from 'vitest';
import { DEFAULT_DEV_PORT, devPort } from './electron.vite.config.mjs';

describe('dev server port', () => {
  it('uses 5173 when GRILLO_DEV_PORT is not set', () => {
    expect(devPort({})).toBe(DEFAULT_DEV_PORT);
    expect(DEFAULT_DEV_PORT).toBe(5173);
  });

  it('uses the port GRILLO_DEV_PORT names', () => {
    expect(devPort({ GRILLO_DEV_PORT: '5229' })).toBe(5229);
  });

  it.each(['abc', '0', '70000', '51.5'])('refuses a GRILLO_DEV_PORT that is not a port (%s)', (value) => {
    expect(() => devPort({ GRILLO_DEV_PORT: value })).toThrow('GRILLO_DEV_PORT must be a port number');
  });
});
