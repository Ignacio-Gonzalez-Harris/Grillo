import type { Unsubscribe } from '../../../shared/ipc';
import type { ChatDriverEvents } from './driver';

/**
 * Hands one chat driver's events to everyone listening: the renderer's channels and the agent runtime, which shows
 * the driver's agents as tabs. Listeners may join after the driver exists.
 */
export interface ChatEventHub {
  /** Give these to the driver. */
  readonly events: ChatDriverEvents;
  observe(listener: ChatDriverEvents): Unsubscribe;
}

export function createChatEventHub(): ChatEventHub {
  const listeners = new Set<ChatDriverEvents>();
  return {
    events: {
      message: (id, message) => listeners.forEach((listener) => listener.message(id, message)),
      raw: (id, line) => listeners.forEach((listener) => listener.raw(id, line)),
      exited: (id, exitCode) => listeners.forEach((listener) => listener.exited(id, exitCode)),
    },
    observe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
