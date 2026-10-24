import { describe, expect, it } from 'vitest';
import { createTranscriber, TranscriptionError, type SpeechEngine } from './transcriber';

/** One made-up 16 kHz slice per label; the label rides in the first sample so the fake can tell slices apart. */
function slice(label: number): Int16Array {
  return Int16Array.of(label, 0, 0);
}

/** A fake engine whose slices finish only when the test releases them, in any order the test likes. */
function controllableEngine() {
  const pending = new Map<number, { resolve: (text: string) => void; reject: (error: Error) => void }>();
  let running = 0;
  let mostAtOnce = 0;
  const engine: SpeechEngine = {
    transcribe(pcm) {
      running += 1;
      mostAtOnce = Math.max(mostAtOnce, running);
      return new Promise<string>((resolve, reject) => {
        pending.set(pcm[0], {
          resolve: (text) => {
            running -= 1;
            resolve(text);
          },
          reject: (error) => {
            running -= 1;
            reject(error);
          },
        });
      });
    },
  };
  const settle = async () => {
    for (let turn = 0; turn < 5; turn += 1) {
      await Promise.resolve();
    }
  };
  return { engine, pending, settle, mostAtOnce: () => mostAtOnce };
}

describe('transcriber queue', () => {
  it('returns the text of each slice, in the order the slices arrived, even when the first is a slow outlier', async () => {
    const { engine, pending, settle, mostAtOnce } = controllableEngine();
    const transcriber = createTranscriber(engine);
    const finished: string[] = [];

    const first = transcriber.transcribe(slice(1)).then((text) => finished.push(text));
    const second = transcriber.transcribe(slice(2)).then((text) => finished.push(text));
    await settle();

    expect(pending.has(2)).toBe(false);
    pending.get(1)?.resolve('the room is booked');
    await settle();
    pending.get(2)?.resolve('for Tuesday');
    await Promise.all([first, second]);

    expect(finished).toEqual(['the room is booked', 'for Tuesday']);
    expect(mostAtOnce()).toBe(1);
  });

  it('keeps going after a slice fails, and rejects only that slice', async () => {
    const { engine, pending, settle } = controllableEngine();
    const transcriber = createTranscriber(engine);

    const failing = transcriber.transcribe(slice(1));
    const next = transcriber.transcribe(slice(2));
    await settle();
    pending.get(1)?.reject(new Error('engine hiccup'));
    await expect(failing).rejects.toThrow('engine hiccup');
    await settle();
    pending.get(2)?.resolve('still listening');

    await expect(next).resolves.toBe('still listening');
  });

  it('refuses an empty slice before it reaches the engine', async () => {
    const { engine, pending } = controllableEngine();

    await expect(createTranscriber(engine).transcribe(new Int16Array(0))).rejects.toThrow(TranscriptionError);
    expect(pending.size).toBe(0);
  });
});
