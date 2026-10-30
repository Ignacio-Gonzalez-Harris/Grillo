import { TranscriptionError, type SpeechEngine } from './transcriber';

/** The part of whisper.cpp's Node binding (`@fugood/whisper.node`) the engine uses. */
export interface WhisperContextLike {
  /** Runs one call at a time per context: a second call waits for the first, which cannot be interrupted. */
  transcribeData(audio: ArrayBuffer, options?: { language?: string; temperature?: number }): {
    promise: Promise<unknown>;
  };
  /** Frees the model's memory; called only once the context has no call running. */
  release?(): Promise<void>;
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

function ignore(): void {
  // Nothing to do: the outcome was already given up on.
}

/**
 * whisper.cpp with the `base.en` model, opened lazily on the first slice. A context runs one call at a time and a
 * running call cannot be stopped, so a call given up on keeps its context to itself: the next slice opens a fresh one
 * and never waits behind it, and the old context is freed once its call ends (never, if it never answers).
 */
export function createWhisperEngine({
  modelPath,
  loadBinding = loadWhisperBinding,
}: {
  modelPath: string;
  loadBinding?: () => Promise<WhisperBinding>;
}): SpeechEngine {
  let context: Promise<WhisperContextLike> | undefined;
  /** The call in progress and the context it runs on. */
  let current: { context: Promise<WhisperContextLike>; done: Promise<unknown> } | undefined;

  const openContext = (): Promise<WhisperContextLike> => {
    if (context) return context;
    const opening = loadBinding()
      .then((binding) => binding.initWhisper({ filePath: modelPath }))
      .catch((error: unknown) => {
        if (context === opening) context = undefined;
        throw new TranscriptionError('The speech engine could not start', { cause: error });
      });
    context = opening;
    return opening;
  };

  async function run(opened: Promise<WhisperContextLike>, pcm16k: Int16Array): Promise<string> {
    const whisper = await opened;
    const audio = pcm16k.buffer.slice(pcm16k.byteOffset, pcm16k.byteOffset + pcm16k.byteLength) as ArrayBuffer;
    const answer = await whisper
      .transcribeData(audio, { language: LANGUAGE, temperature: GREEDY })
      .promise.catch((error: unknown) => {
        throw new TranscriptionError('The speech engine failed on a slice', { cause: error });
      });
    return textOf(answer);
  }

  return {
    transcribe(pcm16k) {
      const opened = openContext();
      const done = run(opened, pcm16k);
      const call = { context: opened, done };
      current = call;
      const finished = () => {
        if (current === call) current = undefined;
      };
      done.then(finished, finished);
      return done;
    },

    abandonCurrent() {
      const call = current;
      if (call === undefined) return;
      current = undefined;
      if (context === call.context) context = undefined;
      const release = () => {
        call.context.then((whisper) => whisper.release?.()).catch(ignore);
      };
      call.done.then(release, release);
    },
  };
}
