import { describe, expect, it } from 'vitest';
import type { AgentInfo, StartAgentRequest } from '../../../shared/agents';
import type { ChatMessage } from '../../../shared/agent-chat';
import { CHAT_FLAGS, createClaudeChatDriver } from '../agent-chat/driver';
import { createChatEventHub } from '../agent-chat/event-hub';
import { FakeChatProcess } from '../agent-chat/fake-process';
import { recorded } from '../agent-chat/recorded-events';
import { relay } from '../agent-chat/relay';
import { createChatAgentRuntime, NO_EXIT_CODE } from './chat-runtime';
import { ClaudeNotFoundError } from './runtime';

// Made-up paths, titles and messages only.
const CLAUDE_PATH = '/opt/made-up/bin/claude';

const request: StartAgentRequest = {
  kind: 'grilling',
  folder: '/home/made-up/demo-project',
  firstMessage: '/grillo-answer 12',
  title: 'Grilling · Sample ticket',
};

/** The real chat driver over fake `claude` processes, shared through one event hub, as in the app. */
function setup(findClaude: () => string = () => CLAUDE_PATH) {
  const processes: FakeChatProcess[] = [];
  const hub = createChatEventHub();
  const driver = createClaudeChatDriver({
    findClaude,
    shipSkills: async () => undefined,
    spawnProcess: (file, args, options) => {
      const process = new FakeChatProcess(file, args, options);
      processes.push(process);
      return process;
    },
    env: { PATH: '/opt/made-up/bin' },
    events: hub.events,
  });
  const chatMessages: Array<{ id: string; message: ChatMessage }> = [];
  hub.observe({ message: (id, message) => chatMessages.push({ id, message }), raw: () => undefined, exited: () => undefined });
  const output: Array<{ id: string; data: string }> = [];
  const exits: Array<{ id: string; exitCode: number }> = [];
  const lists: AgentInfo[][] = [];
  const runtime = createChatAgentRuntime({
    driver,
    observe: hub.observe,
    events: {
      output: (id, data) => output.push({ id, data }),
      exited: (id, exitCode) => exits.push({ id, exitCode }),
      listChanged: (list) => lists.push(list),
    },
  });
  /** The user messages Grillo wrote into one process's stdin. */
  const userLines = (process: FakeChatProcess) =>
    process.writtenEvents.filter((event) => (event as { type?: string }).type === 'user');
  return { runtime, driver, hub, processes, chatMessages, output, exits, lists, userLines };
}

const userLine = (content: string) => ({ type: 'user', message: { role: 'user', content } });

