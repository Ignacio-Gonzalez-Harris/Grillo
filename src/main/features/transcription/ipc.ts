import { app, net } from 'electron';
import type { FeatureContext } from '../../app/features';
import { createTranscriptionFeature } from './feature';
import { modelFolderIn } from './model';
import { createHuggingFaceCatalog } from './model-catalog';
import { createFetchDownloader, type FetchLike } from './model-download';

/** Local speech-to-text: the speech model in the app data folder, and its update setting. */
export function register({ ipc, settings }: FeatureContext): void {
  const fetchViaSystemProxy: FetchLike = (url) => net.fetch(url);
  createTranscriptionFeature({
    ipc,
    settings,
    modelFolder: modelFolderIn(app.getPath('userData')),
    downloader: createFetchDownloader(fetchViaSystemProxy),
    catalog: createHuggingFaceCatalog(fetchViaSystemProxy),
  });
}
