import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentInfo } from '../../../shared/agents';
import { SessionError, type SessionState } from '../../../shared/session';
import { createSessionClient } from '../../../shared/session-ipc';
import { createGrilloApi } from '../../../preload/bridge';
import { createMainIpc } from '../../ipc/bridge';
import { createFakeIpc } from '../../ipc/fake-ipc';
import { createMemoryStore } from '../../store/memory';
import { createSliceBus } from '../audio/slices';
import { createTranscriber } from '../transcription/transcriber';
import { createWhisperEngine, type WhisperBinding, type WhisperContextLike } from '../transcription/whisper-engine';
import { announcingTranscriber, registerSessionChannels } from './channels';
import { createSessionHost, OUTLIER_AFTER_MS, type SessionHost } from './session';

// Made-up project and logins only.
const PROJECT = 'example-org/channel-demo';
const HOST = 'ada-example';

async function rig() {
  vi.useFakeTimers({ now: new Date('2026-10-24T09:15:00.000Z'), toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  const fake = createFakeIpc();
  const ipc = createMainIpc(fake.main, () => [fake.window]);
  const store = createMemoryStore({ now: () => new Date() });
  await store.createProject({ newRepository: { organisation: 'example-org', name: 'channel-demo' } });
  const bus = createSliceBus();
  const running: AgentInfo[] = [{ id: 'a1', kind: 'grilling', title: 'a1', folder: '/memory/Grillo', waiting: false }];
  const typed: string[] = [];
  const changes: (SessionState | null)[] = [];
  const transcriber = announcingTranscriber({ transcribe: async (pcm) => `Words ${pcm[0]}.` }, () =>
    changes.push(host.state()),
  );
  const host: SessionHost = createSessionHost({
    store,
    slices: bus,
    transcriber,
    agents: {
      choice: 'terminal',
      list: () => running,
      write: (_id, text) => void typed.push(text),
      send: () => Promise.reject(new Error('A terminal agent is typed into, never sent to')),
      ready: () => Promise.resolve(),
    },
  });
  registerSessionChannels(ipc, host);
  const grillo = createGrilloApi(fake.renderer);
  const sent: (SessionState | null)[] = [];
  grillo.on('session:changed', (state) => sent.push(state));
  return { client: createSessionClient(grillo), bus, typed, changes, sent };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('session channels', () => {
  it('reach the host through IPC and send the session after every call that changes it', async () => {
    const { client, sent } = await rig();

    const started = await client.startSession(PROJECT);
    await client.setPresent([HOST]);
    await client.tickConsent(HOST);
    const state = await client.state();

    expect(started).toMatchObject({ project: PROJECT, present: [], consent: null, recording: false });
    expect(state).toMatchObject({ present: [HOST], consent: { by: HOST } });
    expect(sent.map((s) => s?.present)).toEqual([[], [HOST], [HOST]]);
    expect(sent.at(-1)?.consent?.by).toBe(HOST);
  });

  it("never sends the session for a chat view's message box calls, made on every keystroke", async () => {
    const { client, sent } = await rig();
    await client.startSession(PROJECT);
    sent.length = 0;

    const settled = await Promise.allSettled([
      client.editBox('a1', 'Sample typed text', ''),
      client.releaseHeld('a1', ''),
    ]);

    expect(settled.map(({ status }) => status)).toEqual(['rejected', 'rejected']);
    expect(sent).toEqual([]);
  });

  it('turns a refusal back into a SessionError of the same kind, and still sends the session', async () => {
    const { client, sent } = await rig();
    await client.startSession(PROJECT);

    const error = await client.setRecording(true).then(
      () => undefined,
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(SessionError);
    expect((error as SessionError).kind).toBe('no-consent');
    expect(sent).toHaveLength(2);
  });

  it('announces each transcribed slice once its line is in the transcript', async () => {
    const { client, bus, changes } = await rig();
    await client.startSession(PROJECT);
    await client.tickConsent(HOST);
    await client.setRecording(true);

    bus.publish({ source: 'microphone', index: 0, pcm: Int16Array.of(7) });
    await vi.advanceTimersByTimeAsync(0);

    expect(changes.map((s) => s?.transcript)).toEqual(['Words 7.']);
  });

  it("keeps the outlier clock working through the app's wiring: a slice the engine never answers drops only itself", async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const store = createMemoryStore({ now: () => new Date('2026-10-24T09:15:00.000Z') });
    await store.createProject({ newRepository: { organisation: 'example-org', name: 'channel-demo' } });
    const bus = createSliceBus();
    // Wired as ipc.ts wires it: the one-at-a-time transcriber behind the announcing wrapper.
    const engine = {
      transcribe: (pcm: Int16Array) =>
        new Promise<string>((resolve) => {
          if (pcm[0] !== 1) setTimeout(() => resolve(`Words ${pcm[0]}.`), 1000);
        }),
    };
    const host = createSessionHost({
      store,
      slices: bus,
      transcriber: announcingTranscriber(createTranscriber(engine), () => undefined),
      agents: { choice: 'terminal', list: () => [], write: () => undefined, send: async () => undefined, ready: async () => undefined },
    });
    await host.startSession(PROJECT);
    await host.tickConsent(HOST);
    await host.setRecording(true);

    for (const index of [0, 1, 2, 3]) bus.publish({ source: 'microphone', index, pcm: Int16Array.of(index) });
    await vi.advanceTimersByTimeAsync(OUTLIER_AFTER_MS + 3000);
    const stopping = host.setRecording(false);
    await vi.advanceTimersByTimeAsync(1000);
    await stopping;

    expect(host.state()?.slices).toEqual({ heard: 4, transcribed: 3, silent: 0, dropped: 1 });
    expect(host.state()?.transcript).toBe('Words 0.\nWords 2.\nWords 3.');
  });
});

/**
 * A made-up whisper.node binding that behaves as the native one does: each context runs one call at a time (a later
 * call waits for the one running), and a running call cannot be interrupted. Slice n takes `takes(n)` seconds, or
 * never answers. The words come from the slice's first sample.
 */
function oneAtATimeBinding(takes: (slice: number) => number | 'never') {
  const contexts: Array<{ released: boolean }> = [];
  const binding: WhisperBinding = {
    async initWhisper() {
      let free: Promise<unknown> = Promise.resolve();
      const record = { released: false };
      contexts.push(record);
      const whisper: WhisperContextLike = {
        transcribeData(audio) {
          const slice = new Int16Array(audio)[0];
          const promise = free.then(
            () =>
              new Promise((resolve) => {
                const seconds = takes(slice);
                if (seconds !== 'never') setTimeout(() => resolve({ result: `Words ${slice}.` }), seconds * 1000);
              }),
          );
          free = promise;
          return { promise };
        },
        async release() {
          record.released = true;
        },
      };
      return whisper;
    },
  };
  return { binding, contexts };
}

describe("the outlier clock over the app's own wiring and a whisper that runs one call at a time", () => {
  async function whisperRig(takes: (slice: number) => number | 'never') {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const store = createMemoryStore({ now: () => new Date('2026-10-24T09:15:00.000Z') });
    await store.createProject({ newRepository: { organisation: 'example-org', name: 'channel-demo' } });
    const bus = createSliceBus();
    const { binding, contexts } = oneAtATimeBinding(takes);
    // Wired as ipc.ts wires it.
    const engine = createWhisperEngine({ modelPath: '/made-up/models/ggml-base.en.bin', loadBinding: async () => binding });
    const host = createSessionHost({
      store,
      slices: bus,
      transcriber: announcingTranscriber(createTranscriber(engine), () => undefined),
      agents: { choice: 'terminal', list: () => [], write: () => undefined, send: async () => undefined, ready: async () => undefined },
    });
    await host.startSession(PROJECT);
    await host.tickConsent(HOST);
    await host.setRecording(true);
    const hear = (index: number) => bus.publish({ source: 'microphone', index, pcm: Int16Array.of(index) });
    const stop = async () => {
      const stopping = host.setRecording(false);
      await vi.advanceTimersByTimeAsync(OUTLIER_AFTER_MS);
      await stopping;
    };
    return { host, hear, stop, contexts };
  }

  it.each([
    {
      case: 'a 25-second slice, then two 13-second slices heard at once',
      takes: (slice: number) => (slice === 0 ? 25 : 13),
      heardAt: [0, 0, 0],
      transcript: 'Words 1.\nWords 2.',
      counts: { heard: 3, transcribed: 2, silent: 0, dropped: 1 },
    },
    {
      case: 'a 30-second slice, then 4-second slices every 5 seconds',
      takes: (slice: number) => (slice === 0 ? 30 : 4),
      heardAt: [0, 5, 10, 15, 20],
      transcript: 'Words 1.\nWords 2.\nWords 3.\nWords 4.',
      counts: { heard: 5, transcribed: 4, silent: 0, dropped: 1 },
    },
    {
      case: 'a call that never answers, among 1-second slices',
      takes: (slice: number) => (slice === 1 ? 'never' : 1),
      heardAt: [0, 0, 0, 0],
      transcript: 'Words 0.\nWords 2.\nWords 3.',
      counts: { heard: 4, transcribed: 3, silent: 0, dropped: 1 },
    },
  ])('drops only the outlier in $case, and Record off returns', async ({ takes, heardAt, transcript, counts }) => {
    const { host, hear, stop } = await whisperRig(takes);

    let at = 0;
    for (const [index, second] of heardAt.entries()) {
      await vi.advanceTimersByTimeAsync((second - at) * 1000);
      at = second;
      hear(index);
    }
    await vi.advanceTimersByTimeAsync(4 * OUTLIER_AFTER_MS);
    await stop();

    expect(host.state()?.slices).toEqual(counts);
    expect(host.state()?.transcript).toBe(transcript);
  });

  it('frees the context of a slice given up on once its call ends, and keeps it while the call still runs', async () => {
    const { hear, stop, contexts } = await whisperRig((slice) => (slice === 0 ? 40 : 1));

    hear(0);
    hear(1);
    await vi.advanceTimersByTimeAsync(OUTLIER_AFTER_MS + 2000);
    expect(contexts).toHaveLength(2);
    expect(contexts[0].released).toBe(false);

    await vi.advanceTimersByTimeAsync(40_000);
    await stop();
    expect(contexts.map(({ released }) => released)).toEqual([true, false]);
  });
});