describe('chat agent runtime', () => {
  it('starts each tab as a chat agent with the tab id: exactly one claude process per tab, with the chat flags', async () => {
    const { runtime, processes, chatMessages, lists } = setup();

    const first = await runtime.startAgent(request);
    const second = await runtime.startAgent({ ...request, kind: 'task', title: 'Task · Sample export' });

    expect(runtime.choice).toBe('chat');
    expect(processes).toHaveLength(2);
    expect(processes.map(({ file, args, options }) => [file, args, options.cwd])).toEqual([
      [CLAUDE_PATH, CHAT_FLAGS, request.folder],
      [CLAUDE_PATH, CHAT_FLAGS, request.folder],
    ]);
    expect(runtime.list()).toEqual([
      { id: first, kind: 'grilling', title: request.title, folder: request.folder, waiting: false },
      { id: second, kind: 'task', title: 'Task · Sample export', folder: request.folder, waiting: false },
    ]);
    expect(lists.at(-1)).toEqual(runtime.list());
    expect(chatMessages.map(({ id }) => id)).toEqual([first, second]);
  });

  it('shares its id with the chat driver, so the chat channels and the relay reach the tab', async () => {
    const { runtime, driver, processes, userLines } = setup();
    const id = await runtime.startAgent({ ...request, firstMessage: '' });

    expect(driver.send(id, 'Sample question')).toEqual({ ok: true });
    expect(relay(driver, id, 'Sample Member', 'Sample relay')).toEqual({ ok: true });

    expect(userLines(processes[0])).toEqual([
      userLine('Sample question'),
      userLine('[from Support, for Sample Member] Sample relay'),
    ]);
  });

  it('sends a whole message as one chat message, and refuses an empty one or an unknown tab', async () => {
    const { runtime, processes, userLines } = setup();
    const id = await runtime.startAgent({ ...request, firstMessage: '' });

    await runtime.send(id, 'Sample line one\nSample line two\nuse it');

    expect(userLines(processes[0])).toEqual([userLine('Sample line one\nSample line two\nuse it')]);
    await expect(runtime.send(id, '')).rejects.toThrow('A message cannot be empty');
    await expect(runtime.send('no-such-tab', 'x')).rejects.toThrow("No agent with id 'no-such-tab'");
    expect(userLines(processes[0])).toHaveLength(1);
  });

  it('follows the chat waiting events with the tab dot: on at turn end, question or permission; off when it talks again', async () => {
    const { runtime, processes, lists } = setup();
    const id = await runtime.startAgent(request);
    const waiting = () => runtime.list()[0].waiting;
    const claude = processes[0];

    claude.emit(recorded.init, recorded.assistantText('Sample reply'));
    expect(waiting()).toBe(false);
    claude.emit(recorded.result('Sample reply'));
    expect(waiting()).toBe(true);
    expect(lists.at(-1)?.[0].waiting).toBe(true);

    await runtime.send(id, 'Sample answer');
    expect(waiting()).toBe(false);
    claude.emit(recorded.questionRequest);
    expect(waiting()).toBe(true);

    claude.emit(recorded.assistantText('Thanks'));
    expect(waiting()).toBe(false);
    claude.emit(recorded.permissionRequest);
    expect(waiting()).toBe(true);
  });

  it('shows every raw event line on the tab, as lines of terminal output', async () => {
    const { runtime, processes, output } = setup();
    const id = await runtime.startAgent(request);

    processes[0].emit(recorded.init, recorded.assistantText('Sample reply'));

    expect(output).toEqual([
      { id, data: `${recorded.init}\r\n` },
      { id, data: `${recorded.assistantText('Sample reply')}\r\n` },
    ]);
  });

  it('drops a tab whose Claude Code ends, reporting it once, and an end without a code as NO_EXIT_CODE', async () => {
    const { runtime, processes, exits, lists } = setup();
    const first = await runtime.startAgent(request);
    const second = await runtime.startAgent(request);

    processes[0].exit(0);
    processes[0].exit(0);
    processes[1].exit(null);

    expect(exits).toEqual([
      { id: first, exitCode: 0 },
      { id: second, exitCode: NO_EXIT_CODE },
    ]);
    expect(runtime.list()).toEqual([]);
    expect(lists.at(-1)).toEqual([]);
  });

  it('stops a tab by ending its one claude process, leaving the others; stopAll ends every one', async () => {
    const { runtime, processes, exits } = setup();
    const first = await runtime.startAgent(request);
    const second = await runtime.startAgent(request);
    await runtime.startAgent(request);

    runtime.stop(first);
    runtime.stop(first);
    runtime.stop('no-such-tab');
    expect(processes.map(({ stopped }) => stopped)).toEqual([true, false, false]);
    expect(runtime.list().map(({ id }) => id)).not.toContain(first);
    expect(runtime.list().map(({ id }) => id)).toContain(second);

    runtime.stopAll();
    expect(processes.map(({ stopped }) => stopped)).toEqual([true, true, true]);
    expect(runtime.list()).toEqual([]);
    expect(exits).toEqual([]);
  });

  it('renames a tab, has no terminal to type into or resize, and refuses unknown tab ids', async () => {
    const { runtime } = setup();
    const id = await runtime.startAgent(request);

    runtime.setTitle(id, 'Grilling · Renamed');
    expect(runtime.list()[0].title).toBe('Grilling · Renamed');
    expect(() => runtime.write(id, 'x')).toThrow('has no terminal');
    expect(() => runtime.resize(id, 80, 24)).not.toThrow();
    expect(() => runtime.write('no-such-tab', 'x')).toThrow("No agent with id 'no-such-tab'");
    expect(() => runtime.resize('no-such-tab', 80, 24)).toThrow("No agent with id 'no-such-tab'");
    expect(() => runtime.setTitle('no-such-tab', 'x')).toThrow("No agent with id 'no-such-tab'");
  });

  it('refuses a bad start request, and a missing claude, before starting any process', async () => {
    const { runtime, processes } = setup(() => {
      throw new ClaudeNotFoundError();
    });

    await expect(runtime.startAgent({ ...request, title: undefined } as unknown as StartAgentRequest)).rejects.toThrow(
      'Invalid agent start request',
    );
    await expect(runtime.startAgent(request)).rejects.toThrow(ClaudeNotFoundError);
    expect(processes).toEqual([]);
    expect(runtime.list()).toEqual([]);
  });

  describe('untrusted protocol events', () => {
    it('ignores events for unknown tabs, null or misshapen messages and lines, changing nothing', async () => {
      const { runtime, hub, output, exits, lists } = setup();
      const id = await runtime.startAgent(request);
      const announced = lists.length;

      hub.events.message('no-such-tab', { type: 'result', isError: false, text: '' });
      hub.events.raw('no-such-tab', recorded.init);
      hub.events.exited('no-such-tab', 0);
      for (const bad of [null, undefined, 'result', 42, [], {}, { type: null }, { type: 'no-such-type' }]) {
        hub.events.message(id, bad as unknown as ChatMessage);
      }
      for (const bad of [null, undefined, 42, {}]) hub.events.raw(id, bad as unknown as string);
      hub.events.message(null as unknown as string, { type: 'result', isError: false, text: '' });

      expect(lists).toHaveLength(announced);
      expect(output).toEqual([]);
      expect(exits).toEqual([]);
      expect(runtime.list()).toEqual([expect.objectContaining({ id, waiting: false })]);
    });

    it('turns unreadable stdout into the protocol error message, keeping the tab running and its dot as it was', async () => {
      const { runtime, processes, chatMessages, lists } = setup();
      const id = await runtime.startAgent({ ...request, firstMessage: '' });
      const announced = lists.length;

      processes[0].emit('null', 'not json', '[]', '{"type":null}', '{"type":"control_request"}');

      expect(chatMessages.map(({ message }) => message.type)).toEqual(['error', 'error', 'error', 'error', 'error']);
      expect(lists).toHaveLength(announced);
      expect(runtime.list()).toEqual([expect.objectContaining({ id, waiting: false })]);
    });

    it('announces the dot once for a repeated turn end or question, and ignores events after the tab ended', async () => {
      const { runtime, processes, lists, output } = setup();
      await runtime.startAgent({ ...request, firstMessage: '' });
      const announced = lists.length;

      processes[0].emit(recorded.result('Sample'), recorded.result('Sample'), recorded.questionRequest, recorded.questionRequest);
      expect(lists).toHaveLength(announced + 1);

      processes[0].exit(0);
      const afterExit = { lists: lists.length, output: output.length };
      processes[0].emit(recorded.assistantText('too late'));
      expect({ lists: lists.length, output: output.length }).toEqual(afterExit);
    });
  });
});
