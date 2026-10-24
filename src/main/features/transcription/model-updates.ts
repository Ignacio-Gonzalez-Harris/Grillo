import {
  DEFAULT_SPEECH_MODEL_UPDATES,
  isSpeechModelUpdates,
  SPEECH_MODEL_UPDATES_SETTING,
  type ModelUpdateCheck,
  type ModelUpdateOffer,
  type SpeechModelUpdates,
} from '../../../shared/transcription';
import type { Settings } from '../../app/settings';
import type { ModelDescriptor } from './model';
import { ModelCatalogError, type ModelCatalog } from './model-catalog';
import type { ModelStore } from './model-store';

/** The person's choice from the settings file; anything unrecognised there counts as the default, ask. */
export function readUpdateMode(settings: Settings): SpeechModelUpdates {
  const stored = settings.get<unknown>(SPEECH_MODEL_UPDATES_SETTING, DEFAULT_SPEECH_MODEL_UPDATES);
  return isSpeechModelUpdates(stored) ? stored : DEFAULT_SPEECH_MODEL_UPDATES;
}

export interface ModelUpdater {
  /** Compares the published model with the local one and acts on the setting: download, ask, or nothing. */
  checkModelUpdate(): Promise<ModelUpdateCheck>;
  /** Installs the update the last check offered (the "yes" to the question). */
  installModelUpdate(): Promise<void>;
}

export function createModelUpdater({
  store,
  catalog,
  settings,
  onOffer,
}: {
  store: Pick<ModelStore, 'localVersion' | 'install'>;
  catalog: ModelCatalog;
  settings: Settings;
  onOffer: (offer: ModelUpdateOffer) => void;
}): ModelUpdater {
  let offered: ModelDescriptor | undefined;

  return {
    async checkModelUpdate() {
      const mode = readUpdateMode(settings);
      if (mode === 'never') {
        return { status: 'skipped' };
      }
      let published: ModelDescriptor;
      try {
        published = await catalog.published();
      } catch (error) {
        if (error instanceof ModelCatalogError) {
          return { status: 'check-failed', reason: error.message };
        }
        throw error;
      }
      const localVersion = store.localVersion();
      if (published.sha256 === localVersion) {
        return { status: 'up-to-date' };
      }
      if (mode === 'automatic') {
        await store.install(published);
        return { status: 'installed', version: published.sha256 };
      }
      offered = published;
      const offer = { localVersion, publishedVersion: published.sha256 };
      onOffer(offer);
      return { status: 'asked', offer };
    },
    async installModelUpdate() {
      if (!offered) {
        throw new Error('No speech-model update is waiting to be installed');
      }
      await store.install(offered);
      offered = undefined;
    },
  };
}
