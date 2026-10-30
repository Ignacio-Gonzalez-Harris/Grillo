import { describe, expect, it, vi } from 'vitest';
import { registerAudioChannels, type AudioChannelDeps } from '../../main/features/audio/channels';
import { createMainIpc } from '../../main/ipc/bridge';
import { createFakeIpc } from '../../main/ipc/fake-ipc';
import { createGrilloApi } from '../../preload/bridge';
import { type AudioSlice, type CallAudioSupport, SAMPLES_PER_SLICE, SLICE_SECONDS } from '../../shared/audio';
import {
  CALL_AUDIO_ENDED,
  type CaptureMediaDevices,
  createAudioCapture,
  MICROPHONE_ENDED,
  type OpenSliceSource,
} from './capture';
import { createPcmSlicer } from './slicer';

const DEVICE_RATE = 48_000;
const FRAME = 128;
const TONE_HZ = 440;
const TONE_LEVEL = 0.3;

/** A fake media track; `end` plays the device going away (unplugged, or the share stopped). */
class FakeTrack {
  readonly stop = vi.fn();
  private readonly endedListeners = new Set<() => void>();
  constructor(readonly kind: string) {}
  addEventListener(_type: 'ended', listener: () => void): void {
    this.endedListeners.add(listener);
  }
  removeEventListener(_type: 'ended', listener: () => void): void {
    this.endedListeners.delete(listener);
  }
  end(): void {
    for (const listener of [...this.endedListeners]) listener();
  }
}

/** A fake media stream: it holds `seconds` of a 440 Hz tone at 48 kHz, played out when the graph opens. */
class FakeStream {
  readonly audio: FakeTrack[] = [new FakeTrack('audio')];
  readonly video: FakeTrack[] = [];
  constructor(readonly seconds: number) {}
  getTracks = () => [...this.audio, ...this.video];
  getAudioTracks = () => this.audio;
  getVideoTracks = () => this.video;
}

/** Stands in for the worklet graph: plays the stream's tone through the real slicer, in 128-sample frames. */
const playThroughSlicer: OpenSliceSource<FakeStream> = async (stream, onSlice) => {
  const slicer = createPcmSlicer({ inputSampleRate: DEVICE_RATE, onSlice });
  for (let start = 0; start < DEVICE_RATE * stream.seconds; start += FRAME) {
    slicer.push(
      Float32Array.from({ length: FRAME }, (_, i) => TONE_LEVEL * Math.sin((2 * Math.PI * TONE_HZ * (start + i)) / DEVICE_RATE)),
    );
  }
  return { stop: async () => slicer.flush() };
};

interface SetUpOptions {
  channels?: Partial<AudioChannelDeps>;
  devices?: Partial<CaptureMediaDevices<FakeStream>>;
  open?: OpenSliceSource<FakeStream>;
}

/** The renderer capture wired through a fake IPC to the real main-side audio channels. */
function setUp(options: SetUpOptions = {}) {
  const slices: AudioSlice[] = [];
  const values: Record<string, unknown> = {};
  const fake = createFakeIpc();
  registerAudioChannels(createMainIpc(fake.main, () => [fake.window]), {
    settings: {
      get: (key, defaultValue) => (Object.hasOwn(values, key) ? (values[key] as typeof defaultValue) : defaultValue),
      set: (key, value) => {
        values[key] = value;
      },
    },
    microphoneAccess: async () => ({ granted: true, instruction: 'Turn on the microphone in settings.' }),
    callAudioSupport: () => ({ supported: true }),
    deliverSlice: (slice) => slices.push(slice),
    ...options.channels,
  });
  const mediaDevices: CaptureMediaDevices<FakeStream> = {
    getUserMedia: vi.fn(async () => new FakeStream(3 * SLICE_SECONDS)),
    getDisplayMedia: vi.fn(async () => {
      const stream = new FakeStream(3 * SLICE_SECONDS);
      stream.video.push(new FakeTrack('video'));
      return stream;
    }),
    enumerateDevices: async () => [],
    ...options.devices,
  };
  const capture = createAudioCapture({
    grillo: createGrilloApi(fake.renderer),
    mediaDevices,
    openSliceSource: options.open ?? playThroughSlicer,
  });
  return { capture, slices, mediaDevices };
}

