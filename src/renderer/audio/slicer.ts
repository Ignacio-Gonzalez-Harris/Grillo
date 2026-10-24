import { SAMPLES_PER_SLICE, SLICE_SAMPLE_RATE } from '../../shared/audio';

const INT16_NEGATIVE_LIMIT = 32768;
const INT16_POSITIVE_LIMIT = 32767;

/** Averages the channels of one audio frame into a single mono channel. */
export function downmix(channels: readonly Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0];
  const mono = new Float32Array(channels[0]?.length ?? 0);
  for (const channel of channels) {
    for (let i = 0; i < mono.length; i += 1) mono[i] += channel[i] / channels.length;
  }
  return mono;
}

function toInt16(sample: number): number {
  const clamped = Math.max(-1, Math.min(1, sample));
  return Math.round(clamped < 0 ? clamped * INT16_NEGATIVE_LIMIT : clamped * INT16_POSITIVE_LIMIT);
}

export interface PcmSlicer {
  /** Takes the next mono frame of float samples (-1 to 1) at the input rate. */
  push(frame: Float32Array): void;
  /** Hands over what is left as a last, shorter slice, if anything is left. */
  flush(): void;
}

/**
 * Turns a stream of mono float frames into 16 kHz 16-bit slices of `SAMPLES_PER_SLICE` samples. Input at
 * another rate is resampled by straight-line interpolation; the capture asks the audio context for 16 kHz,
 * so Chromium's own filtered resampler normally does that work and this one passes samples through.
 */
export function createPcmSlicer(options: { inputSampleRate: number; onSlice: (pcm: Int16Array) => void }): PcmSlicer {
  const step = options.inputSampleRate / SLICE_SAMPLE_RATE;
  let slice = new Int16Array(SAMPLES_PER_SLICE);
  let filled = 0;
  // The last input sample of the previous frame, and where the next output sample falls, counted in input
  // samples from that previous sample (or from the frame start before the first frame).
  let previous: number | null = null;
  let position = 0;

  function emit(sample: number): void {
    slice[filled] = toInt16(sample);
    filled += 1;
    if (filled === SAMPLES_PER_SLICE) {
      options.onSlice(slice);
      slice = new Int16Array(SAMPLES_PER_SLICE);
      filled = 0;
    }
  }

  return {
    push(frame) {
      if (frame.length === 0) return;
      const offset = previous === null ? 0 : 1;
      const at = (i: number): number => (i < offset ? (previous as number) : frame[i - offset]);
      const last = frame.length + offset - 1;
      for (; position <= last; position += step) {
        const index = Math.floor(position);
        const fraction = position - index;
        emit(fraction === 0 ? at(index) : at(index) * (1 - fraction) + at(index + 1) * fraction);
      }
      position -= last;
      previous = frame[frame.length - 1];
    },
    flush() {
      if (filled > 0) options.onSlice(slice.slice(0, filled));
      slice = new Int16Array(SAMPLES_PER_SLICE);
      filled = 0;
    },
  };
}
