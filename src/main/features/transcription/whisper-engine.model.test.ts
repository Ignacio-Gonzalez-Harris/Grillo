// The real-transcription smoke test. vitest.config.mts includes `*.model.test.ts` files only when the speech model
// the app downloads is on this machine, so CI (which never downloads it) does not run this file at all.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultUserDataFolder, speechModelPathIn } from './model';
import { createTranscriber } from './transcriber';
import { createWhisperEngine } from './whisper-engine';

/** A made-up sentence, spoken by the system's synthetic voice, 16 kHz mono 16-bit. */
const FIXTURE_WAV = join(__dirname, '__fixtures__', 'book-the-blue-room.wav');
const SAMPLES_PER_SLICE = 16_000 * 5;
// Loading a 148 MB model and transcribing on a CPU is slower than a unit test, so this test has its own budget.
const TRANSCRIPTION_BUDGET_MS = 60_000;

/** The samples of a PCM WAV file: everything after its `data` chunk header. */
function wavSamples(filePath: string): Int16Array {
  const file = readFileSync(filePath);
  const dataChunk = file.indexOf('data', 12, 'ascii');
  const start = dataChunk + 8;
  const copy = file.subarray(start, start + file.readUInt32LE(dataChunk + 4));
  return new Int16Array(copy.buffer.slice(copy.byteOffset, copy.byteOffset + copy.byteLength));
}

describe('real whisper.cpp transcription', () => {
  it(
    'transcribes the fixture sentence in 5-second slices with the downloaded base.en model',
    async () => {
      const modelPath = speechModelPathIn(
        defaultUserDataFolder({ platform: process.platform, env: process.env, homeFolder: homedir() }),
      );
      const transcriber = createTranscriber(createWhisperEngine({ modelPath }));
      const samples = wavSamples(FIXTURE_WAV);
      const slices: Int16Array[] = [];
      for (let start = 0; start < samples.length; start += SAMPLES_PER_SLICE) {
        slices.push(samples.subarray(start, start + SAMPLES_PER_SLICE));
      }

      const texts = await Promise.all(slices.map((slice) => transcriber.transcribe(slice)));

      expect(texts.join(' ').toLowerCase()).toMatch(/blue meeting room.*tuesday/);
    },
    TRANSCRIPTION_BUDGET_MS,
  );
});
