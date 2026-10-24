import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ModelDownloadError } from './model';
import { createFetchDownloader, type FetchLike } from './model-download';

const MODEL_URL = 'https://models.example.test/made-up.bin';

/** A response whose body arrives in the given chunks, as a real download would. */
function streamedResponse(chunks: string[], init?: ResponseInit): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    },
  });
  return new Response(body, init);
}

const answersNotFound: FetchLike = async () => streamedResponse(['Not found'], { status: 404 });
const networkDown: FetchLike = async () => {
  throw new TypeError('fetch failed');
};

describe('fetch downloader', () => {
  let folder: string;
  let destination: string;

  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), 'grillo-download-'));
    destination = join(folder, 'model.part');
  });

  afterEach(() => {
    rmSync(folder, { recursive: true, force: true });
  });

  it('writes the body to the file and reports the running byte count', async () => {
    const seen: number[] = [];
    const downloader = createFetchDownloader(async () => streamedResponse(['made-up ', 'weights']));

    await downloader.download(MODEL_URL, destination, (bytes) => seen.push(bytes));

    expect(readFileSync(destination, 'utf8')).toBe('made-up weights');
    expect(seen).toEqual([8, 15]);
  });

  it.each([
    ['the server answers with an error status', answersNotFound],
    ['the network is unreachable', networkDown],
  ])('turns a failure into a ModelDownloadError when %s', async (_kind, fetchImpl) => {
    await expect(createFetchDownloader(fetchImpl).download(MODEL_URL, destination, () => undefined)).rejects.toThrow(
      ModelDownloadError,
    );
  });
});
