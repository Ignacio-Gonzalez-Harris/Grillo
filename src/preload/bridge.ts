import type { GrilloApi } from '../shared/ipc';

type Listener = (event: unknown, payload: unknown) => void;

/** The part of Electron's `ipcRenderer` the bridge needs. */
export interface RendererTransport {
  invoke(channel: string, payload: unknown): Promise<unknown>;
  on(channel: string, listener: Listener): unknown;
  removeListener(channel: string, listener: Listener): unknown;
}

/** Builds `window.grillo`: the renderer's only way to reach the main process. */
export function createGrilloApi(transport: RendererTransport): GrilloApi {
  return {
    invoke(channel, payload) {
      return transport.invoke(channel, payload) as ReturnType<GrilloApi['invoke']>;
    },
    on(channel, listener) {
      const forward: Listener = (_event, payload) => listener(payload as Parameters<typeof listener>[0]);
      transport.on(channel, forward);
      return () => {
        transport.removeListener(channel, forward);
      };
    },
  };
}
