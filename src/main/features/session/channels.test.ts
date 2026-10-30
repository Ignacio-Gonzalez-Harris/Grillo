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
