import { describe, expect, it } from 'vitest';
import { SAMPLES_PER_SLICE, SLICE_SAMPLE_RATE, SLICE_SECONDS } from '../../shared/audio';
import { createPcmSlicer, downmix } from './slicer';

/** Feeds `seconds` of a constant level in frames of 128 samples, as an audio worklet receives them. */
function feed(inputSampleRate: number, seconds: number, level = 0.5): Int16Array[] {
  const slices: Int16Array[] = [];
  const slicer = createPcmSlicer({ inputSampleRate, onSlice: (pcm) => slices.push(pcm) });
  const frame = new Float32Array(128).fill(level);
  for (let sent = 0; sent < inputSampleRate * seconds; sent += frame.length) slicer.push(frame);
  slicer.flush();
  return slices;
}

describe('createPcmSlicer', () => {
  it.each([16_000, 44_100, 48_000])('cuts 15 seconds at %i Hz into three 5-second slices of 16 kHz samples', (rate) => {
    const slices = feed(rate, 3 * SLICE_SECONDS);

    expect(slices.slice(0, 3).map((pcm) => pcm.length)).toEqual([SAMPLES_PER_SLICE, SAMPLES_PER_SLICE, SAMPLES_PER_SLICE]);
    // Frames of 128 do not divide every rate evenly: at most one frame's worth of extra samples may follow.
    const extra = slices.slice(3).reduce((total, pcm) => total + pcm.length, 0);
    expect(extra).toBeLessThanOrEqual(Math.ceil((128 * SLICE_SAMPLE_RATE) / rate));
    expect(slices[0].every((sample) => sample === Math.round(0.5 * 32767))).toBe(true);
  });

  it('hands over a shorter last slice on flush, and nothing when nothing is left', () => {
    const slices: Int16Array[] = [];
    const slicer = createPcmSlicer({ inputSampleRate: SLICE_SAMPLE_RATE, onSlice: (pcm) => slices.push(pcm) });

    slicer.push(new Float32Array(1000).fill(0.25));
    slicer.flush();
    slicer.flush();

    expect(slices.map((pcm) => pcm.length)).toEqual([1000]);
  });

  it('converts float samples to 16-bit, clipping anything beyond full scale', () => {
    const slices: Int16Array[] = [];
    const slicer = createPcmSlicer({ inputSampleRate: SLICE_SAMPLE_RATE, onSlice: (pcm) => slices.push(pcm) });

    slicer.push(Float32Array.from([0, 1, -1, 2, -2, 0.5]));
    slicer.flush();

    expect([...slices[0]]).toEqual([0, 32767, -32768, 32767, -32768, 16384]);
  });

  it('interpolates across frame boundaries when resampling', () => {
    const slices: Int16Array[] = [];
    const slicer = createPcmSlicer({ inputSampleRate: 2 * SLICE_SAMPLE_RATE, onSlice: (pcm) => slices.push(pcm) });
    const ramp = Float32Array.from({ length: 12 }, (_, i) => i / 100);

    // A ramp split over uneven frames comes out as every other sample, as if it had arrived in one piece.
    slicer.push(ramp.subarray(0, 5));
    slicer.push(ramp.subarray(5, 7));
    slicer.push(ramp.subarray(7));
    slicer.flush();

    expect([...slices[0]]).toEqual([0, 2, 4, 6, 8, 10].map((i) => Math.round((i / 100) * 32767)));
  });
});

describe('downmix', () => {
  it('averages stereo into mono and passes mono through', () => {
    const mono = Float32Array.from([0.1, 0.2]);

    expect([...downmix([Float32Array.from([1, 0.5]), Float32Array.from([0, -0.5])])]).toEqual([0.5, 0]);
    expect(downmix([mono])).toBe(mono);
  });
});
