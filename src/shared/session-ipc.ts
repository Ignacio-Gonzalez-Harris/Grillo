/**
 * The live session's IPC contract: one invoke channel per `SessionHost` method (`session:<method>`), and the
 * `session:changed` event main sends after every change. The renderer reaches the host through
 * `createSessionClient`, which turns a refusal back into a `SessionError`, as the store client does.
 */
import type { SessionHost } from '../main/features/session/session';
import type { GrilloApi } from './ipc';
import { SessionError, type SessionErrorKind, type SessionState } from './session';

export const SESSION_METHODS = [
  'startSession',
  'setPresent',
  'tickConsent',
  'setRecording',
  'endSession',
  'setChannel',
  'channels',
  'tellSession',
  'useIt',
  'typeMode',
  'typePresent',
  'skip',
  'jump',
  'state',
] as const satisfies readonly (keyof SessionHost)[];

export type SessionMethod = (typeof SESSION_METHODS)[number];

// Fails to compile when a SessionHost method is missing from SESSION_METHODS.
const everyMethodListed: Record<Exclude<keyof SessionHost, SessionMethod>, never> = {};
void everyMethodListed;

export type SessionChannel<M extends SessionMethod = SessionMethod> = `session:${M}`;

export function sessionChannel<M extends SessionMethod>(method: M): SessionChannel<M> {
  return `session:${method}`;
}

/** What a session channel answers. A refusal travels as data, since Electron keeps only an error's message. */
export type SessionResult<T> = { ok: true; value: T } | { ok: false; error: { kind: SessionErrorKind; message: string } };

type SessionInvokeChannels = {
  [M in SessionMethod as SessionChannel<M>]: {
    request: Parameters<SessionHost[M]>;
    response: SessionResult<Awaited<ReturnType<SessionHost[M]>>>;
  };
};

declare module './ipc' {
  // The session's channels join the app's channel map; the interface adds nothing of its own.
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface InvokeChannels extends SessionInvokeChannels {}
  interface EventChannels {
    /** The session after a change: a call, a transcribed slice; null once it has ended. */
    'session:changed': SessionState | null;
  }
}

/** The renderer's session host: every method answers through IPC, so `state` is asynchronous too. */
export type SessionClient = {
  [M in SessionMethod]: (...args: Parameters<SessionHost[M]>) => Promise<Awaited<ReturnType<SessionHost[M]>>>;
};

type AnyInvoke = (channel: string, payload: unknown) => Promise<SessionResult<unknown>>;

export function createSessionClient(api: GrilloApi): SessionClient {
  const invoke = api.invoke as unknown as AnyInvoke;
  const call =
    (method: SessionMethod) =>
    async (...args: unknown[]): Promise<unknown> => {
      const result = await invoke(sessionChannel(method), args);
      if (!result.ok) throw new SessionError(result.error.kind, result.error.message);
      return result.value;
    };
  return Object.fromEntries(SESSION_METHODS.map((method) => [method, call(method)])) as unknown as SessionClient;
}
