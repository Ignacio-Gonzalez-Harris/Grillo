import { describe, expect, it, vi } from 'vitest';
import { TranscriptionError } from './transcriber';
import { createWhisperEngine, type WhisperBinding } from './whisper-engine';

const MODEL_PATH = '/made-up/app-data/models/ggml-base.en.bin';

function fakeBinding(answer: unknown) {
  const transcribeData = vi.fn((_audio: ArrayBuffer, _options?: object) => ({ promise: Promise.resolve(answer) }));
  const initWhisper = vi.fn(async (_options: { filePath: string }) => ({ transcribeData }));
  const binding: WhisperBinding = { initWhisper };
  return { binding, initWhisper, transcribeData };
}

describe('whisper engine', () => {
  it('loads the binding only on the first slice, once, and opens the model file it was given', async () => {
    const { binding, initWhisper } = fakeBinding({ result: 'hello' });
    const loadBinding = vi.fn(async () => binding);

    const engine = createWhisperEngine({ modelPath: MODEL_PATH, loadBinding });
    expect(loadBinding).not.toHaveBeenCalled();

    await engine.transcribe(Int16Array.of(1, 2));
    await engine.transcribe(Int16Array.of(3, 4));

    expect(loadBinding).toHaveBeenCalledTimes(1);
    expect(initWhisper).toHaveBeenCalledTimes(1);
    expect(initWhisper).toHaveBeenCalledWith({ filePath: MODEL_PATH });
  });

  it('hands the slice over as raw 16-bit PCM in English and returns the trimmed text', async () => {
    const { binding, transcribeData } = fakeBinding({ result: '  The room is booked.  ' });
    const engine = createWhisperEngine({ modelPath: MODEL_PATH, loadBinding: async () => binding });
    const samples = Int16Array.of(-1, 0, 32767);
    const sliceOfLargerBuffer = new Int16Array(Int16Array.of(9, ...samples).buffer, 2, 3);

    await expect(engine.transcribe(sliceOfLargerBuffer)).resolves.toBe('The room is booked.');

    const [audio, options] = transcribeData.mock.calls[0];
    expect(new Int16Array(audio)).toEqual(samples);
    expect(options).toMatchObject({ language: 'en' });
  });

  it('turns a binding that will not load into a TranscriptionError on the slice, not at start-up', async () => {
    const engine = createWhisperEngine({
      modelPath: MODEL_PATH,
      loadBinding: async () => {
        throw new Error('Cannot find module');
      },
    });

    await expect(engine.transcribe(Int16Array.of(1))).rejects.toThrow(TranscriptionError);
  });

  it('turns an engine failure on a slice into a TranscriptionError', async () => {
    const transcribeData = () => ({ promise: Promise.reject(new Error('native failure')) });
    const engine = createWhisperEngine({
      modelPath: MODEL_PATH,
      loadBinding: async () => ({ initWhisper: async () => ({ transcribeData }) }),
    });

    await expect(engine.transcribe(Int16Array.of(1))).rejects.toThrow(TranscriptionError);
  });

  it.each([
    ['null', null],
    ['no result field', {}],
    ['a result that is not text', { result: 42 }],
  ])('turns a malformed engine answer (%s) into a TranscriptionError', async (_kind, answer) => {
    const { binding } = fakeBinding(answer);
    const engine = createWhisperEngine({ modelPath: MODEL_PATH, loadBinding: async () => binding });

    await expect(engine.transcribe(Int16Array.of(1))).rejects.toThrow(TranscriptionError);
  });
});