function domError(name: string): DOMException {
  return new DOMException('refused', name);
}

describe('audio capture', () => {
  it.each(['microphone', 'call'] as const)('turns 15 seconds of %s audio into three 5-second 16 kHz slices in main', async (source) => {
    const { capture, slices } = setUp();

    await expect(capture.startCapture({ source })).resolves.toEqual({ ok: true });
    await capture.stopCapture();

    const full = slices.filter((slice) => slice.pcm.length === SAMPLES_PER_SLICE);
    expect(full.map(({ source: from, index }) => ({ from, index }))).toEqual([0, 1, 2].map((index) => ({ from: source, index })));
    expect(slices.every((slice) => slice.pcm instanceof Int16Array)).toBe(true);
    expect(Math.max(...full[0].pcm)).toBeGreaterThan(0.25 * 32767);
  });

  it('drops the call video track at once and stops every track on stop', async () => {
    const { capture, mediaDevices } = setUp();

    await capture.startCapture({ source: 'call' });
    const stream: FakeStream = await vi.mocked(mediaDevices.getDisplayMedia).mock.results[0].value;
    expect(mediaDevices.getDisplayMedia).toHaveBeenCalledWith({ video: true, audio: true });
    expect(stream.video[0].stop).toHaveBeenCalled();
    expect(stream.audio[0].stop).not.toHaveBeenCalled();
    await capture.stopCapture();

    expect(stream.audio[0].stop).toHaveBeenCalled();
  });

  it.each([
    ['microphone', MICROPHONE_ENDED],
    ['call', CALL_AUDIO_ENDED],
  ] as const)('stops by itself when the %s track ends, keeps what was heard, and says why', async (source, why) => {
    const { capture, slices, mediaDevices } = setUp();
    const told: string[] = [];
    capture.onEnded((message) => told.push(message));
    await capture.startCapture({ source });
    const opened = source === 'microphone' ? mediaDevices.getUserMedia : mediaDevices.getDisplayMedia;
    const stream: FakeStream = await vi.mocked(opened).mock.results[0].value;

    const ended = new Promise<void>((resolve) => capture.onEnded(() => resolve()));
    stream.audio[0].end();
    await ended;

    expect(told).toEqual([why]);
    expect(slices.filter((slice) => slice.pcm.length === SAMPLES_PER_SLICE)).toHaveLength(3);
    expect(stream.audio[0].stop).toHaveBeenCalled();
    await expect(capture.startCapture({ source })).resolves.toEqual({ ok: true });
  });

  it('says nothing when the host stopped the capture, or to a listener that has left', async () => {
    const { capture, mediaDevices } = setUp();
    const told: string[] = [];
    const leave = capture.onEnded((message) => told.push(message));
    await capture.startCapture({ source: 'microphone' });
    const first: FakeStream = await vi.mocked(mediaDevices.getUserMedia).mock.results[0].value;
    await capture.stopCapture();
    first.audio[0].end();

    leave();
    await capture.startCapture({ source: 'microphone' });
    const second: FakeStream = await vi.mocked(mediaDevices.getUserMedia).mock.results[1].value;
    second.audio[0].end();
    await capture.stopCapture();

    expect(told).toEqual([]);
  });

  it('refuses a second capture while one runs, and allows a new one after stop', async () => {
    const { capture } = setUp();

    await capture.startCapture({ source: 'microphone' });
    await expect(capture.startCapture({ source: 'call' })).resolves.toMatchObject({ ok: false, reason: 'already-capturing' });
    await capture.stopCapture();
    await expect(capture.startCapture({ source: 'call' })).resolves.toEqual({ ok: true });
  });

  it('reports call audio as unsupported where main says so, without asking for the screen', async () => {
    const unsupported: CallAudioSupport = { supported: false, reason: 'Not on a Mac yet.' };
    const { capture, mediaDevices } = setUp({ channels: { callAudioSupport: () => unsupported } });

    await expect(capture.startCapture({ source: 'call' })).resolves.toEqual({
      ok: false,
      reason: 'unsupported',
      message: 'Not on a Mac yet.',
    });
    expect(mediaDevices.getDisplayMedia).not.toHaveBeenCalled();
  });

  it('reports a denied microphone permission with the instruction to grant it, before opening the microphone', async () => {
    const { capture, mediaDevices } = setUp({
      channels: { microphoneAccess: async () => ({ granted: false, instruction: 'Open System Settings > Privacy.' }) },
    });

    await expect(capture.startCapture({ source: 'microphone' })).resolves.toEqual({
      ok: false,
      reason: 'permission-denied',
      message: 'Open System Settings > Privacy.',
    });
    expect(mediaDevices.getUserMedia).not.toHaveBeenCalled();
  });

  it.each([
    ['NotAllowedError', 'permission-denied', /Turn on the microphone/],
    ['NotFoundError', 'no-device', /not connected/],
    ['OverconstrainedError', 'no-device', /not connected/],
    ['NotReadableError', 'failed', /could not be opened/],
    ['AbortError', 'failed', /refused/],
  ])('maps a microphone %s to a typed %s result and stays ready for the next capture', async (name, reason, message) => {
    const { capture } = setUp({ devices: { getUserMedia: async () => Promise.reject(domError(name)) } });

    const result = await capture.startCapture({ source: 'microphone' });

    expect(result).toMatchObject({ ok: false, reason });
    expect(!result.ok && result.message).toMatch(message);
    await expect(capture.startCapture({ source: 'call' })).resolves.toEqual({ ok: true });
  });

  it('fails the call capture when sharing is refused or brings no audio, stopping what it opened', async () => {
    const silent = new FakeStream(1);
    silent.audio.length = 0;
    const video = new FakeTrack('video');
    silent.video.push(video);
    const refused = setUp({ devices: { getDisplayMedia: async () => Promise.reject(domError('NotAllowedError')) } });
    const noAudio = setUp({ devices: { getDisplayMedia: async () => silent } });

    await expect(refused.capture.startCapture({ source: 'call' })).resolves.toMatchObject({ ok: false, reason: 'failed' });
    await expect(noAudio.capture.startCapture({ source: 'call' })).resolves.toMatchObject({ ok: false, reason: 'failed' });
    expect(video.stop).toHaveBeenCalled();
  });

  it('stops the stream when the audio graph cannot open', async () => {
    const { capture, mediaDevices } = setUp({ open: async () => Promise.reject(new Error('worklet failed to load')) });

    await expect(capture.startCapture({ source: 'microphone' })).resolves.toEqual({
      ok: false,
      reason: 'failed',
      message: 'worklet failed to load',
    });
    const stream: FakeStream = await vi.mocked(mediaDevices.getUserMedia).mock.results[0].value;
    expect(stream.audio[0].stop).toHaveBeenCalled();
  });

  it('rejects stop when main refused a slice', async () => {
    const { capture } = setUp({
      channels: {
        deliverSlice: () => {
          throw new Error('main is not listening');
        },
      },
    });

    await capture.startCapture({ source: 'microphone' });
    await expect(capture.stopCapture()).rejects.toThrow('main is not listening');
  });

  it('lists the microphones, naming unlabelled ones, and opens the picked one', async () => {
    const { capture, mediaDevices } = setUp({
      devices: {
        enumerateDevices: async () => [
          { deviceId: 'default', kind: 'audioinput', label: 'Default - Desk microphone' },
          { deviceId: 'speakers', kind: 'audiooutput', label: 'Speakers' },
          { deviceId: 'usb-2', kind: 'audioinput', label: '' },
        ],
      },
    });

    await expect(capture.listInputDevices()).resolves.toEqual([
      { deviceId: 'default', label: 'Default - Desk microphone' },
      { deviceId: 'usb-2', label: 'Microphone 2' },
    ]);
    await capture.startCapture({ source: 'microphone' });
    await capture.stopCapture();
    await capture.selectInputDevice('usb-2');
    await expect(capture.selectedInputDevice()).resolves.toBe('usb-2');
    await capture.startCapture({ source: 'microphone' });

    expect(mediaDevices.getUserMedia).toHaveBeenNthCalledWith(1, { audio: true });
    expect(mediaDevices.getUserMedia).toHaveBeenNthCalledWith(2, { audio: { deviceId: { exact: 'usb-2' } } });
  });
});
