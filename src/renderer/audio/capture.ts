import { type FirstFrameProbe, openMacLoopback } from '../../main/features/audio-mac/loopback-check';
import type { CaptureSource, InputDevice, StartCaptureResult } from '../../shared/audio';
import type { GrilloApi } from '../../shared/ipc';

/** The parts of a `MediaStreamTrack` and a `MediaStream` the capture uses; fakes stand in for them in tests. */
export interface CaptureTrack {
  stop(): void;
  /** `ended` fires when the track stops by itself: the device was unplugged, or Windows stopped the share. */
  addEventListener(type: 'ended', listener: () => void): void;
  removeEventListener(type: 'ended', listener: () => void): void;
}
export interface CaptureStream {
  getTracks(): CaptureTrack[];
  getAudioTracks(): CaptureTrack[];
  getVideoTracks(): CaptureTrack[];
}

/** The parts of `navigator.mediaDevices` the capture uses. */
export interface CaptureMediaDevices<S extends CaptureStream> {
  getUserMedia(constraints: MediaStreamConstraints): Promise<S>;
  getDisplayMedia(options: DisplayMediaStreamOptions): Promise<S>;
  enumerateDevices(): Promise<Array<Pick<MediaDeviceInfo, 'deviceId' | 'kind' | 'label'>>>;
}

/** A running audio graph that turns a stream into PCM slices. `stop` hands over the last, shorter slice first. */
export interface SliceSource {
  stop(): Promise<void>;
}
export type OpenSliceSource<S extends CaptureStream> = (
  stream: S,
  onSlice: (pcm: Int16Array) => void,
) => Promise<SliceSource>;

export interface AudioCaptureDeps<S extends CaptureStream> {
  grillo: Pick<GrilloApi, 'invoke'>;
  mediaDevices: CaptureMediaDevices<S>;
  openSliceSource: OpenSliceSource<S>;
  /** Confirms the call audio's first frame arrives, where main asks for it (a Mac). */
  firstLoopbackFrame?: FirstFrameProbe<ReturnType<S['getAudioTracks']>[number]>;
}

export interface AudioCapture {
  /** Starts capturing; every 5 seconds a slice goes to main on `audio:slice`. */
  startCapture(options: { source: CaptureSource }): Promise<StartCaptureResult>;
  /** Stops capturing once the last slice has reached main. Rejects if a slice could not be delivered. */
  stopCapture(): Promise<void>;
  /**
   * Tells the listener, with the reason in the host's words, when a capture stopped by itself because its audio track
   * ended (the microphone unplugged, the call-audio share ended). The capture has then stopped, its last slice sent.
   */
  onEnded(listener: (message: string) => void): () => void;
  listInputDevices(): Promise<InputDevice[]>;
  /** Picks the microphone for the next capture; null means the system default. */
  selectInputDevice(deviceId: string | null): Promise<void>;
  selectedInputDevice(): Promise<string | null>;
}

const NOT_CONNECTED = 'The picked microphone is not connected. Pick another one, or the system default.';
const IN_USE = 'The microphone could not be opened. Close any app that is using it, then try again.';
const NO_CALL_AUDIO = 'Windows did not share the call audio. Try again.';
export const MICROPHONE_ENDED =
  'Recording stopped: the microphone stopped sending sound (unplugged or switched off). Nothing said after that was recorded. Connect a microphone, then turn Record on again.';
export const CALL_AUDIO_ENDED =
  'Recording stopped: the call audio is no longer shared with Grillo. Nothing said after that was recorded. Turn Record on again to share it again.';

type Failure = Extract<StartCaptureResult, { ok: false }>;

function failure(reason: Failure['reason'], message: string): Failure {
  return { ok: false, reason, message };
}

function isFailure(value: CaptureStream | Failure): value is Failure {
  return 'ok' in value;
}

function errorName(error: unknown): string {
  return error instanceof Error || error instanceof DOMException ? error.name : '';
}

function errorMessage(error: unknown): string {
  return error instanceof Error || error instanceof DOMException ? error.message : String(error);
}

function stopAll(stream: CaptureStream): void {
  for (const track of stream.getTracks()) track.stop();
}

interface Running<S> {
  stream: S;
  source: SliceSource;
  deliveries: Promise<void>[];
  deliveryError: { error?: unknown };
  /** Stops listening for the stream's tracks ending. */
  unwatch: () => void;
}

/** Calls `ended` once any audio track of the stream ends by itself; the returned function stops listening. */
function watchTracks(stream: CaptureStream, ended: () => void): () => void {
  const tracks = stream.getAudioTracks();
  for (const track of tracks) track.addEventListener('ended', ended);
  return () => {
    for (const track of tracks) track.removeEventListener('ended', ended);
  };
}

