/** Turns 16 kHz mono 16-bit PCM into text. The real one is whisper.cpp; tests use a fake. */
export interface SpeechEngine {
  transcribe(pcm16k: Int16Array): Promise<string>;
}

/** The one error a caller of the transcription feature handles. */
export class TranscriptionError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'TranscriptionError';
  }
}

export interface Transcriber {
  /** Resolves with the text of one slice (5 seconds in live delivery). */
  transcribe(slicePcm16k: Int16Array): Promise<string>;
}

/**
 * Queues slices and hands them to the engine one at a time, in arrival order. A slow outlier delays the
 * slices behind it but never lets them overtake it, so the text always comes out in the order it was spoken.
 */
export function createTranscriber(engine: SpeechEngine): Transcriber {
  let queueTail: Promise<unknown> = Promise.resolve();
  return {
    transcribe(slicePcm16k) {
      if (slicePcm16k.length === 0) {
        return Promise.reject(new TranscriptionError('An audio slice must hold at least one sample'));
      }
      const text = queueTail.then(() => engine.transcribe(slicePcm16k));
      queueTail = text.catch(() => undefined);
      return text;
    },
  };
}
