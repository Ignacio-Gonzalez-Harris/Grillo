import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGrilloApi } from '../../../preload/bridge';
import { createStoreClient, STORE_METHODS, StoreError } from '../../../shared/store';
import type { FeatureContext } from '../../app/features';
import { createMainIpc } from '../../ipc/bridge';
import { createFakeIpc } from '../../ipc/fake-ipc';
import { createMemoryStore } from '../../store/memory';
import { createMemorySettings } from '../../store/memory/settings';
import type { Store } from '../../store/store';
import { register, registerStoreIpc } from './ipc';

function connect(store: Store = createMemoryStore()) {
  const fake = createFakeIpc();
  const ipc = createMainIpc(fake.main, () => [fake.window]);
  const settings = createMemorySettings();
  const grillo = createGrilloApi(fake.renderer);
  return { ipc, settings, grillo, client: createStoreClient(grillo), register: () => registerStoreIpc(ipc, store, settings) };
}

describe('store IPC round trip through the in-process fake', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('carries store calls and their records from the renderer to the store and back', async () => {
    const bridge = connect();
    bridge.register();

    const created = await bridge.client.createProject({ newRepository: { organisation: 'example-org', name: 'demo' } });
    const read = await bridge.client.getProject('example-org/demo');

    expect(read).toEqual(created);
    expect(read.structure.sections).toHaveLength(13);
  });

  it('gives the renderer a client method for every store method, each answered by its own channel', async () => {
    const calls: string[] = [];
    const recording = Object.fromEntries(
      STORE_METHODS.map((method) => [method, async (...args: unknown[]) => calls.push(`${method}(${args.length})`)]),
    ) as unknown as Store;
    const bridge = connect(recording);
    bridge.register();

    for (const method of STORE_METHODS) {
      await (bridge.client[method] as (...args: unknown[]) => Promise<unknown>)('a', 'b');
    }

    expect(calls).toEqual(STORE_METHODS.map((method) => `${method}(2)`));
  });

  it('turns a refusal back into a StoreError with its kind on the renderer side', async () => {
    const bridge = connect();
    bridge.register();

    const error = await bridge.client.getProject('example-org/missing').catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(StoreError);
    expect(error).toMatchObject({ kind: 'not-found', message: 'No project example-org/missing' });
  });

  it('reads and writes the settings', async () => {
    const bridge = connect();
    bridge.register();

    await expect(bridge.grillo.invoke('settings:get', { key: 'autoUpdate', defaultValue: false })).resolves.toBe(false);
    await bridge.grillo.invoke('settings:set', { key: 'autoUpdate', value: true });

    await expect(bridge.grillo.invoke('settings:get', { key: 'autoUpdate', defaultValue: false })).resolves.toBe(true);
    expect(bridge.settings.get('autoUpdate', false)).toBe(true);
  });

  it.each([
    ['memory', 'GRILLO_STORE=memory', async (client: Store) => expect(await client.listProjects()).toEqual([])],
    ['GitHub', 'GRILLO_STORE unset', async (client: Store) =>
      expect(await client.getMap('example-org/demo').catch((error: StoreError) => error.kind)).toBe('not-implemented')],
  ])('registers the %s store as the app feature when %s', async (_kind, setting, check) => {
    vi.stubEnv('GRILLO_STORE', setting === 'GRILLO_STORE=memory' ? 'memory' : '');
    const bridge = connect();

    register({ ipc: bridge.ipc, settings: bridge.settings } satisfies FeatureContext);

    await check(bridge.client);
  });
});
