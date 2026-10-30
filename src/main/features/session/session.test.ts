import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentInfo } from '../../../shared/agents';
import type { AudioSlice, CaptureSource } from '../../../shared/audio';
import { SessionError, type SessionErrorKind } from '../../../shared/session';
import { StoreError } from '../../../shared/store';
import { FakePty } from '../agents/fake-pty';
import { createAgentRuntime, ENTER_AFTER_QUIET_MS } from '../agents/runtime';
import { createSliceBus, type SliceBus } from '../audio/slices';
import { createTranscriber, type SliceControl, type Transcriber } from '../transcription/transcriber';
import { formatSession } from '../../store/github/repo/records';
import { createMemoryStore, type MemoryStore } from '../../store/memory';
import type { GrillingSession } from '../../store/types';
import { createSessionHost, LINE_BREAK, OUTLIER_AFTER_MS, type SessionHost, type SessionStore } from './session';

const PROJECT = 'example-org/grilling-demo';
const HOST = 'ada-example';
const OTHER = 'ben-example';
const ENTER = '\r';
const START = new Date('2026-10-24T09:15:00.000Z');

/** Every made-up slice carries its own number in its first sample, so the fake transcriber knows which it got. */
function slice(index: number, source: CaptureSource = 'microphone'): AudioSlice {
  return { source, index, pcm: Int16Array.of(index) };
}

/**
 * A transcriber whose answer per slice the test decides; by default slice n says "Words n." It works on every slice
 * at once, so each slice starts as it arrives.
 */
class FakeTranscriber implements Transcriber {
  readonly answers = new Map<number, () => Promise<unknown>>();
  calls = 0;

  transcribe(pcm: Int16Array, control?: SliceControl): Promise<string> {
    this.calls += 1;
    control?.started?.();
    const answer = this.answers.get(pcm[0]);
    return (answer ? answer() : Promise.resolve(`Words ${pcm[0]}.`)) as Promise<string>;
  }
}

/** Terminal agents: what was typed into each of them, write by write. The terminal path types; it never sends. */
class FakeAgents {
  readonly choice = 'terminal';
  readonly typed = new Map<string, string[]>();
  private readonly running = new Set<string>();

  add(...ids: string[]): void {
    for (const id of ids) {
      this.running.add(id);
      this.typed.set(id, []);
    }
  }

  exit(id: string): void {
    this.running.delete(id);
  }

  list(): AgentInfo[] {
    return [...this.running].map((id) => ({ id, kind: 'grilling', title: id, folder: '/memory/Grillo', waiting: false }));
  }

  write(id: string, text: string): void {
    if (!this.running.has(id)) throw new Error(`No agent with id '${id}'`);
    this.typed.get(id)?.push(text);
  }

  send(): Promise<void> {
    return Promise.reject(new Error('A terminal agent is typed into, never sent to'));
  }

  ready(): Promise<void> {
    return Promise.resolve();
  }

  text(id: string): string {
    return (this.typed.get(id) ?? []).join('');
  }
}

interface Rig {
  host: SessionHost;
  store: MemoryStore;
  bus: SliceBus;
  transcriber: FakeTranscriber;
  agents: FakeAgents;
}

let now: Date;

async function rig(overrides: { store?: SessionStore } = {}): Promise<Rig> {
  now = new Date(START);
  const store = createMemoryStore({ now: () => now });
  await store.createProject({ newRepository: { organisation: 'example-org', name: 'grilling-demo' } });
  await store.addMember(PROJECT, { login: OTHER, role: 'product owner', domains: ['product'] });
  const bus = createSliceBus();
  const transcriber = new FakeTranscriber();
  const agents = new FakeAgents();
  const host = createSessionHost({ store: overrides.store ?? store, slices: bus, transcriber, agents });
  return { host, store, bus, transcriber, agents };
}

/** Lets every queued transcription, store write and typed Enter finish, without reaching the outlier limit. */
async function settle(): Promise<void> {
  for (let step = 0; step < 10; step += 1) await vi.advanceTimersByTimeAsync(ENTER_AFTER_QUIET_MS);
}

async function refusal(promise: Promise<unknown>): Promise<SessionErrorKind> {
  const error = await promise.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(SessionError);
  return (error as SessionError).kind;
}

