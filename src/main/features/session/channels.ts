import { SESSION_METHODS, sessionChannel, type SessionMethod, type SessionResult } from '../../../shared/session-ipc';
import { SessionError } from '../../../shared/session';
import type { MainIpc } from '../../ipc/bridge';
import type { Transcriber } from '../transcription/transcriber';
import type { SessionHost } from './session';

/** The calls that only read the session, so they announce nothing. */
const READS: ReadonlySet<SessionMethod> = new Set(['state', 'channels']);

type AnyHostMethod = (...args: unknown[]) => unknown;
type AnyHandle = (channel: string, fn: (args: unknown) => Promise<SessionResult<unknown>>) => void;

/** Runs one host call; a refusal becomes data the renderer turns back into a `SessionError`. */
async function settle(host: SessionHost, method: SessionMethod, args: unknown): Promise<SessionResult<unknown>> {
  try {
    const call = host[method] as AnyHostMethod;
    return { ok: true, value: await call(...(Array.isArray(args) ? args : [])) };
  } catch (error) {
    if (error instanceof SessionError) return { ok: false, error: { kind: error.kind, message: error.message } };
    throw error;
  }
}

/**
 * Puts every `SessionHost` method on `session:<method>`, and sends `session:changed` after every call that may have
 * changed the session (all but the reads, `state` and `channels`), whether it succeeded or was refused.
 */
export function registerSessionChannels(ipc: MainIpc, host: SessionHost): void {
  const handle = ipc.handle as unknown as AnyHandle;
  for (const method of SESSION_METHODS) {
    handle(sessionChannel(method), async (args) => {
      try {
        return await settle(host, method, args);
      } finally {
        if (!READS.has(method)) ipc.send('session:changed', host.state());
      }
    });
  }
}

/**
 * Wraps the transcriber so `changed` runs once each slice's text has had its turn in the transcript, which the host
 * applies in the microtasks after the text arrives: a timer of 0 runs after them.
 */
export function announcingTranscriber(transcriber: Transcriber, changed: () => void): Transcriber {
  const announce = () => setTimeout(changed, 0);
  return {
    transcribe(pcm) {
      const text = transcriber.transcribe(pcm);
      text.then(announce, announce);
      return text;
    },
  };
}
