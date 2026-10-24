import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelDownloadProgress } from '../../../shared/transcription';
import { MODEL_FILE_NAME, ModelDownloadError, type ModelDescriptor } from './model';
import { createModelStore, type ModelDownloader } from './model-store';

/** Made-up model bytes standing in for the real 148 MB file. */
const MODEL_BYTES = Buffer.from('made-up speech model weights, version one');
const NEWER_BYTES = Buffer.from('made-up speech model weights, version two!');

function descriptorOf(bytes: Buffer, name: string): ModelDescriptor {
  return {
    url: `https://models.example.test/${name}`,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    sizeBytes: bytes.length,
  };
}

const MODEL = descriptorOf(MODEL_BYTES, 'v1');
const NEWER = descriptorOf(NEWER_BYTES, 'v2');

/** A fake downloader serving bytes per URL, in two chunks, so progress has something to report. */
function fakeDownloader(files: Record<string, Buffer>) {
  const download = vi.fn<ModelDownloader['download']>(async (url, destinationPath, onBytes) => {
    const bytes = files[url];
    const half = Math.floor(bytes.length / 2);
    writeFileSync(destinationPath, bytes.subarray(0, half));
    onBytes(half);
    writeFileSync(destinationPath, bytes);
    onBytes(bytes.length);
  });
  return { download };
}

describe('model store', () => {
  let appData: string;
  let folder: string;
  let progress: ModelDownloadProgress[];

  beforeEach(() => {
    appData = mkdtempSync(join(tmpdir(), 'grillo-model-'));
    folder = join(appData, 'models');
    progress = [];
  });

  afterEach(() => {
    rmSync(appData, { recursive: true, force: true });
  });

  function store(downloader: ModelDownloader) {
    return createModelStore({ folder, downloader, initialModel: MODEL, onProgress: (step) => progress.push(step) });
  }

  it('downloads the model once into the app data folder, reporting progress, and reuses it after', async () => {
    const downloader = fakeDownloader({ [MODEL.url]: MODEL_BYTES });

    await store(downloader).ensureModel();
    await store(downloader).ensureModel();

    expect(downloader.download).toHaveBeenCalledTimes(1);
    expect(readFileSync(join(folder, MODEL_FILE_NAME))).toEqual(MODEL_BYTES);
    expect(progress.at(-1)).toEqual({ receivedBytes: MODEL.sizeBytes, totalBytes: MODEL.sizeBytes });
  });

  it('shares one download between calls that arrive while it runs', async () => {
    const downloader = fakeDownloader({ [MODEL.url]: MODEL_BYTES });
    const models = store(downloader);

    await Promise.all([models.ensureModel(), models.ensureModel()]);

    expect(downloader.download).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['cut short', MODEL_BYTES.subarray(0, 10)],
    ['the right size but damaged', Buffer.from(MODEL_BYTES.toString().replace('one', 'eno'))],
  ])('re-downloads a model file on disk that is %s', async (_kind, corruptBytes) => {
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, MODEL_FILE_NAME), corruptBytes);
    const downloader = fakeDownloader({ [MODEL.url]: MODEL_BYTES });

    await store(downloader).ensureModel();

    expect(downloader.download).toHaveBeenCalledTimes(1);
    expect(readFileSync(join(folder, MODEL_FILE_NAME))).toEqual(MODEL_BYTES);
  });

  it('rejects a download that does not match the expected file, and leaves no model file behind', async () => {
    const downloader = fakeDownloader({ [MODEL.url]: NEWER_BYTES });

    await expect(store(downloader).ensureModel()).rejects.toThrow(ModelDownloadError);
    expect(existsSync(join(folder, MODEL_FILE_NAME))).toBe(false);
  });

  it('turns a failing downloader into a ModelDownloadError', async () => {
    const downloader: ModelDownloader = {
      download: async () => {
        throw new Error('socket hang up');
      },
    };

    await expect(store(downloader).ensureModel()).rejects.toThrow(ModelDownloadError);
  });

  it('installs a newer model, remembers its version, and keeps it across restarts', async () => {
    const downloader = fakeDownloader({ [MODEL.url]: MODEL_BYTES, [NEWER.url]: NEWER_BYTES });
    await store(downloader).ensureModel();

    await store(downloader).install(NEWER);
    const restarted = store(downloader);
    await restarted.ensureModel();

    expect(restarted.localVersion()).toBe(NEWER.sha256);
    expect(readFileSync(join(folder, MODEL_FILE_NAME))).toEqual(NEWER_BYTES);
    expect(downloader.download).toHaveBeenCalledTimes(2);
  });
});
