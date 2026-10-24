import { describe, expect, it } from 'vitest';
import { createGrilloApi } from '../../preload/bridge';
import { createMainIpc } from '../ipc/bridge';
import { createFakeIpc } from '../ipc/fake-ipc';
import { loadFeatures, registerFeatures, type FeatureContext } from './features';
import type { Settings } from './settings';

const unusedSettings: Settings = {
  get: (_key, defaultValue) => defaultValue,
  set: () => undefined,
};

function featureContext() {
  const fake = createFakeIpc();
  const context: FeatureContext = { ipc: createMainIpc(fake.main, () => [fake.window]), settings: unusedSettings };
  return { context, grillo: createGrilloApi(fake.renderer) };
}

describe('feature discovery', () => {
  // In tests the `@features` folder points at src/main/app/__fixtures__/features (see vitest.config.mts),
  // so the real discovery code finds the fixture folder exactly as main finds src/main/features/*.
  it('registers a feature folder that no shared file names', async () => {
    const { context, grillo } = featureContext();

    const names = loadFeatures(context);

    expect(names).toEqual(['echo']);
    await expect(grillo.invoke('fixture-echo:say', 'hi')).resolves.toBe('echo: hi');
  });

  it('names the folder whose ipc.ts has no register function', () => {
    const { context } = featureContext();

    expect(() => registerFeatures({ '/src/main/features/broken/ipc.ts': {} }, context)).toThrow(
      "Feature 'broken' must export a register(context) function from its ipc.ts",
    );
  });
});
