import { describe, expect, it, vi } from 'vitest';
import { createGrilloApi } from '../../preload/bridge';
import { createMainIpc } from './bridge';
import { createFakeIpc } from './fake-ipc';

declare module '../../shared/ipc' {
  interface InvokeChannels {
    'round-trip:greet': { request: { name: string }; response: { greeting: string } };
    'round-trip:fail': { request: void; response: void };
  }
  interface EventChannels {
    'round-trip:tick': { count: number };
    'round-trip:other': string;
  }
}

function connect() {
  const fake = createFakeIpc();
  const main = createMainIpc(fake.main, () => [fake.window]);
  const grillo = createGrilloApi(fake.renderer);
  return { main, grillo };
}

describe('IPC bridge round trip through an in-process fake', () => {
  it('delivers an invoke from the renderer to the main handler and returns its answer', async () => {
    const { main, grillo } = connect();
    main.handle('round-trip:greet', async ({ name }) => ({ greeting: `Hello, ${name}` }));

    await expect(grillo.invoke('round-trip:greet', { name: 'Ada Example' })).resolves.toEqual({
      greeting: 'Hello, Ada Example',
    });
  });

  it('rejects the invoke when the main handler throws', async () => {
    const { main, grillo } = connect();
    main.handle('round-trip:fail', () => {
      throw new Error('handler broke');
    });

    await expect(grillo.invoke('round-trip:fail', undefined)).rejects.toThrow('handler broke');
  });

  it('delivers a pushed event only to listeners of that channel, until they unsubscribe', () => {
    const { main, grillo } = connect();
    const onTick = vi.fn();
    const onOther = vi.fn();
    const stop = grillo.on('round-trip:tick', onTick);
    grillo.on('round-trip:other', onOther);

    main.send('round-trip:tick', { count: 1 });
    stop();
    main.send('round-trip:tick', { count: 2 });

    expect(onTick).toHaveBeenCalledTimes(1);
    expect(onTick).toHaveBeenCalledWith({ count: 1 });
    expect(onOther).not.toHaveBeenCalled();
  });
});
