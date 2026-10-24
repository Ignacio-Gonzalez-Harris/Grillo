import type { RendererTransport } from '../../preload/bridge';
import type { EventSink, InvokeTransport } from './bridge';

type Listener = (event: unknown, payload: unknown) => unknown;

/**
 * An in-process stand-in for Electron's IPC, for tests: `main` plays `ipcMain`, `window` plays one
 * window's `webContents`, `renderer` plays `ipcRenderer`. Payloads are structured-cloned on the way
 * through, as Electron does, so a test cannot pass something real IPC would refuse.
 */
export function createFakeIpc(): { main: InvokeTransport; window: EventSink; renderer: RendererTransport } {
  const handlers = new Map<string, Listener>();
  const listeners = new Map<string, Set<Listener>>();
  const noEvent = {};

  const main: InvokeTransport = {
    handle(channel, listener) {
      if (handlers.has(channel)) {
        throw new Error(`Attempted to register a second handler for '${channel}'`);
      }
      handlers.set(channel, listener);
    },
  };

  const window: EventSink = {
    send(channel, payload) {
      for (const listener of [...(listeners.get(channel) ?? [])]) {
        listener(noEvent, structuredClone(payload));
      }
    },
  };

  const renderer: RendererTransport = {
    async invoke(channel, payload) {
      const handler = handlers.get(channel);
      if (!handler) {
        throw new Error(`No handler registered for '${channel}'`);
      }
      return structuredClone(await handler(noEvent, structuredClone(payload)));
    },
    on(channel, listener) {
      const channelListeners = listeners.get(channel) ?? new Set<Listener>();
      channelListeners.add(listener);
      listeners.set(channel, channelListeners);
    },
    removeListener(channel, listener) {
      listeners.get(channel)?.delete(listener);
    },
  };

  return { main, window, renderer };
}
