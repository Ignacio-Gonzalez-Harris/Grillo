import { describe, expect, it, vi } from 'vitest';
import { SPEECH_MODEL_UPDATES_SETTING, type ModelUpdateOffer } from '../../../shared/transcription';
import type { Settings } from '../../app/settings';
import type { ModelDescriptor } from './model';
import { ModelCatalogError, type ModelCatalog } from './model-catalog';
import type { ModelStore } from './model-store';
import { createModelUpdater, readUpdateMode } from './model-updates';

const LOCAL_VERSION = '1'.repeat(64);
const PUBLISHED: ModelDescriptor = { url: 'https://models.example.test/v2', sha256: '2'.repeat(64), sizeBytes: 42 };

function settingsWith(values: Record<string, unknown>): Settings {
  return {
    get: (key, defaultValue) => (Object.hasOwn(values, key) ? (values[key] as typeof defaultValue) : defaultValue),
    set: (key, value) => {
      values[key] = value;
    },
  };
}

function updaterFor(mode: unknown, published: () => Promise<ModelDescriptor> = async () => PUBLISHED) {
  const catalog: ModelCatalog = { published: vi.fn(published) };
  const store: Pick<ModelStore, 'localVersion' | 'install'> = {
    localVersion: () => LOCAL_VERSION,
    install: vi.fn(async () => undefined),
  };
  const offers: ModelUpdateOffer[] = [];
  const settings = settingsWith(mode === undefined ? {} : { [SPEECH_MODEL_UPDATES_SETTING]: mode });
  const updater = createModelUpdater({ store, catalog, settings, onOffer: (offer) => offers.push(offer) });
  return { updater, catalog, store, offers };
}

describe('speech-model update setting', () => {
  it.each([
    [undefined, 'ask'],
    ['automatic', 'automatic'],
    ['never', 'never'],
    ['sometimes', 'ask'],
    [null, 'ask'],
  ])('reads %j from the settings file as %s', (stored, expected) => {
    expect(readUpdateMode(settingsWith(stored === undefined ? {} : { [SPEECH_MODEL_UPDATES_SETTING]: stored }))).toBe(
      expected,
    );
  });
});

describe('speech-model update check', () => {
  it('does nothing, not even a network call, when updates are set to never', async () => {
    const { updater, catalog, store } = updaterFor('never');

    await expect(updater.checkModelUpdate()).resolves.toEqual({ status: 'skipped' });
    expect(catalog.published).not.toHaveBeenCalled();
    expect(store.install).not.toHaveBeenCalled();
  });

  it('downloads the published model straight away when updates are automatic', async () => {
    const { updater, store, offers } = updaterFor('automatic');

    await expect(updater.checkModelUpdate()).resolves.toEqual({ status: 'installed', version: PUBLISHED.sha256 });
    expect(store.install).toHaveBeenCalledWith(PUBLISHED);
    expect(offers).toEqual([]);
  });

  it('asks before downloading when updates are set to ask, and installs on the yes', async () => {
    const { updater, store, offers } = updaterFor('ask');
    const offer = { localVersion: LOCAL_VERSION, publishedVersion: PUBLISHED.sha256 };

    await expect(updater.checkModelUpdate()).resolves.toEqual({ status: 'asked', offer });
    expect(offers).toEqual([offer]);
    expect(store.install).not.toHaveBeenCalled();

    await updater.installModelUpdate();
    expect(store.install).toHaveBeenCalledWith(PUBLISHED);
  });

  it('reports up to date when the published model is the one on disk', async () => {
    const { updater, store } = updaterFor('automatic', async () => ({ ...PUBLISHED, sha256: LOCAL_VERSION }));

    await expect(updater.checkModelUpdate()).resolves.toEqual({ status: 'up-to-date' });
    expect(store.install).not.toHaveBeenCalled();
  });

  it('reports a failed check instead of throwing when the catalog cannot be read', async () => {
    const { updater } = updaterFor('ask', async () => {
      throw new ModelCatalogError('The model catalog could not be read');
    });

    await expect(updater.checkModelUpdate()).resolves.toEqual({
      status: 'check-failed',
      reason: 'The model catalog could not be read',
    });
  });

  it('refuses an install when no update was offered', async () => {
    const { updater, store } = updaterFor('ask');

    await expect(updater.installModelUpdate()).rejects.toThrow('No speech-model update is waiting');
    expect(store.install).not.toHaveBeenCalled();
  });
});
