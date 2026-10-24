import { describe, expect, it } from 'vitest';
import type { Gh } from './gh';
import { createStore, storeKindFrom } from '.';
import { ISSUES_METHODS } from './github/issues';
import { REPO_METHODS } from './github/repo';
import { createMemorySettings } from './memory/settings';
import { STORE_METHODS, StoreError } from './store';

const unusedGh: Gh = {
  text: () => Promise.reject(new Error('gh must not run')),
  json: () => Promise.reject(new Error('gh must not run')),
};

describe('store factory', () => {
  it('creates a working in-memory store', async () => {
    const store = createStore('memory', { settings: createMemorySettings(), gh: unusedGh });

    await store.createProject({ newRepository: { organisation: 'example-org', name: 'demo' } });

    expect((await store.listProjects()).map((project) => project.id)).toEqual(['example-org/demo']);
  });

  it('composes the GitHub store from the repository and issues stubs, every method refusing as not implemented', async () => {
    const store = createStore('github', { settings: createMemorySettings(), gh: unusedGh });

    for (const method of STORE_METHODS) {
      const error = await (store[method] as () => Promise<unknown>)().catch((thrown: unknown) => thrown);
      expect(error, method).toBeInstanceOf(StoreError);
      expect(error, method).toMatchObject({ kind: 'not-implemented', message: expect.stringContaining('not implemented') });
    }
  });

  it('splits every store method between the two GitHub backends, each exactly once', () => {
    expect([...REPO_METHODS, ...ISSUES_METHODS].sort()).toEqual([...STORE_METHODS].sort());
  });

  it.each([
    [undefined, 'github'],
    ['', 'github'],
    ['github', 'github'],
    ['memory', 'memory'],
  ] as const)('reads GRILLO_STORE=%s as the %s store', (value, kind) => {
    expect(storeKindFrom({ GRILLO_STORE: value })).toBe(kind);
  });

  it('refuses an unknown GRILLO_STORE value by name', () => {
    expect(() => storeKindFrom({ GRILLO_STORE: 'Memory' })).toThrow("GRILLO_STORE must be 'memory' or 'github', got 'Memory'");
  });
});
