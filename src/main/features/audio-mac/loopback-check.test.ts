import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FIRST_FRAME_TIMEOUT_MS,
  firstFrameArrives,
  type FirstFrameProbe,
  MAC_CALL_AUDIO_PERMISSION_INSTRUCTION,
  MAC_CALL_AUDIO_UNAVAILABLE,
  openMacLoopback,
  type TrackProcessorConstructor,
} from './loopback-check';

interface FakeTrack {
  readyState: 'live' | 'ended';
  stop: () => void;
}

function track(readyState: 'live' | 'ended' = 'live'): FakeTrack {
  return { readyState, stop: vi.fn() };
}

/** A fake display-media stream from the loopback handler: one screen track and the given audio tracks. */
function stream(audio: Array<FakeTrack | null>) {
  const video = track();
  const real = audio.filter((t): t is FakeTrack => t !== null);
  return {
    video,
    getTracks: () => [video, ...real],
    getAudioTracks: () => audio as FakeTrack[],
    getVideoTracks: () => [video],
  };
}
type FakeStream = ReturnType<typeof stream>;

const framesArrive: FirstFrameProbe<FakeTrack> = async () => true;
const permissionMissing = { ok: false, reason: 'permissionMissing', message: MAC_CALL_AUDIO_PERMISSION_INSTRUCTION };
const unsupported = { ok: false, reason: 'unsupported', message: MAC_CALL_AUDIO_UNAVAILABLE };

describe('openMacLoopback', () => {
  it('hands back a live stream whose first frame arrived, with the screen track already stopped', async () => {
    const audio = track();
    const opened = stream([audio]);
    const probe = vi.fn(framesArrive);

    await expect(openMacLoopback(async () => opened, probe)).resolves.toEqual({ ok: true, stream: opened });
    expect(probe).toHaveBeenCalledWith(audio, FIRST_FRAME_TIMEOUT_MS);
    expect(FIRST_FRAME_TIMEOUT_MS).toBe(2_000);
    expect(opened.video.stop).toHaveBeenCalled();
    expect(audio.stop).not.toHaveBeenCalled();
  });

  it.each<[string, FakeTrack, FirstFrameProbe<FakeTrack>]>([
    ['an audio track already ended at start', track('ended'), framesArrive],
    ['no frame within 2 seconds', track(), async () => false],
  ])('reports %s as permissionMissing with the instruction, stopping every track', async (_name, audio, probe) => {
    const opened = stream([audio]);

    await expect(openMacLoopback(async () => opened, probe)).resolves.toEqual(permissionMissing);
    expect(opened.video.stop).toHaveBeenCalled();
    expect(audio.stop).toHaveBeenCalled();
  });

  it('reports a refused share as permissionMissing, never as an escaping error', async () => {
    const refused = async (): Promise<FakeStream> =>
      Promise.reject(new DOMException('Permission denied by system', 'NotAllowedError'));

    await expect(openMacLoopback(refused, framesArrive)).resolves.toEqual(permissionMissing);
  });

  it.each<[string, Array<FakeTrack | null>, FirstFrameProbe<FakeTrack> | undefined]>([
    ['a stream with no audio tracks', [], framesArrive],
    ['a null audio track', [null], framesArrive],
    ['a frame check that throws', [track()], async () => Promise.reject(new Error('no track processor'))],
    ['no frame check at all', [track()], undefined],
  ])('reports %s as unsupported, stopping every track it opened', async (_name, audio, probe) => {
    const opened = stream(audio);

    await expect(openMacLoopback(async () => opened, probe)).resolves.toEqual(unsupported);
    for (const t of opened.getTracks()) expect(t.stop).toHaveBeenCalled();
  });

  it('reports a share that brings no stream at all as unsupported', async () => {
    const nothing = async () => null as unknown as FakeStream;

    await expect(openMacLoopback(nothing, framesArrive)).resolves.toEqual(unsupported);
  });
});

/** A fake `MediaStreamTrackProcessor` whose reader answers `read()` with `firstRead`. */
function processor(firstRead: () => Promise<{ done: boolean; value?: { close(): void } }>) {
  const cancel = vi.fn(async () => undefined);
  const tracks: unknown[] = [];
  const Processor = vi.fn(function (init: { track: unknown }) {
    tracks.push(init.track);
    return { readable: { getReader: () => ({ read: firstRead, cancel }) } };
  }) as unknown as TrackProcessorConstructor;
  return { Processor, cancel, tracks };
}

function cloneableTrack() {
  const copy = { stop: vi.fn() };
  return { copy, original: { clone: vi.fn(() => copy) } as unknown as MediaStreamTrack };
}

describe('firstFrameArrives', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('is true once a frame comes off a copy of the track, closing the frame and releasing the copy', async () => {
    const frame = { close: vi.fn() };
    const { Processor, cancel, tracks } = processor(async () => ({ done: false, value: frame }));
    const { copy, original } = cloneableTrack();

    await expect(firstFrameArrives(original, FIRST_FRAME_TIMEOUT_MS, Processor)).resolves.toBe(true);
    expect(tracks).toEqual([copy]);
    expect(frame.close).toHaveBeenCalled();
    expect(cancel).toHaveBeenCalled();
    expect(copy.stop).toHaveBeenCalled();
  });

  it('is false when the track ends before any frame', async () => {
    const { Processor } = processor(async () => ({ done: true }));

    await expect(firstFrameArrives(cloneableTrack().original, FIRST_FRAME_TIMEOUT_MS, Processor)).resolves.toBe(false);
  });

  it('is false only once the time allowed has passed with no frame, and releases the copy', async () => {
    vi.useFakeTimers();
    const { Processor, cancel } = processor(() => new Promise(() => undefined));
    const { copy, original } = cloneableTrack();
    let settled = false;

    const answer = firstFrameArrives(original, FIRST_FRAME_TIMEOUT_MS, Processor).finally(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(FIRST_FRAME_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    await expect(answer).resolves.toBe(false);
    expect(cancel).toHaveBeenCalled();
    expect(copy.stop).toHaveBeenCalled();
  });

  it('throws when the page has no track processor, which the caller reports as unsupported', async () => {
    await expect(firstFrameArrives(cloneableTrack().original, FIRST_FRAME_TIMEOUT_MS, undefined)).rejects.toThrow(
      /MediaStreamTrackProcessor/,
    );
  });
});
