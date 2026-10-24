import { TranscriptionError, type SpeechEngine } from './transcriber';

/** The part of whisper.cpp's Node binding (`@fugood/whisper.node`) the engine uses. */
export interface WhisperContextLike {
  transcribeData(audio: ArrayBuffer, options?: { language?: string; temperature?: number }): {
    promise: Promise<unknown>;
  };
}

export interface WhisperBinding {
  initWhisper(options: { filePath: string }): Promise<WhisperContextLike>;
}

/** Loaded on first use only, so the app starts (and every other feature works) without the native binding. */
function loadWhisperBinding(): Promise<WhisperBinding> {
  return import('@fugood/whisper.node');
}

const LANGUAGE = 'en';
const GREEDY = 0;

function textOf(answer: unknown): string {
  const text = (answer as { result?: unknown } | null)?.result;
  if (typeof text !== 'string') {
    throw new TranscriptionError('The speech engine returned no text for the slice');
  }
  return text.trim();
}

/** whisper.cpp with the `base.en` model, opened lazily on the first slice. */
export function createWhisperEngine({
  modelPath,
  loadBinding = loadWhisperBinding,
}: {
  modelPath: string;
  loadBinding?: () => Promise<WhisperBinding>;
}): SpeechEngine {
  let context: Promise<WhisperContextLike> | undefined;

  const openContext = (): Promise<WhisperContextLike> => {
    context ??= loadBinding()
      .then((binding) => binding.initWhisper({ filePath: modelPath }))
      .catch((error: unknown) => {
        context = undefined;
        throw new TranscriptionError('The speech engine could not start', { cause: error });
      });
    return context;
  };

  return {
    async transcribe(pcm16k) {
      const whisper = await openContext();
      const audio = pcm16k.buffer.slice(pcm16k.byteOffset, pcm16k.byteOffset + pcm16k.byteLength) as ArrayBuffer;
      const answer = await whisper
        .transcribeData(audio, { language: LANGUAGE, temperature: GREEDY })
        .promise.catch((error: unknown) => {
          throw new TranscriptionError('The speech engine failed on a slice', { cause: error });
        });
      return textOf(answer);
    },
  };
}
