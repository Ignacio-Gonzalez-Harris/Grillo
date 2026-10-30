/** Turns 16 kHz mono 16-bit PCM into text. The real one is whisper.cpp; tests use a fake. */
export interface SpeechEngine {
  transcribe(pcm16k: Int16Array): Promise<string>;
  /**
   * Gives up on the call in progress: it may run on, but the next call never waits behind it. An engine that runs
   * calls side by side needs none.
   */
  abandonCurrent?(): void;
}

/** The one error a caller of the transcription feature handles. */
export class TranscriptionError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'TranscriptionError';
  }
}

/** What the caller of one slice's transcription may follow and decide. */
export interface SliceControl {
  /** Called when the engine starts on the slice, which is once every slice before it is done or left out. */
  started?(): void;
  /**
   * Aborted, the slice is left out: its text rejects with a `TranscriptionError` and the next slice starts, even if
   * the engine never answers this one.
   */
  signal?: AbortSignal;
}

export interface Transcriber {
  /** Resolves with the text of one slice (5 seconds in live delivery). */
  transcribe(slicePcm16k: Int16Array, control?: SliceControl): Promise<string>;
}

function leftOut(): TranscriptionError {
  return new TranscriptionError('The slice was left out: it took too long to transcribe');
}

/** One slice on the engine, unless the caller gave up on it first; giving up later settles it at once. */
function runSlice(engine: SpeechEngine, pcm: Int16Array, { started, signal }: SliceControl): Promise<string> {
  if (signal?.aborted) return Promise.reject(leftOut());
  started?.();
  const text = engine.transcribe(pcm);
  if (signal === undefined) return text;
  return new Promise<string>((resolve, reject) => {
    const giveUp = () => {
      engine.abandonCurrent?.();
      reject(leftOut());
    };
    signal.addEventListener('abort', giveUp, { once: true });
    text.then(resolve, reject).finally(() => signal.removeEventListener('abort', giveUp));
  });
}

/**
 * Queues slices and hands them to the engine one at a time, in arrival order. A slow outlier delays the
 * slices behind it but never lets them overtake it, so the text always comes out in the order it was spoken.
 * A slice its caller gives up on stops holding the queue: the engine abandons that call, so the next slice starts, and
 * its clock with it, only once the engine is really free for it.
 */
export function createTranscriber(engine: SpeechEngine): Transcriber {
  let queueTail: Promise<unknown> = Promise.resolve();
  return {
    transcribe(slicePcm16k, control = {}) {
      if (slicePcm16k.length === 0) {
        return Promise.reject(new TranscriptionError('An audio slice must hold at least one sample'));
      }
      const text = queueTail.then(() => runSlice(engine, slicePcm16k, control));
      queueTail = text.catch(() => undefined);
      return text;
    },
  };
}
