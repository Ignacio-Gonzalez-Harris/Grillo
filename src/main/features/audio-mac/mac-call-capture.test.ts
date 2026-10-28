import { describe, expect, it, vi } from 'vitest';
import { createAudioCapture, type OpenSliceSource } from '../../../renderer/audio/capture';
import { createGrilloApi } from '../../../preload/bridge';
import { type AudioSlice, SAMPLES_PER_SLICE } from '../../../shared/audio';
import { createMainIpc } from '../../ipc/bridge';
import { createFakeIpc } from '../../ipc/fake-ipc';
import { registerAudioChannels } from '../audio/channels';
import { callAudioSupport, installCallAudioHandler, type DisplayMediaHost, type LoopbackStreams } from '../audio/loopback';
import { MAC_CALL_AUDIO_PERMISSION_INSTRUCTION, MAC_CALL_AUDIO_UNAVAILABLE } from './loopback-check';
import { MAC_CALL_AUDIO_NEEDS_NEWER_MACOS } from './support';

const SONOMA = '14.2.1';
const SLICES = 3;

interface FakeTrack {
  readyState: 'live' | 'ended';
  stop: () => void;
}

/** A fake loopback stream as Electron hands it to the page: one screen track and one audio track. */
function loopbackStream(audioState: 'live' | 'ended' = 'live') {
  const video: FakeTrack = { readyState: 'live', stop: vi.fn() };
  const audio: FakeTrack = { readyState: audioState, stop: vi.fn() };
  return {
    video,
    audio,
    getTracks: () => [video, audio],
    getAudioTracks: () => [audio],
    getVideoTracks: () => [video],
  };
}
type FakeStream = ReturnType<typeof loopbackStream>;

/** Stands in for the audio graph: delivers three full slices of a quiet ramp, as 15 seconds of call audio would. */
const threeSlices: OpenSliceSource<FakeStream> = async (_stream, onSlice) => {
  for (let i = 0; i < SLICES; i += 1) onSlice(Int16Array.from({ length: SAMPLES_PER_SLICE }, (_, n) => n % 100));
  return { stop: async () => undefined };
};

/** The renderer capture, wired through a fake IPC to the real main-side channels answering as a Mac would. */
function macCapture(options: { version?: string; stream?: () => Promise<FakeStream>; framesArrive?: boolean } = {}) {
  const slices: AudioSlice[] = [];
  const fake = createFakeIpc();
  registerAudioChannels(createMainIpc(fake.main, () => [fake.window]), {
    settings: { get: (_key, defaultValue) => defaultValue, set: () => undefined },
    microphoneAccess: async () => ({ granted: true, instruction: 'unused' }),
    callAudioSupport: () => callAudioSupport('darwin', options.version ?? SONOMA),
    deliverSlice: (slice) => slices.push(slice),
  });
  const getDisplayMedia = vi.fn(options.stream ?? (async () => loopbackStream()));
  const firstLoopbackFrame = vi.fn(async () => options.framesArrive ?? true);
  const capture = createAudioCapture({
    grillo: createGrilloApi(fake.renderer),
    mediaDevices: { getUserMedia: vi.fn(), getDisplayMedia, enumerateDevices: async () => [] },
    openSliceSource: threeSlices,
    firstLoopbackFrame,
  });
  return { capture, slices, getDisplayMedia, firstLoopbackFrame };
}

describe('Mac call audio, end to end over a fake stream', () => {
  it('on macOS 14.2+ main answers display-media requests with loopback audio and the first screen', async () => {
    let handler: Parameters<DisplayMediaHost<string>['setDisplayMediaRequestHandler']>[0] | undefined;
    const host: DisplayMediaHost<string> = {
      setDisplayMediaRequestHandler: (installed) => {
        handler = installed;
      },
      getScreenSources: async () => ['screen:1'],
    };
    installCallAudioHandler('darwin', host, SONOMA);

    const streams = await new Promise<LoopbackStreams<string> | null>((resolve) => handler?.({}, resolve));

    expect(streams).toEqual({ video: 'screen:1', audio: 'loopback' });
  });

  it('captures the call audio once its first frame arrives, as numbered call slices in main', async () => {
    const { capture, slices, firstLoopbackFrame } = macCapture();

    await expect(capture.startCapture({ source: 'call' })).resolves.toEqual({ ok: true });
    await capture.stopCapture();

    expect(firstLoopbackFrame).toHaveBeenCalledTimes(1);
    expect(slices.map(({ source, index, pcm }) => ({ source, index, samples: pcm.length }))).toEqual(
      [0, 1, 2].map((index) => ({ source: 'call', index, samples: SAMPLES_PER_SLICE })),
    );
  });

  it.each([
    ['an audio track already ended at start', { stream: async () => loopbackStream('ended') }],
    ['no frame within 2 seconds', { framesArrive: false }],
    ['a refused share', { stream: async () => Promise.reject(new DOMException('denied', 'NotAllowedError')) }],
  ])('reports %s as a missing permission with where to grant it, and records nothing', async (_name, options) => {
    const { capture, slices } = macCapture(options);

    await expect(capture.startCapture({ source: 'call' })).resolves.toEqual({
      ok: false,
      reason: 'permission-denied',
      message: MAC_CALL_AUDIO_PERMISSION_INSTRUCTION,
    });
    expect(slices).toEqual([]);
    // Not left "already capturing": a second try reaches the check again.
    await expect(capture.startCapture({ source: 'call' })).resolves.toMatchObject({ reason: 'permission-denied' });
  });

  it('reports a share with no audio track as unsupported, stopping the screen track', async () => {
    const silent = loopbackStream();
    const noAudio = { ...silent, getTracks: () => [silent.video], getAudioTracks: () => [] };
    const { capture } = macCapture({ stream: async () => noAudio });

    await expect(capture.startCapture({ source: 'call' })).resolves.toEqual({
      ok: false,
      reason: 'unsupported',
      message: MAC_CALL_AUDIO_UNAVAILABLE,
    });
    expect(silent.video.stop).toHaveBeenCalled();
  });

  it('on a Mac older than 14.2 says macOS 14.2 is needed, without asking for the screen', async () => {
    const { capture, getDisplayMedia } = macCapture({ version: '14.1' });

    await expect(capture.startCapture({ source: 'call' })).resolves.toEqual({
      ok: false,
      reason: 'unsupported',
      message: MAC_CALL_AUDIO_NEEDS_NEWER_MACOS,
    });
    expect(getDisplayMedia).not.toHaveBeenCalled();
  });
});
