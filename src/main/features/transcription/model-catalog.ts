import { MODEL_FILE_NAME, MODEL_REPOSITORY, modelDownloadUrl, type ModelDescriptor } from './model';
import type { FetchLike } from './model-download';

/** Says which model file is published now. */
export interface ModelCatalog {
  published(): Promise<ModelDescriptor>;
}

/** The one error any failed or malformed catalog answer becomes. */
export class ModelCatalogError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ModelCatalogError';
  }
}

/** The repository's latest commit with each file's size and SHA-256, in one public, unauthenticated call. */
const LATEST_REVISION_URL = `https://huggingface.co/api/models/${MODEL_REPOSITORY}/revision/main?blobs=true`;
const COMMIT_HASH = /^[0-9a-f]{40}$/;
const SHA256_HASH = /^[0-9a-f]{64}$/;

interface Sibling {
  rfilename?: unknown;
  lfs?: { sha256?: unknown; size?: unknown } | null;
}

function parseRevision(body: unknown): ModelDescriptor {
  const revision = body as { sha?: unknown; siblings?: unknown } | null;
  if (typeof revision?.sha !== 'string' || !COMMIT_HASH.test(revision.sha)) {
    throw new ModelCatalogError('The model catalog named no valid commit');
  }
  if (!Array.isArray(revision.siblings)) {
    throw new ModelCatalogError('The model catalog listed no files');
  }
  const entries = (revision.siblings as (Sibling | null)[]).filter((file) => file?.rfilename === MODEL_FILE_NAME);
  if (entries.length !== 1) {
    throw new ModelCatalogError(`The model catalog listed ${MODEL_FILE_NAME} ${entries.length} times`);
  }
  const { sha256, size } = entries[0]?.lfs ?? {};
  if (typeof sha256 !== 'string' || !SHA256_HASH.test(sha256)) {
    throw new ModelCatalogError('The model catalog gave no valid SHA-256 for the model');
  }
  if (typeof size !== 'number' || !Number.isSafeInteger(size) || size <= 0) {
    throw new ModelCatalogError('The model catalog gave no valid size for the model');
  }
  return { url: modelDownloadUrl(revision.sha), sha256, sizeBytes: size };
}

export function createHuggingFaceCatalog(fetchImpl: FetchLike): ModelCatalog {
  return {
    async published() {
      let body: unknown;
      try {
        const response = await fetchImpl(LATEST_REVISION_URL);
        if (!response.ok) {
          throw new Error(`status ${response.status}`);
        }
        body = await response.json();
      } catch (error) {
        throw new ModelCatalogError('The model catalog could not be read', { cause: error });
      }
      return parseRevision(body);
    },
  };
}
