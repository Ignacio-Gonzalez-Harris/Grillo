import {
  type AudioSlice,
  type CallAudioSupport,
  INPUT_DEVICE_SETTING,
  isCaptureSource,
  type MicrophoneAccess,
  SAMPLES_PER_SLICE,
} from '../../../shared/audio';
import type { Settings } from '../../app/settings';
import type { MainIpc } from '../../ipc/bridge';

/** The one error a malformed request on an audio channel becomes. */
export class AudioRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AudioRequestError';
  }
}

export interface AudioChannelDeps {
  settings: Settings;
  microphoneAccess(): Promise<MicrophoneAccess>;
  callAudioSupport(): CallAudioSupport;
  deliverSlice(slice: AudioSlice): void;
}

function checkedSlice(value: unknown): AudioSlice {
  const slice = value as Partial<AudioSlice> | null;
  if (typeof slice !== 'object' || slice === null) {
    throw new AudioRequestError('An audio slice must be an object');
  }
  if (!isCaptureSource(slice.source)) {
    throw new AudioRequestError(`Unknown capture source '${String(slice.source)}'`);
  }
  if (!Number.isInteger(slice.index) || (slice.index as number) < 0) {
    throw new AudioRequestError('An audio slice index must be a whole number from 0');
  }
  if (!(slice.pcm instanceof Int16Array) || slice.pcm.length === 0 || slice.pcm.length > SAMPLES_PER_SLICE) {
    throw new AudioRequestError(`An audio slice must hold 1 to ${SAMPLES_PER_SLICE} 16-bit samples`);
  }
  return { source: slice.source, index: slice.index as number, pcm: slice.pcm };
}

function checkedDeviceId(value: unknown): string | null {
  if (value === null || (typeof value === 'string' && value !== '')) return value;
  throw new AudioRequestError('A microphone is picked by a non-empty device id, or null for the system default');
}

/** A hand-edited settings file with a value that is not a device id falls back to the system default. */
function checkedDeviceIdOrDefault(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

export function registerAudioChannels(ipc: MainIpc, deps: AudioChannelDeps): void {
  ipc.handle('audio:microphone-access', () => deps.microphoneAccess());
  ipc.handle('audio:call-support', () => deps.callAudioSupport());
  ipc.handle('audio:slice', (slice) => deps.deliverSlice(checkedSlice(slice)));
  ipc.handle('audio:get-input-device', () => checkedDeviceIdOrDefault(deps.settings.get<unknown>(INPUT_DEVICE_SETTING, null)));
  ipc.handle('audio:set-input-device', (deviceId) => deps.settings.set(INPUT_DEVICE_SETTING, checkedDeviceId(deviceId)));
}
