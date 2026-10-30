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

  it('says when the engine starts each slice: only once every slice before it is done', async () => {
    const { engine, pending, settle } = controllableEngine();
    const transcriber = createTranscriber(engine);
    const started: number[] = [];

    void transcriber.transcribe(slice(1), { started: () => started.push(1) });
    void transcriber.transcribe(slice(2), { started: () => started.push(2) });
    await settle();
    expect(started).toEqual([1]);

    pending.get(1)?.resolve('first words');
    await settle();
    expect(started).toEqual([1, 2]);
  });

  it('leaves out a slice its caller gives up on, and starts the next one even though the engine never answered', async () => {
    const { engine, pending, settle } = controllableEngine();
    const transcriber = createTranscriber(engine);
    const giveUp = new AbortController();

    const stuck = transcriber.transcribe(slice(1), { signal: giveUp.signal });
    const next = transcriber.transcribe(slice(2));
    await settle();
    expect(pending.has(2)).toBe(false);

    giveUp.abort();
    await expect(stuck).rejects.toThrow(TranscriptionError);
    await settle();
    pending.get(2)?.resolve('still listening');

    await expect(next).resolves.toBe('still listening');
  });

  it('never hands the engine a slice its caller gave up on before it started', async () => {
    const { engine, pending, settle } = controllableEngine();
    const transcriber = createTranscriber(engine);
    const giveUp = new AbortController();

    void transcriber.transcribe(slice(1));
    const dropped = transcriber.transcribe(slice(2), { signal: giveUp.signal });
    giveUp.abort();
    await settle();
    pending.get(1)?.resolve('first words');

    await expect(dropped).rejects.toThrow(TranscriptionError);
    await settle();
    expect(pending.has(2)).toBe(false);
  });

  it('refuses an empty slice before it reaches the engine', async () => {
    const { engine, pending } = controllableEngine();

    await expect(createTranscriber(engine).transcribe(new Int16Array(0))).rejects.toThrow(TranscriptionError);
    expect(pending.size).toBe(0);
  });
});
