import { createWriteStream } from 'node:fs';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { ModelDownloadError } from './model';
import type { ModelDownloader } from './model-store';

/** The part of `fetch` the model code uses; the app passes Electron's `net.fetch`, which honours the system proxy. */
export type FetchLike = (url: string) => Promise<Response>;

export function createFetchDownloader(fetchImpl: FetchLike): ModelDownloader {
  return {
    async download(url, destinationPath, onBytes) {
      const response = await fetchImpl(url).catch((error: unknown) => {
        throw new ModelDownloadError(`Could not reach ${url}`, { cause: error });
      });
      if (!response.ok || !response.body) {
        throw new ModelDownloadError(`${url} answered with status ${response.status}`);
      }
      let receivedBytes = 0;
      const countBytes = new Transform({
        transform(chunk: Buffer, _encoding, done) {
          receivedBytes += chunk.length;
          onBytes(receivedBytes);
          done(null, chunk);
        },
      });
      try {
        await pipeline(
          Readable.fromWeb(response.body as NodeReadableStream<Uint8Array>),
          countBytes,
          createWriteStream(destinationPath),
        );
      } catch (error) {
        throw new ModelDownloadError(`The download from ${url} was interrupted`, { cause: error });
      }
    },
  };
}
