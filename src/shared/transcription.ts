/**
 * The local speech-to-text contract (PRD section 8, Speech-to-text): the model-update setting and the
 * IPC channels the renderer uses to prepare the speech model and answer the update question.
 */

/** What Grillo does when a newer speech model is published. */
export const SPEECH_MODEL_UPDATE_MODES = ['automatic', 'ask', 'never'] as const;
export type SpeechModelUpdates = (typeof SPEECH_MODEL_UPDATE_MODES)[number];

/** The settings-file key that holds the mode, and the mode used until the person picks one. */
export const SPEECH_MODEL_UPDATES_SETTING = 'speechModelUpdates';
export const DEFAULT_SPEECH_MODEL_UPDATES: SpeechModelUpdates = 'ask';

export function isSpeechModelUpdates(value: unknown): value is SpeechModelUpdates {
  return (SPEECH_MODEL_UPDATE_MODES as readonly unknown[]).includes(value);
}

/** How far a speech-model download has got. */
export interface ModelDownloadProgress {
  receivedBytes: number;
  totalBytes: number;
}

/** A model version is the SHA-256 of the model file, so a republish of the same file is not an update. */
export interface ModelUpdateOffer {
  localVersion: string;
  publishedVersion: string;
}

/** What one update check did. */
export type ModelUpdateCheck =
  | { status: 'skipped' }
  | { status: 'up-to-date' }
  | { status: 'installed'; version: string }
  | { status: 'asked'; offer: ModelUpdateOffer }
  | { status: 'check-failed'; reason: string };

declare module './ipc' {
  interface InvokeChannels {
    /** Downloads the speech model if it is missing or corrupt; progress arrives on `transcription:model-progress`. */
    'transcription:ensure-model': { request: void; response: void };
    'transcription:get-model-updates': { request: void; response: SpeechModelUpdates };
    'transcription:set-model-updates': { request: SpeechModelUpdates; response: void };
    'transcription:check-model-update': { request: void; response: ModelUpdateCheck };
    /** The "yes" to a `transcription:model-update-available` question. */
    'transcription:install-model-update': { request: void; response: void };
  }
  interface EventChannels {
    'transcription:model-progress': ModelDownloadProgress;
    'transcription:model-update-available': ModelUpdateOffer;
  }
}
