import { describe, expect, it, vi } from 'vitest';
import type { AudioSlice } from '../../../shared/audio';
import { createSliceBus } from './slices';

describe('slice bus', () => {
  it('hands every published slice to each subscriber until it unsubscribes', () => {
    const bus = createSliceBus();
    const first = vi.fn();
    const second = vi.fn();
    const slice: AudioSlice = { source: 'microphone', index: 0, pcm: new Int16Array(4) };

    const stopFirst = bus.subscribe(first);
    bus.subscribe(second);
    bus.publish(slice);
    stopFirst();
    bus.publish({ ...slice, index: 1 });

    expect(first.mock.calls).toEqual([[slice]]);
    expect(second.mock.calls.map(([received]) => received.index)).toEqual([0, 1]);
  });
});