async function recordingRig(): Promise<Rig> {
  const setup = await rig();
  await setup.host.startSession(PROJECT);
  await setup.host.setPresent([HOST, OTHER]);
  await setup.host.tickConsent(HOST);
  await setup.host.setRecording(true);
  return setup;
}

async function stopRecording(host: SessionHost): Promise<void> {
  const closing = host.setRecording(false);
  await settle();
  await closing;
}

async function sessionFile(store: MemoryStore, id: string): Promise<GrillingSession> {
  return store.getSession(PROJECT, id);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('grilling session: start, presence and consent', () => {
  it('starts a session file named by the moment it started, with nobody present and no consent', async () => {
    const { host, store } = await rig();

    const state = await host.startSession(PROJECT);

    expect(state).toMatchObject({
      project: PROJECT,
      id: '2026-10-24-091500',
      file: '.grillo/sessions/2026-10-24-091500.md',
      date: '2026-10-24T09:15:00.000Z',
      present: [],
      consent: null,
      recording: false,
      channels: [],
      transcript: '',
    });
    expect(await store.listSessions(PROJECT)).toHaveLength(1);
  });

  it('refuses a second session while one runs, and starts a new one once it has ended', async () => {
    const { host } = await rig();
    await host.startSession(PROJECT);

    expect(await refusal(host.startSession(PROJECT))).toBe('session-running');
    await host.endSession();
    now = new Date(START.getTime() + 60_000);

    expect((await host.startSession(PROJECT)).id).toBe('2026-10-24-091600');
  });

  it('refuses every session call before a session has started', async () => {
    const { host } = await rig();

    expect(host.state()).toBeNull();
    for (const call of [
      () => host.setPresent([HOST]),
      () => host.tickConsent(HOST),
      () => host.setRecording(true),
      () => host.endSession(),
    ]) {
      expect(await refusal(call())).toBe('no-session');
    }
  });

  it('records who is present in the session file, each spelling of a login once, replacing the list each time', async () => {
    const { host, store } = await rig();
    const { id } = await host.startSession(PROJECT);

    await host.setPresent([HOST, OTHER, 'Ben-Example']);
    expect((await sessionFile(store, id)).present).toEqual([HOST, OTHER]);
    await host.setPresent([OTHER]);

    expect((await sessionFile(store, id)).present).toEqual([OTHER]);
    expect(host.state()?.present).toEqual([OTHER]);
  });

  it.each([
    ['not a list', HOST],
    ['null', null],
    ['an empty login', ['']],
    ['two logins in one, comma', [`${HOST}, ${OTHER}`]],
    ['two logins in one, space', [`${HOST} ${OTHER}`]],
    ['a line break', [`${HOST}\n${OTHER}`]],
    ['a number', [42]],
    ['someone who is not a member', ['stranger-example']],
  ])('refuses a presence list holding %s and keeps the one it had', async (_case, logins) => {
    const { host, store } = await rig();
    const { id } = await host.startSession(PROJECT);
    await host.setPresent([HOST]);

    expect(await refusal(host.setPresent(logins as string[]))).toBe('invalid');
    expect((await sessionFile(store, id)).present).toEqual([HOST]);
  });

  it('keeps Record disabled until the host ticks consent, then records who ticked and when', async () => {
    const { host, store } = await rig();
    const { id } = await host.startSession(PROJECT);

    expect(await refusal(host.setRecording(true))).toBe('no-consent');
    now = new Date(START.getTime() + 60_000);
    await host.tickConsent('Ada-Example');

    const consent = { by: HOST, at: '2026-10-24T09:16:00.000Z' };
    expect((await sessionFile(store, id)).consent).toEqual(consent);
    await host.setRecording(true);
    expect(host.state()).toMatchObject({ consent, recording: true });
  });

  it('keeps the first consent tick when the host ticks again', async () => {
    const { host, store } = await rig();
    const { id } = await host.startSession(PROJECT);
    await host.tickConsent(HOST);
    now = new Date(START.getTime() + 60_000);

    await host.tickConsent(HOST);

    expect((await sessionFile(store, id)).consent?.at).toBe('2026-10-24T09:15:00.000Z');
  });

  it.each([
    ['another member', OTHER, 'not-host'],
    ['an empty login', '', 'invalid'],
    ['a login with a comma', `${HOST},`, 'invalid'],
    ['no login at all', undefined, 'invalid'],
  ])('refuses a consent tick by %s', async (_case, login, kind) => {
    const { host, store } = await rig();
    const { id } = await host.startSession(PROJECT);

    expect(await refusal(host.tickConsent(login as string))).toBe(kind);
    expect((await sessionFile(store, id)).consent).toBeNull();
  });

  it('refuses a recording switch that is not on or off', async () => {
    const { host } = await rig();
    await host.startSession(PROJECT);
    await host.tickConsent(HOST);

    expect(await refusal(host.setRecording('yes' as unknown as boolean))).toBe('invalid');
  });
});

describe('grilling session: what the store hands back', () => {
  function storeAnswering(changes: Partial<SessionStore>, real: MemoryStore): SessionStore {
    return {
      currentMember: (...args) => real.currentMember(...args),
      createSession: (...args) => real.createSession(...args),
      updateSession: (...args) => real.updateSession(...args),
      ...changes,
    };
  }

  it.each([
    ['null', null],
    ['a session with no id', { date: START.toISOString(), present: [], consent: null, transcript: '' }],
    ['a session id that is no moment', { id: '../../evil', date: START.toISOString(), present: [], consent: null, transcript: '' }],
    ['a session whose present list is not a list', { id: '2026-10-24-091500', date: START.toISOString(), present: 'ada', consent: null, transcript: '' }],
  ])('refuses to start on %s from the store', async (_case, created) => {
    const real = (await rig()).store;
    const { host } = await rig({ store: storeAnswering({ createSession: async () => created as GrillingSession }, real) });

    expect(await refusal(host.startSession(PROJECT))).toBe('store');
    expect(host.state()).toBeNull();
  });

  it('turns a store refusal into a session error, and an unknown project into an invalid one', async () => {
    const real = (await rig()).store;
    const failing = storeAnswering(
      { createSession: () => Promise.reject(new StoreError('backend', 'GitHub is down')) },
      real,
    );
    const { host } = await rig({ store: failing });

    expect(await refusal(host.startSession(PROJECT))).toBe('store');
    expect(await refusal((await rig()).host.startSession('example-org/no-such-project'))).toBe('store');
    expect(await refusal((await rig()).host.startSession(''))).toBe('invalid');
  });

  it.each([
    ['null', null],
    ['no consent', { consent: null }],
    ['a consent with no time', { consent: { by: HOST } }],
  ])('refuses a consent tick the store answers with %s, and Record stays disabled', async (_case, updated) => {
    const real = (await rig()).store;
    const { host } = await rig({ store: storeAnswering({ updateSession: async () => updated as GrillingSession }, real) });
    await host.startSession(PROJECT);

    expect(await refusal(host.tickConsent(HOST))).toBe('store');
    expect(await refusal(host.setRecording(true))).toBe('no-consent');
  });
});

describe('grilling session: the recording switch and the transcript file', () => {
  it('turns each slice into a transcript line in the session file, in the order spoken', async () => {
    const { host, store, bus } = await recordingRig();
    const { id } = host.state()!;

    for (const index of [0, 1, 2]) bus.publish(slice(index));
    await settle();

    expect((await sessionFile(store, id)).transcript).toBe('Words 0.\nWords 1.\nWords 2.');
    expect(host.state()?.slices).toEqual({ heard: 3, transcribed: 3, silent: 0, dropped: 0 });
  });

  it('writes the file with its date, the present members, the consent tick and the transcript', async () => {
    const { host, store, bus } = await recordingRig();
    const { id } = host.state()!;

    bus.publish(slice(0));
    await stopRecording(host);

    expect(formatSession(await sessionFile(store, id))).toBe(
      [
        'date: 2026-10-24T09:15:00.000Z',
        `present: ${HOST}, ${OTHER}`,
        `consent-by: ${HOST}`,
        'consent-at: 2026-10-24T09:15:00.000Z',
        '',
        'Words 0.',
      ].join('\n'),
    );
  });

  it('ignores a slice delivered twice, and keeps both sources when their numbers meet', async () => {
    const { host, store, bus, transcriber } = await recordingRig();
    const { id } = host.state()!;

    bus.publish(slice(0));
    bus.publish(slice(0));
    bus.publish(slice(0, 'call'));
    await settle();

    expect((await sessionFile(store, id)).transcript).toBe('Words 0.\nWords 0.');
    expect(transcriber.calls).toBe(2);
    expect(host.state()?.slices.heard).toBe(2);
  });

  it('never lets a slow outlier block the stream: it is left out and the slices behind it go on', async () => {
    const { host, store, bus, transcriber } = await recordingRig();
    const { id } = host.state()!;
    transcriber.answers.set(1, () => new Promise(() => undefined));

    for (const index of [0, 1, 2]) bus.publish(slice(index));
    await vi.advanceTimersByTimeAsync(OUTLIER_AFTER_MS);
    await settle();

    expect((await sessionFile(store, id)).transcript).toBe('Words 0.\nWords 2.');
    expect(host.state()?.slices).toEqual({ heard: 3, transcribed: 2, silent: 0, dropped: 1 });
  });

  describe('over the transcriber that takes one slice at a time', () => {
    /** The real queue over a made-up engine: slice n answers "Words n." after the time the test gives it. */
    async function sequentialRig(takes: Map<number, number | 'never'>, normalMs: number) {
      const setup = await rig();
      const transcriber = createTranscriber({
        transcribe: (pcm) =>
          new Promise((resolve) => {
            const ms = takes.get(pcm[0]) ?? normalMs;
            if (ms !== 'never') setTimeout(() => resolve(`Words ${pcm[0]}.`), ms);
          }),
      });
      const host = createSessionHost({ store: setup.store, slices: setup.bus, transcriber, agents: setup.agents });
      await host.startSession(PROJECT);
      await host.tickConsent(HOST);
      await host.setRecording(true);
      return { host, store: setup.store, bus: setup.bus };
    }

    it('keeps the healthy slices queued behind a long one: their clock starts only when the transcriber starts them', async () => {
      const slow = OUTLIER_AFTER_MS + 10_000;
      const { host, store, bus } = await sequentialRig(new Map([[0, slow]]), OUTLIER_AFTER_MS - 2000);
      const { id } = host.state()!;

      for (const index of [0, 1, 2]) bus.publish(slice(index));
      await vi.advanceTimersByTimeAsync(4 * OUTLIER_AFTER_MS);
      await stopRecording(host);

      expect((await sessionFile(store, id)).transcript).toBe('Words 1.\nWords 2.');
      expect(host.state()?.slices).toEqual({ heard: 3, transcribed: 2, silent: 0, dropped: 1 });
    });

    it('drops only an engine call that never answers, and the slices behind it are transcribed', async () => {
      const { host, store, bus } = await sequentialRig(new Map([[1, 'never']]), 1000);
      const { id } = host.state()!;

      for (const index of [0, 1, 2, 3]) bus.publish(slice(index));
      await vi.advanceTimersByTimeAsync(OUTLIER_AFTER_MS + 3000);
      await stopRecording(host);

      expect((await sessionFile(store, id)).transcript).toBe('Words 0.\nWords 2.\nWords 3.');
      expect(host.state()?.slices).toEqual({ heard: 4, transcribed: 3, silent: 0, dropped: 1 });
    });
  });

  it('says each time a slice arrives, so the screen can show slices waiting', async () => {
    const setup = await rig();
    let heard = 0;
    const host = createSessionHost({
      store: setup.store,
      slices: setup.bus,
      transcriber: setup.transcriber,
      agents: setup.agents,
      sliceHeard: () => {
        heard = host.state()?.slices.heard ?? -1;
      },
    });
    await host.startSession(PROJECT);
    await host.tickConsent(HOST);
    await host.setRecording(true);
    setup.transcriber.answers.set(0, () => new Promise(() => undefined));

    setup.bus.publish(slice(0));

    expect(heard).toBe(1);
  });

  it('keeps a slow slice that answers within the limit, in its place', async () => {
    const { host, store, bus, transcriber } = await recordingRig();
    const { id } = host.state()!;
    transcriber.answers.set(0, () => new Promise((resolve) => setTimeout(() => resolve('Slow words.'), OUTLIER_AFTER_MS - 1)));

    bus.publish(slice(0));
    bus.publish(slice(1));
    await vi.advanceTimersByTimeAsync(OUTLIER_AFTER_MS - 1);
    await settle();

    expect((await sessionFile(store, id)).transcript).toBe('Slow words.\nWords 1.');
  });

  it.each([
    ['a failed transcription', () => Promise.reject(new Error('engine crashed')), 'dropped'],
    ['a transcriber that throws at once', () => { throw new Error('engine gone'); }, 'dropped'],
    ['null', () => Promise.resolve(null), 'dropped'],
    ['undefined', () => Promise.resolve(undefined), 'dropped'],
    ['a number', () => Promise.resolve(42), 'dropped'],
    ['an object', () => Promise.resolve({ result: 'Words.' }), 'dropped'],
    ['empty text', () => Promise.resolve(''), 'silent'],
    ['only spaces and line breaks', () => Promise.resolve(' \r\n\t '), 'silent'],
    ['a non-speech marker', () => Promise.resolve(' [BLANK_AUDIO] '), 'silent'],
  ])('leaves %s out of the transcript and goes on', async (_case, answer, outcome) => {
    const { host, store, bus, transcriber } = await recordingRig();
    const { id } = host.state()!;
    transcriber.answers.set(0, answer as () => Promise<unknown>);

    bus.publish(slice(0));
    bus.publish(slice(1));
    await settle();

    expect((await sessionFile(store, id)).transcript).toBe('Words 1.');
    expect(host.state()?.slices[outcome as 'dropped' | 'silent']).toBe(1);
  });

  it.each([
    ['a line break inside', 'First part.\nSecond part.', 'First part. Second part.'],
    ['a carriage return, which would press Enter', 'Agreed.\rUse it.', 'Agreed. Use it.'],
    ['a Windows line break', 'One.\r\nTwo.', 'One. Two.'],
    ['a tab and runs of spaces', 'Ship\t it   now.', 'Ship it now.'],
    ['a terminal escape code', 'Hello \u001b[2J there.', 'Hello [2J there.'],
    ['a marker between words', 'We agreed [BLANK_AUDIO] on Friday.', 'We agreed on Friday.'],
    ['spaces around it', '   Trimmed.  ', 'Trimmed.'],
  ])('writes a slice with %s as one clean line', async (_case, raw, line) => {
    const { host, store, bus, transcriber } = await recordingRig();
    const { id } = host.state()!;
    transcriber.answers.set(0, () => Promise.resolve(raw));

    bus.publish(slice(0));
    await settle();

    expect((await sessionFile(store, id)).transcript).toBe(line);
  });

  it('closes the file cleanly: slices still being transcribed are written before the switch reports off', async () => {
    const { host, store, bus, transcriber } = await recordingRig();
    const { id } = host.state()!;
    transcriber.answers.set(1, () => new Promise((resolve) => setTimeout(() => resolve('Last words.'), 2000)));

    bus.publish(slice(0));
    bus.publish(slice(1));
    const closing = host.setRecording(false);
    bus.publish(slice(2));
    await vi.advanceTimersByTimeAsync(2000);
    await closing;

    expect((await sessionFile(store, id)).transcript).toBe('Words 0.\nLast words.');
    expect(host.state()).toMatchObject({ recording: false, slices: { heard: 2, transcribed: 2 } });
  });

  it('goes on in the same file when the recording is switched on again, its slices numbered from 0 again', async () => {
    const { host, store, bus } = await recordingRig();
    const { id } = host.state()!;
    bus.publish(slice(0));
    await stopRecording(host);

    await host.setRecording(true);
    bus.publish(slice(0));
    await stopRecording(host);

    expect((await sessionFile(store, id)).transcript).toBe('Words 0.\nWords 0.');
  });

  it('never writes the file twice at once, and the last write carries the whole transcript', async () => {
    const setup = await rig();
    let writing = 0;
    let overlapped = false;
    const slowStore: SessionStore = {
      currentMember: (...args) => setup.store.currentMember(...args),
      createSession: (...args) => setup.store.createSession(...args),
      async updateSession(...args) {
        writing += 1;
        overlapped ||= writing > 1;
        await new Promise((resolve) => setTimeout(resolve, 300));
        writing -= 1;
        return setup.store.updateSession(...args);
      },
    };
    const host = createSessionHost({ store: slowStore, slices: setup.bus, transcriber: setup.transcriber, agents: setup.agents });
    const { id } = await host.startSession(PROJECT);
    const ticking = host.tickConsent(HOST);
    await settle();
    await ticking;
    await host.setRecording(true);

    for (const index of [0, 1, 2, 3]) setup.bus.publish(slice(index));
    await stopRecording(host);

    expect(overlapped).toBe(false);
    expect((await sessionFile(setup.store, id)).transcript).toBe('Words 0.\nWords 1.\nWords 2.\nWords 3.');
  });

  it('keeps recording when a transcript write fails, and the next write carries what was missed', async () => {
    const setup = await rig();
    let failNext = false;
    const flakyStore: SessionStore = {
      currentMember: (...args) => setup.store.currentMember(...args),
      createSession: (...args) => setup.store.createSession(...args),
      updateSession: (...args) => {
        if (failNext) {
          failNext = false;
          return Promise.reject(new StoreError('conflict', 'Someone pushed first'));
        }
        return setup.store.updateSession(...args);
      },
    };
    const host = createSessionHost({ store: flakyStore, slices: setup.bus, transcriber: setup.transcriber, agents: setup.agents });
    const { id } = await host.startSession(PROJECT);
    await host.tickConsent(HOST);
    await host.setRecording(true);

    failNext = true;
    setup.bus.publish(slice(0));
    await settle();
    setup.bus.publish(slice(1));
    await stopRecording(host);

    expect((await sessionFile(setup.store, id)).transcript).toBe('Words 0.\nWords 1.');
  });

  it('reports a session error when the last write of the transcript fails, keeping the text for another try', async () => {
    const setup = await rig();
    let failing = false;
    const store: SessionStore = {
      currentMember: (...args) => setup.store.currentMember(...args),
      createSession: (...args) => setup.store.createSession(...args),
      updateSession: (...args) =>
        failing ? Promise.reject(new StoreError('backend', 'GitHub is down')) : setup.store.updateSession(...args),
    };
    const host = createSessionHost({ store, slices: setup.bus, transcriber: setup.transcriber, agents: setup.agents });
    const { id } = await host.startSession(PROJECT);
    await host.tickConsent(HOST);
    await host.setRecording(true);
    failing = true;
    setup.bus.publish(slice(0));

    const closing = refusal(host.setRecording(false));
    await settle();
    expect(await closing).toBe('store');
    failing = false;
    await host.endSession();

    expect((await sessionFile(setup.store, id)).transcript).toBe('Words 0.');
  });
});

describe('grilling session: per-agent channels', () => {
  async function channelRig(...ids: string[]): Promise<Rig> {
    const setup = await recordingRig();
    setup.agents.add(...ids);
    return setup;
  }

  it('tells an agent the session file when its channel opens, as one sent protocol message', async () => {
    const { host, agents } = await channelRig('a1');

    const opening = host.setChannel('a1', true);
    await settle();
    await opening;

    expect(agents.typed.get('a1')).toEqual(['session: .grillo/sessions/2026-10-24-091500.md', ENTER]);
    expect(host.state()?.channels).toEqual(['a1']);
  });

  it('writes each slice into the open agent\'s input box without Enter, one line per slice', async () => {
    const { host, agents, bus } = await channelRig('a1');
    await host.setChannel('a1', true);
    await settle();
    agents.typed.set('a1', []);

    bus.publish(slice(0));
    bus.publish(slice(1));
    await settle();

    expect(agents.typed.get('a1')).toEqual(['Words 0.', `${LINE_BREAK}Words 1.`]);
    expect(agents.text('a1')).not.toContain(ENTER);
  });

  it('submits the box with "use it" on a line of its own, then starts a fresh box', async () => {
    const { host, agents, bus } = await channelRig('a1');
    await host.setChannel('a1', true);
    await settle();
    agents.typed.set('a1', []);
    bus.publish(slice(0));
    await settle();

    const using = host.useIt('a1');
    await settle();
    await using;
    bus.publish(slice(1));
    await settle();

    expect(agents.typed.get('a1')).toEqual(['Words 0.', `${LINE_BREAK}use it`, ENTER, 'Words 1.']);
  });

  it('sends "use it" as the whole message when nothing is in the box', async () => {
    const { host, agents } = await channelRig('a1');

    const using = host.useIt('a1');
    await settle();
    await using;

    expect(agents.typed.get('a1')).toEqual(['use it', ENTER]);
  });

  it('holds a slice that arrives while Enter is pending until after it, so the control line stays last', async () => {
    const { host, agents, bus } = await channelRig('a1');
    await host.setChannel('a1', true);
    await settle();
    agents.typed.set('a1', []);

    const using = host.useIt('a1');
    bus.publish(slice(0));
    await settle();
    await using;

    expect(agents.typed.get('a1')).toEqual(['use it', ENTER, 'Words 0.']);
  });

  it('types the mode, skip and jump messages; Type mode keeps slices out of that box, Listen lets them in again', async () => {
    const { host, agents, bus } = await channelRig('a1');
    await host.setChannel('a1', true);
    await settle();
    agents.typed.set('a1', []);

    const typing = host.typeMode('a1', 'type');
    await settle();
    await typing;
    bus.publish(slice(0));
    await settle();
    const listening = host.typeMode('a1', 'listen');
    await settle();
    await listening;
    bus.publish(slice(1));
    await settle();
    const skipping = host.skip('a1');
    await settle();
    await skipping;
    const jumping = host.jump('a1', 12);
    await settle();
    await jumping;

    expect(agents.typed.get('a1')).toEqual([
      'mode: type', ENTER,
      'mode: listen', ENTER,
      'Words 1.', `${LINE_BREAK}skip`, ENTER,
      'jump 12', ENTER,
    ]);
  });

  it('types the presence message after any transcript in the box, and present: alone for nobody', async () => {
    const { host, agents, bus } = await channelRig('a1');
    await host.setChannel('a1', true);
    await settle();
    agents.typed.set('a1', []);

    bus.publish(slice(0));
    await settle();
    const ticking = host.typePresent('a1', [HOST, OTHER]);
    await settle();
    await ticking;
    const nobody = host.typePresent('a1', []);
    await settle();
    await nobody;

    expect(agents.typed.get('a1')).toEqual([
      'Words 0.', `${LINE_BREAK}present: ${HOST}, ${OTHER}`, ENTER,
      'present:', ENTER,
    ]);
  });

  it.each([
    ['a login that is not a GitHub login', () => ['not a login']],
    ['a list that is not a list', () => HOST as unknown as string[]],
  ])('refuses a presence message with %s and types nothing', async (_case, logins) => {
    const { host, agents } = await channelRig('a1');

    expect(await refusal(host.typePresent('a1', logins()))).toBe('invalid');
    expect(agents.typed.get('a1')).toEqual([]);
  });

  it('feeds several open channels at once, and none once closed', async () => {
    const { host, agents, bus } = await channelRig('a1', 'a2', 'a3');
    for (const id of ['a1', 'a2']) await host.setChannel(id, true);
    await settle();
    for (const id of ['a1', 'a2']) agents.typed.set(id, []);

    bus.publish(slice(0));
    await settle();
    await host.setChannel('a2', false);
    bus.publish(slice(1));
    await settle();

    expect(agents.typed.get('a1')).toEqual(['Words 0.', `${LINE_BREAK}Words 1.`]);
    expect(agents.typed.get('a2')).toEqual(['Words 0.']);
    expect(agents.typed.get('a3')).toEqual([]);
    expect(host.state()?.channels).toEqual(['a1']);
  });

  it('tells a meeting agent the session file once, even with its channel closed, and not again when it opens', async () => {
    const { host, agents } = await channelRig('a1');
    const { file } = host.state()!;

    for (let time = 0; time < 2; time += 1) {
      const telling = host.tellSession('a1');
      await settle();
      await telling;
    }
    await host.setChannel('a1', true);
    await settle();

    expect(agents.typed.get('a1')).toEqual([`session: ${file}`, ENTER]);
  });

  it('refuses to tell an agent the session file when no session runs', async () => {
    const setup = await rig();
    setup.agents.add('a1');

    expect(await refusal(setup.host.tellSession('a1'))).toBe('no-session');
    expect(setup.agents.typed.get('a1')).toEqual([]);
  });

  it('lists the open channels with no session running as well as during one', async () => {
    const setup = await rig();
    setup.agents.add('a1', 'a2');

    await setup.host.setChannel('a2', true);
    await setup.host.setChannel('a1', true);
    expect(setup.host.channels()).toEqual(['a2', 'a1']);
    await setup.host.startSession(PROJECT);
    await setup.host.setChannel('a2', false);

    expect(setup.host.channels()).toEqual(['a1']);
  });

  it('tells agents whose channel is already open about a session started later, once each', async () => {
    const setup = await rig();
    setup.agents.add('a1');
    await setup.host.setChannel('a1', true);
    expect(setup.agents.typed.get('a1')).toEqual([]);

    const starting = setup.host.startSession(PROJECT);
    await settle();
    await starting;
    await setup.host.setChannel('a1', false);
    await setup.host.setChannel('a1', true);
    await settle();

    expect(setup.agents.typed.get('a1')).toEqual(['session: .grillo/sessions/2026-10-24-091500.md', ENTER]);
  });

  it('closes the channel of an agent that has gone, and the other channels go on', async () => {
    const { host, agents, bus } = await channelRig('a1', 'a2');
    for (const id of ['a1', 'a2']) await host.setChannel(id, true);
    await settle();

    agents.exit('a1');
    bus.publish(slice(0));
    await settle();

    expect(host.state()?.channels).toEqual(['a2']);
    expect(agents.text('a2')).toContain('Words 0.');
  });

  it.each([
    ['open a channel', (host: SessionHost) => host.setChannel('ghost', true)],
    ['use it', (host: SessionHost) => host.useIt('ghost')],
    ['type a mode', (host: SessionHost) => host.typeMode('ghost', 'listen')],
    ['type the presence', (host: SessionHost) => host.typePresent('ghost', [HOST])],
    ['skip', (host: SessionHost) => host.skip('ghost')],
    ['jump', (host: SessionHost) => host.jump('ghost', 3)],
    ['open a channel with no id', (host: SessionHost) => host.setChannel(undefined as unknown as string, true)],
  ])('refuses to %s for an agent that is not running', async (_case, call) => {
    const { host } = await channelRig('a1');

    expect(await refusal(call(host))).toBe('unknown-agent');
  });

  it.each([
    ['ticket 0', () => 0],
    ['a negative ticket', () => -1],
    ['a fraction', () => 1.5],
    ['a ticket given as text', () => '12'],
    ['not a number', () => Number.NaN],
  ])('refuses to jump to %s and types nothing', async (_case, ticket) => {
    const { host, agents } = await channelRig('a1');

    expect(await refusal(host.jump('a1', ticket() as number))).toBe('invalid');
    expect(agents.typed.get('a1')).toEqual([]);
  });

  it.each([
    ['a mode other than listen or type', () => host => host.typeMode('a1', 'dictate' as 'listen')],
    ['a channel switch that is not on or off', () => host => host.setChannel('a1', 'open' as unknown as boolean)],
  ] as [string, () => (host: SessionHost) => Promise<void>][])('refuses %s', async (_case, call) => {
    const { host, agents } = await channelRig('a1');

    expect(await refusal(call()(host))).toBe('invalid');
    expect(agents.typed.get('a1')).toEqual([]);
  });

  it('types nothing into a terminal agent before its runtime reports it ready, so a start-up question is never answered', async () => {
    const setup = await rig();
    const ptys: FakePty[] = [];
    const runtime = createAgentRuntime({
      findClaude: () => '/opt/made-up/bin/claude',
      shipSkills: async () => undefined,
      spawnPty: (file, args, options) => {
        const pty = new FakePty(file, args, options);
        ptys.push(pty);
        return pty;
      },
      env: {},
      events: { output: () => undefined, exited: () => undefined, listChanged: () => undefined },
    });
    const host = createSessionHost({ store: setup.store, slices: setup.bus, transcriber: setup.transcriber, agents: runtime });
    await host.startSession(PROJECT);
    const firstMessage = '/grillo-meeting';
    const agentId = await runtime.startAgent({ kind: 'grilling', folder: '/memory/Grillo', title: 'Grilling', firstMessage });
    const pty = ptys[0];
    pty.print('Quick safety check: Is this a project you trust?\r\n ❯ No, exit\r\n   Yes, I trust this folder');

    const telling = host.tellSession(agentId);
    await settle();
    expect(pty.written).toEqual([]);

    pty.print('──────\r\n❯ ');
    pty.print(firstMessage);
    await settle();
    await telling;

    const sessionMessage = `session: ${host.state()?.file}`;
    expect(pty.written).toEqual([firstMessage, ENTER, sessionMessage, ENTER]);
  });

  it('closes every channel and the recording when the session ends', async () => {
    const { host, agents, bus, store } = await channelRig('a1');
    const { id } = host.state()!;
    await host.setChannel('a1', true);
    bus.publish(slice(0));

    const ending = host.endSession();
    await settle();
    await ending;
    bus.publish(slice(1));
    await settle();

    expect(host.state()).toBeNull();
    expect((await sessionFile(store, id)).transcript).toBe('Words 0.');
    expect(agents.text('a1')).not.toContain('Words 1.');
  });
});
