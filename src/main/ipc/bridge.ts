import type {
  EventChannel,
  EventPayload,
  InvokeChannel,
  InvokeRequest,
  InvokeResponse,
} from '../../shared/ipc';

/** The part of Electron's `ipcMain` the bridge needs: answering the renderer's invokes. */
export interface InvokeTransport {
  handle(channel: string, listener: (event: unknown, payload: unknown) => unknown): void;
}

/** Anything main can push an event to: a window's `webContents` in the app, a fake in tests. */
export interface EventSink {
  send(channel: string, payload: unknown): void;
}

export type InvokeHandler<C extends InvokeChannel> = (
  payload: InvokeRequest<C>,
) => InvokeResponse<C> | Promise<InvokeResponse<C>>;

/** The typed main-process side of the bridge that every feature registers its channels on. */
export interface MainIpc {
  handle<C extends InvokeChannel>(channel: C, fn: InvokeHandler<C>): void;
  send<C extends EventChannel>(channel: C, payload: EventPayload<C>): void;
}

export function createMainIpc(transport: InvokeTransport, sinks: () => readonly EventSink[]): MainIpc {
  return {
    handle(channel, fn) {
      transport.handle(channel, (_event, payload) => fn(payload as InvokeRequest<typeof channel>));
    },
    send(channel, payload) {
      for (const sink of sinks()) {
        sink.send(channel, payload);
      }
    },
  };
}
