import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionError } from '../../../shared/session';
import { createClaudeChatDriver } from '../agent-chat/driver';
import { createChatEventHub } from '../agent-chat/event-hub';
import { FakeChatProcess } from '../agent-chat/fake-process';
import { recorded } from '../agent-chat/recorded-events';
import { createChatAgentRuntime } from '../agents/chat-runtime';
import { ENTER_AFTER_QUIET_MS } from '../agents/runtime';
import { createSliceBus } from '../audio/slices';
import { createMemoryStore } from '../../store/memory';
import { createSessionHost, type SessionStore } from './session';

// Made-up project, logins and speech only.
const PROJECT = 'example-org/chat-demo';
const HOST = 'ada-example';
const SESSION_FILE = '.grillo/sessions/2026-10-24-091500.md';

/** The live session over the real chat agent runtime, with Claude Code played by a fake chat process. */
async function rig() {
  vi.useFakeTimers({ now: new Date('2026-10-24T09:15:00.000Z'), toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  const memory = createMemoryStore({ now: () => new Date() });
  await memory.createProject({ newRepository: { organisation: 'example-org', name: 'chat-demo' } });
  /** Every store write the session makes, in order, with what it wrote. */
  const writes: string[] = [];
  const store: SessionStore = {
    currentMember: (project) => memory.currentMember(project),
    createSession: (project, session) => {
      writes.push(`create ${JSON.stringify(session)}`);
      return memory.createSession(project, session);
    },
    updateSession: (project, id, change) => {
      writes.push(`update ${JSON.stringify(change)}`);
      return memory.updateSession(project, id, change);
    },
  };

  const processes: FakeChatProcess[] = [];
  const hub = createChatEventHub();
  const driver = createClaudeChatDriver({
    findClaude: () => '/opt/made-up/bin/claude',
    shipSkills: async () => undefined,
    spawnProcess: (file, args, options) => {
      const process = new FakeChatProcess(file, args, options);
      processes.push(process);
      return process;
    },
    env: {},
    events: hub.events,
  });
  const agents = createChatAgentRuntime({
    driver,
    observe: hub.observe,
    events: { output: () => undefined, exited: () => undefined, listChanged: () => undefined },
  });
  const bus = createSliceBus();
  const host = createSessionHost({
    store,
    slices: bus,
    transcriber: { transcribe: async (pcm) => `Words ${pcm[0]}.` },
    agents,
  });
  const id = await agents.startAgent({ kind: 'grilling', folder: '/memory/chat-demo', firstMessage: '', title: 'Grilling' });

  await host.startSession(PROJECT);
  await host.tickConsent(HOST);
  await host.setRecording(true);
  /** The chat messages the agent received, in order. */
  const sent = () =>
    processes[0].writtenEvents
      .filter((event) => (event as { type?: string }).type === 'user')
      .map((event) => (event as { message: { content: string } }).message.content);
  const hear = async (...indexes: number[]) => {
    for (const index of indexes) bus.publish({ source: 'microphone', index, pcm: Int16Array.of(index) });
    await settle();
  };
  return { host, agents, driver, processes, id, writes, sent, hear };
}

/** Lets every queued transcription, store write and message finish. */
async function settle(): Promise<void> {
  for (let step = 0; step < 10; step += 1) await vi.advanceTimersByTimeAsync(ENTER_AFTER_QUIET_MS);
}

async function done<T>(promise: Promise<T>): Promise<T> {
  await settle();
  return promise;
}

beforeEach(() => vi.useRealTimers());
afterEach(() => vi.useRealTimers());

describe('grilling session over chat agents', () => {
  it('keeps the live transcript while the channel is open and sends it with "use it" as one chat message', async () => {
    const { host, id, sent, hear } = await rig();

    await done(host.setChannel(id, true));
    await hear(0, 1);
    expect(sent()).toEqual([`session: ${SESSION_FILE}`]);

    await done(host.useIt(id));
    await hear(2);
    await done(host.useIt(id));

    expect(sent()).toEqual([`session: ${SESSION_FILE}`, 'Words 0.\nWords 1.\nuse it', 'Words 2.\nuse it']);
  });

  it('sends each screen control line as one chat message, below any transcript it carries', async () => {
    const { host, id, sent, hear } = await rig();
    await done(host.setChannel(id, true));
    await hear(0);

    await done(host.typePresent(id, [HOST]));
    await done(host.typeMode(id, 'type'));
    await hear(1);
    await done(host.typeMode(id, 'listen'));
    await done(host.skip(id));
    await done(host.jump(id, 12));

    expect(sent()).toEqual([
      `session: ${SESSION_FILE}`,
      `Words 0.\npresent: ${HOST}`,
      'mode: type',
      'mode: listen',
      'skip',
      'jump 12',
    ]);
  });

  it('refuses with the unknown-agent error, and closes the channel, when the chat agent can no longer take messages', async () => {
    const { host, driver, id } = await rig();
    await done(host.setChannel(id, true));
    driver.stop(id);

    const error = await done(host.useIt(id).catch((thrown: unknown) => thrown));

    expect(error).toBeInstanceOf(SessionError);
    expect((error as SessionError).kind).toBe('unknown-agent');
    expect(host.channels()).toEqual([]);
  });

  it('makes no GitHub write twice for one agent action, whatever Claude Code repeats', async () => {
    const { host, id, processes, writes, sent, hear } = await rig();
    await done(host.setChannel(id, true));
    await hear(0, 1);
    const writesBefore = [...writes];

    await done(host.setChannel(id, true));
    await done(host.tellSession(id));
    await done(host.useIt(id));
    processes[0].emit(
      recorded.result('Sample'),
      recorded.result('Sample'),
      recorded.questionRequest,
      recorded.questionRequest,
    );
    processes[0].exit(0);
    processes[0].exit(0);
    await settle();

    expect(new Set(writes).size).toBe(writes.length);
    expect(writes).toEqual(writesBefore);
    expect(writes.filter((write) => write.startsWith('create'))).toHaveLength(1);
    expect(sent()).toEqual([`session: ${SESSION_FILE}`, 'Words 0.\nWords 1.\nuse it']);
  });
});
