import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGrilloApi } from '../../../preload/bridge';
import type { ModelDownloadProgress, ModelUpdateOffer, SpeechModelUpdates } from '../../../shared/transcription';
import { createSettings, SETTINGS_FILE_NAME } from '../../app/settings';
import { createMainIpc } from '../../ipc/bridge';
import { createFakeIpc } from '../../ipc/fake-ipc';
import { createTranscriptionFeature } from './feature';
import type { ModelDescriptor } from './model';

const MODEL_BYTES = Buffer.from('made-up speech model weights');
const MODEL: ModelDescriptor = {
  url: 'https://models.example.test/v1',
  sha256: createHash('sha256').update(MODEL_BYTES).digest('hex'),
  sizeBytes: MODEL_BYTES.length,
};
const PUBLISHED: ModelDescriptor = { url: 'https://models.example.test/v2', sha256: 'f'.repeat(64), sizeBytes: 9 };

describe('transcription feature over IPC', () => {
  let appData: string;

  beforeEach(() => {
    appData = mkdtempSync(join(tmpdir(), 'grillo-transcription-'));
  });

  afterEach(() => {
    rmSync(appData, { recursive: true, force: true });
  });

  function connect() {
    const fake = createFakeIpc();
    createTranscriptionFeature({
      ipc: createMainIpc(fake.main, () => [fake.window]),
      settings: createSettings(join(appData, SETTINGS_FILE_NAME)),
      modelFolder: join(appData, 'models'),
      initialModel: MODEL,
      downloader: {
        async download(_url, destinationPath, onBytes) {
          writeFileSync(destinationPath, MODEL_BYTES);
          onBytes(MODEL_BYTES.length);
        },
      },
      catalog: { published: async () => PUBLISHED },
    });
    return createGrilloApi(fake.renderer);
  }

  it('prepares the model on request and reports its download progress to the renderer', async () => {
    const grillo = connect();
    const progress: ModelDownloadProgress[] = [];
    grillo.on('transcription:model-progress', (step) => progress.push(step));

    await grillo.invoke('transcription:ensure-model', undefined);

    expect(progress).toEqual([{ receivedBytes: MODEL.sizeBytes, totalBytes: MODEL.sizeBytes }]);
  });

  it('keeps the update setting in the settings file, ask until changed, and refuses an unknown mode', async () => {
    const grillo = connect();
    await expect(grillo.invoke('transcription:get-model-updates', undefined)).resolves.toBe('ask');

    await grillo.invoke('transcription:set-model-updates', 'never');
    await expect(
      grillo.invoke('transcription:set-model-updates', 'sometimes' as SpeechModelUpdates),
    ).rejects.toThrow("'sometimes' is not a speech-model update mode");

    await expect(connect().invoke('transcription:get-model-updates', undefined)).resolves.toBe('never');
  });

  it('sends the renderer the update question when a newer model is published and the setting is ask', async () => {
    const grillo = connect();
    const offers: ModelUpdateOffer[] = [];
    grillo.on('transcription:model-update-available', (offer) => offers.push(offer));

    await grillo.invoke('transcription:check-model-update', undefined);

    expect(offers).toEqual([{ localVersion: MODEL.sha256, publishedVersion: PUBLISHED.sha256 }]);
  });
});