export function createAudioCapture<S extends CaptureStream>(deps: AudioCaptureDeps<S>): AudioCapture {
  const { grillo, mediaDevices } = deps;
  let busy = false;
  let running: Running<S> | undefined;
  const endedListeners = new Set<(message: string) => void>();

  async function openMicrophone(): Promise<S | Failure> {
    const access = await grillo.invoke('audio:microphone-access', undefined);
    if (!access.granted) return failure('permission-denied', access.instruction);
    const deviceId = await grillo.invoke('audio:get-input-device', undefined);
    try {
      return await mediaDevices.getUserMedia({ audio: deviceId === null ? true : { deviceId: { exact: deviceId } } });
    } catch (error) {
      const name = errorName(error);
      if (name === 'NotAllowedError' || name === 'SecurityError') return failure('permission-denied', access.instruction);
      if (name === 'NotFoundError' || name === 'OverconstrainedError') return failure('no-device', NOT_CONNECTED);
      if (name === 'NotReadableError') return failure('failed', IN_USE);
      return failure('failed', errorMessage(error));
    }
  }

  async function openCallAudio(): Promise<S | Failure> {
    const support = await grillo.invoke('audio:call-support', undefined);
    if (!support.supported) return failure('unsupported', support.reason);
    if (support.confirmFramesArrive) {
      const mac = await openMacLoopback(() => mediaDevices.getDisplayMedia({ video: true, audio: true }), deps.firstLoopbackFrame);
      return mac.ok ? mac.stream : failure(mac.reason === 'permissionMissing' ? 'permission-denied' : 'unsupported', mac.message);
    }
    let stream: S;
    try {
      // Chromium only shares display audio together with a video track; the video is dropped at once.
      stream = await mediaDevices.getDisplayMedia({ video: true, audio: true });
    } catch {
      return failure('failed', NO_CALL_AUDIO);
    }
    for (const track of stream.getVideoTracks()) track.stop();
    if (stream.getAudioTracks().length === 0) {
      stopAll(stream);
      return failure('failed', NO_CALL_AUDIO);
    }
    return stream;
  }

  async function start(source: CaptureSource): Promise<StartCaptureResult> {
    const opened = source === 'microphone' ? await openMicrophone() : await openCallAudio();
    if (isFailure(opened)) return opened;
    const deliveries: Promise<void>[] = [];
    const deliveryError: { error?: unknown } = {};
    let index = 0;
    const deliver = (pcm: Int16Array): void => {
      const delivery = grillo.invoke('audio:slice', { source, index, pcm }).catch((error: unknown) => {
        deliveryError.error ??= error;
      });
      deliveries.push(delivery);
      index += 1;
    };
    let sliceSource: SliceSource;
    try {
      sliceSource = await deps.openSliceSource(opened, deliver);
    } catch (error) {
      stopAll(opened);
      return failure('failed', errorMessage(error));
    }
    const current: Running<S> = { stream: opened, source: sliceSource, deliveries, deliveryError, unwatch: () => undefined };
    current.unwatch = watchTracks(opened, () => void endedByItself(current, source));
    running = current;
    return { ok: true };
  }

  /** Stops a running capture once its last slice has reached main; rejects if a slice could not be delivered. */
  async function finish(current: Running<S>): Promise<void> {
    running = undefined;
    current.unwatch();
    try {
      await current.source.stop();
    } finally {
      stopAll(current.stream);
      busy = false;
    }
    await Promise.all(current.deliveries);
    if ('error' in current.deliveryError) throw current.deliveryError.error;
  }

  /** A track ended under a running capture: it stops, keeping what was heard, and the listeners learn why. */
  async function endedByItself(current: Running<S>, source: CaptureSource): Promise<void> {
    if (running !== current) return;
    await finish(current).catch(() => undefined);
    const message = source === 'microphone' ? MICROPHONE_ENDED : CALL_AUDIO_ENDED;
    for (const listener of [...endedListeners]) listener(message);
  }

  return {
    async startCapture({ source }) {
      if (busy) return failure('already-capturing', 'A capture is already running. Stop it first.');
      busy = true;
      const result = await start(source).catch((error: unknown) => failure('failed', errorMessage(error)));
      if (!result.ok) busy = false;
      return result;
    },

    async stopCapture() {
      if (running !== undefined) await finish(running);
    },

    onEnded(listener) {
      endedListeners.add(listener);
      return () => endedListeners.delete(listener);
    },

    async listInputDevices() {
      const inputs = (await mediaDevices.enumerateDevices()).filter((device) => device.kind === 'audioinput');
      // Labels stay empty until the microphone permission is granted.
      return inputs.map((device, i) => ({ deviceId: device.deviceId, label: device.label || `Microphone ${i + 1}` }));
    },

    selectInputDevice: (deviceId) => grillo.invoke('audio:set-input-device', deviceId),
    selectedInputDevice: () => grillo.invoke('audio:get-input-device', undefined),
  };
}
