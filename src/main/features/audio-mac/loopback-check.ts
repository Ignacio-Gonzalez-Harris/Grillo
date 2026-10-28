/**
 * The Mac call-audio permission check (PRD section 8, decision [I2]). On a Mac a missing "System Audio Recording"
 * permission raises no error: Electron hands the page an audio track that is already ended, or that never delivers
 * a frame. This module opens the loopback stream and confirms the first frame arrives, so the host is told what to
 * grant instead of recording silence. It touches no Electron or Node API: the renderer runs it on its own stream.
 */

/** How long the first frame of call audio may take before the permission is reported missing. */
export const FIRST_FRAME_TIMEOUT_MS = 2_000;

export const MAC_CALL_AUDIO_PERMISSION_INSTRUCTION =
  'Grillo cannot hear the call audio. Open System Settings > Privacy & Security > Screen & System Audio Recording, turn on Grillo, then restart Grillo.';
export const MAC_CALL_AUDIO_UNAVAILABLE =
  'This Mac did not give Grillo the call audio. Record the room microphone instead.';

/** The parts of a `MediaStreamTrack` the check uses. */
export interface LoopbackTrack {
  readonly readyState?: string;
  stop(): void;
}

/** The parts of the `MediaStream` from `getDisplayMedia` the check uses. */
export interface LoopbackStream<T extends LoopbackTrack> {
  getTracks(): T[];
  getAudioTracks(): T[];
  getVideoTracks(): T[];
}

/** Resolves true once the track delivers a frame, false if it ends or `timeoutMs` passes first. */
export type FirstFrameProbe<T> = (track: T, timeoutMs: number) => Promise<boolean>;

export type MacLoopbackResult<S> =
  | { ok: true; stream: S }
  | { ok: false; reason: 'permissionMissing' | 'unsupported'; message: string };

const permissionMissing = { ok: false, reason: 'permissionMissing', message: MAC_CALL_AUDIO_PERMISSION_INSTRUCTION } as const;
const unsupported = { ok: false, reason: 'unsupported', message: MAC_CALL_AUDIO_UNAVAILABLE } as const;

/**
 * Opens the call audio and keeps it only once its first frame has arrived. The screen track Chromium pairs with
 * display audio is stopped at once. Every way this can go wrong ends as `permissionMissing` (a refused share, a
 * track already ended, no frame within two seconds) or `unsupported` (no audio track, or no way to check frames),
 * with every track opened stopped; nothing is thrown.
 */
export async function openMacLoopback<T extends LoopbackTrack, S extends LoopbackStream<T>>(
  open: () => Promise<S>,
  firstFrame: FirstFrameProbe<T> | undefined,
): Promise<MacLoopbackResult<S>> {
  let stream: S;
  try {
    stream = await open();
  } catch {
    return permissionMissing;
  }
  if (!stream) return unsupported;
  const verdict = await checkStream(stream, firstFrame);
  if (verdict !== undefined) {
    for (const track of stream.getTracks()) track.stop();
    return verdict;
  }
  return { ok: true, stream };
}

async function checkStream<T extends LoopbackTrack>(
  stream: LoopbackStream<T>,
  firstFrame: FirstFrameProbe<T> | undefined,
): Promise<typeof permissionMissing | typeof unsupported | undefined> {
  for (const track of stream.getVideoTracks()) track.stop();
  const [audio] = stream.getAudioTracks();
  if (!audio || firstFrame === undefined) return unsupported;
  if (audio.readyState === 'ended') return permissionMissing;
  try {
    return (await firstFrame(audio, FIRST_FRAME_TIMEOUT_MS)) ? undefined : permissionMissing;
  } catch {
    return unsupported;
  }
}

/** The parts of Chromium's `MediaStreamTrackProcessor` (not in TypeScript's DOM types) the probe uses. */
export interface TrackProcessorConstructor {
  new (init: { track: MediaStreamTrack }): {
    readable: {
      getReader(): {
        read(): Promise<{ done: boolean; value?: { close(): void } }>;
        cancel(): Promise<void>;
      };
    };
  };
}

function pageTrackProcessor(): TrackProcessorConstructor | undefined {
  return (globalThis as { MediaStreamTrackProcessor?: TrackProcessorConstructor }).MediaStreamTrackProcessor;
}

/**
 * The page's frame probe: reads one frame from a copy of the track, so the capture's own track is untouched, then
 * releases the copy. Throws when the page has no `MediaStreamTrackProcessor`.
 */
export async function firstFrameArrives(
  track: MediaStreamTrack,
  timeoutMs: number,
  Processor: TrackProcessorConstructor | undefined = pageTrackProcessor(),
): Promise<boolean> {
  if (Processor === undefined) throw new Error('This page has no MediaStreamTrackProcessor to read audio frames');
  const copy = track.clone();
  const reader = new Processor({ track: copy }).readable.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  const frame = reader.read().then(
    ({ done, value }) => {
      value?.close();
      return !done;
    },
    () => false,
  );
  try {
    return await Promise.race([frame, timedOut]);
  } finally {
    clearTimeout(timer);
    reader.cancel().catch(() => undefined);
    copy.stop();
  }
}
