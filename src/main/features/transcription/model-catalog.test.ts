import { describe, expect, it } from 'vitest';
import { MODEL_FILE_NAME, modelDownloadUrl } from './model';
import { createHuggingFaceCatalog, ModelCatalogError } from './model-catalog';
import type { FetchLike } from './model-download';

const COMMIT = 'c'.repeat(40);
const SHA256 = 'a'.repeat(64);
const SIZE = 147_964_211;

const modelEntry = { rfilename: MODEL_FILE_NAME, size: SIZE, lfs: { sha256: SHA256, size: SIZE } };
const otherEntry = { rfilename: 'ggml-small.en.bin', size: 1, lfs: { sha256: 'b'.repeat(64), size: 1 } };

function catalogAnswering(body: unknown) {
  return createHuggingFaceCatalog(async () => new Response(JSON.stringify(body)));
}

const answersBusy: FetchLike = async () => new Response('busy', { status: 503 });
const answersHtml: FetchLike = async () => new Response('<html>');
const networkDown: FetchLike = async () => {
  throw new TypeError('fetch failed');
};

describe('Hugging Face model catalog', () => {
  it('reads the published base.en model and points at its file at that exact commit', async () => {
    const catalog = catalogAnswering({ sha: COMMIT, siblings: [otherEntry, modelEntry] });

    await expect(catalog.published()).resolves.toEqual({
      url: modelDownloadUrl(COMMIT),
      sha256: SHA256,
      sizeBytes: SIZE,
    });
  });

  it.each([
    ['a null body', null],
    ['a list instead of an object', [modelEntry]],
    ['no commit', { siblings: [modelEntry] }],
    ['a commit that is not a hash', { sha: 'main/../x', siblings: [modelEntry] }],
    ['no file list', { sha: COMMIT }],
    ['a null file in the list', { sha: COMMIT, siblings: [null, otherEntry] }],
    ['the model file missing', { sha: COMMIT, siblings: [otherEntry] }],
    ['the model file listed twice', { sha: COMMIT, siblings: [modelEntry, modelEntry] }],
    ['no checksum record', { sha: COMMIT, siblings: [{ ...modelEntry, lfs: null }] }],
    ['a checksum that is not SHA-256', { sha: COMMIT, siblings: [{ ...modelEntry, lfs: { sha256: 'xyz', size: SIZE } }] }],
    ['a size below one', { sha: COMMIT, siblings: [{ ...modelEntry, lfs: { sha256: SHA256, size: -1 } }] }],
    ['a size that is not a whole number', { sha: COMMIT, siblings: [{ ...modelEntry, lfs: { sha256: SHA256, size: 1.5 } }] }],
  ])('turns an answer with %s into a ModelCatalogError', async (_kind, body) => {
    await expect(catalogAnswering(body).published()).rejects.toThrow(ModelCatalogError);
  });

  it.each([
    ['an error status', answersBusy],
    ['a body that is not JSON', answersHtml],
    ['no network', networkDown],
  ])('turns %s into a ModelCatalogError', async (_kind, fetchImpl) => {
    await expect(createHuggingFaceCatalog(fetchImpl).published()).rejects.toThrow(ModelCatalogError);
  });
});
