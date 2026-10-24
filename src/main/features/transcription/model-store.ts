import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { ModelDownloadProgress } from '../../../shared/transcription';
import { MODEL_FILE_NAME, ModelDownloadError, PINNED_MODEL, type ModelDescriptor } from './model';

/** Fetches one file to a path, reporting the running byte count. The real one uses HTTP; tests use a fake. */
export interface ModelDownloader {
  download(url: string, destinationPath: string, onBytes: (receivedBytes: number) => void): Promise<void>;
}

/** Records which model the file on disk is, so the update check knows the local version. */
const MANIFEST_FILE_NAME = 'ggml-base.en.json';
const PERCENT = 100;

export interface ModelStore {
  readonly modelPath: string;
  /** The SHA-256 of the model the store expects on disk. */
  localVersion(): string;
  /** Makes sure a verified model file is on disk: downloads it if it is missing or corrupt. */
  ensureModel(): Promise<void>;
  /** Downloads and verifies another model, then replaces the file on disk with it. */
  install(model: ModelDescriptor): Promise<void>;
}

function isDescriptor(value: unknown): value is ModelDescriptor {
  const candidate = value as Partial<ModelDescriptor> | null;
  return (
    typeof candidate?.url === 'string' &&
    typeof candidate.sha256 === 'string' &&
    typeof candidate.sizeBytes === 'number'
  );
}

function readManifest(manifestPath: string): ModelDescriptor | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'));
    return isDescriptor(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

async function sha256Of(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(filePath), hash);
  return hash.digest('hex');
}

/** True when the file has the model's exact size and checksum. The size is checked first: it is free. */
async function matches(filePath: string, model: ModelDescriptor): Promise<boolean> {
  if (!existsSync(filePath) || statSync(filePath).size !== model.sizeBytes) {
    return false;
  }
  return (await sha256Of(filePath)) === model.sha256;
}

/** Reports progress at most once per whole percent, so a 148 MB download sends about a hundred events. */
function percentReporter(totalBytes: number, onProgress: (progress: ModelDownloadProgress) => void) {
  let lastPercent = -1;
  return (receivedBytes: number) => {
    const percent = Math.floor((receivedBytes * PERCENT) / totalBytes);
    if (percent !== lastPercent) {
      lastPercent = percent;
      onProgress({ receivedBytes, totalBytes });
    }
  };
}

export function createModelStore({
  folder,
  downloader,
  onProgress,
  initialModel = PINNED_MODEL,
}: {
  folder: string;
  downloader: ModelDownloader;
  onProgress: (progress: ModelDownloadProgress) => void;
  initialModel?: ModelDescriptor;
}): ModelStore {
  const modelPath = join(folder, MODEL_FILE_NAME);
  const manifestPath = join(folder, MANIFEST_FILE_NAME);
  const expectedModel = (): ModelDescriptor => readManifest(manifestPath) ?? initialModel;

  const installNow = async (model: ModelDescriptor): Promise<void> => {
    mkdirSync(folder, { recursive: true });
    const partPath = `${modelPath}.part`;
    rmSync(partPath, { force: true });
    try {
      await downloader.download(model.url, partPath, percentReporter(model.sizeBytes, onProgress));
    } catch (error) {
      rmSync(partPath, { force: true });
      throw new ModelDownloadError('The speech model download failed', { cause: error });
    }
    if (!(await matches(partPath, model))) {
      rmSync(partPath, { force: true });
      throw new ModelDownloadError('The downloaded speech model does not match its expected size and checksum');
    }
    renameSync(partPath, modelPath);
    writeFileSync(manifestPath, `${JSON.stringify(model, null, 2)}\n`, 'utf8');
  };

  // Downloads and installs run one at a time, so two of them never write the same file.
  let lock: Promise<unknown> = Promise.resolve();
  const exclusive = <T>(task: () => Promise<T>): Promise<T> => {
    const run = lock.then(task);
    lock = run.catch(() => undefined);
    return run;
  };

  let ensuring: Promise<void> | undefined;

  return {
    modelPath,
    localVersion: () => expectedModel().sha256,
    ensureModel() {
      ensuring ??= exclusive(async () => {
        const model = expectedModel();
        if (!(await matches(modelPath, model))) {
          await installNow(model);
        }
      }).finally(() => {
        ensuring = undefined;
      });
      return ensuring;
    },
    install: (model) => exclusive(() => installNow(model)),
  };
}
