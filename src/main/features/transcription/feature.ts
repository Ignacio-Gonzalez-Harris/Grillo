import { isSpeechModelUpdates, SPEECH_MODEL_UPDATES_SETTING } from '../../../shared/transcription';
import type { Settings } from '../../app/settings';
import type { MainIpc } from '../../ipc/bridge';
import type { ModelDescriptor } from './model';
import type { ModelCatalog } from './model-catalog';
import { createModelStore, type ModelDownloader } from './model-store';
import { createModelUpdater, readUpdateMode } from './model-updates';

/**
 * Builds the speech-model store and updater and puts them on the IPC bridge: the renderer prepares the model,
 * reads and changes the update setting, and answers the update question; progress and the question are events.
 */
export function createTranscriptionFeature({
  ipc,
  settings,
  modelFolder,
  downloader,
  catalog,
  initialModel,
}: {
  ipc: MainIpc;
  settings: Settings;
  modelFolder: string;
  downloader: ModelDownloader;
  catalog: ModelCatalog;
  initialModel?: ModelDescriptor;
}): void {
  const store = createModelStore({
    folder: modelFolder,
    downloader,
    initialModel,
    onProgress: (progress) => ipc.send('transcription:model-progress', progress),
  });
  const updater = createModelUpdater({
    store,
    catalog,
    settings,
    onOffer: (offer) => ipc.send('transcription:model-update-available', offer),
  });

  ipc.handle('transcription:ensure-model', () => store.ensureModel());
  ipc.handle('transcription:get-model-updates', () => readUpdateMode(settings));
  ipc.handle('transcription:set-model-updates', (mode) => {
    if (!isSpeechModelUpdates(mode)) {
      throw new Error(`'${String(mode)}' is not a speech-model update mode`);
    }
    settings.set(SPEECH_MODEL_UPDATES_SETTING, mode);
  });
  ipc.handle('transcription:check-model-update', () => updater.checkModelUpdate());
  ipc.handle('transcription:install-model-update', () => updater.installModelUpdate());
}
