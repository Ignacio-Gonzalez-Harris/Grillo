// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerAgentChatChannels } from '../../../main/features/agent-chat/channels';
import { createChatEventHub } from '../../../main/features/agent-chat/event-hub';
import { FakeChatProcess } from '../../../main/features/agent-chat/fake-process';
import {
  PERMISSION_REQUEST_ID,
  QUESTION_INPUT,
  QUESTION_REQUEST_ID,
  recorded,
  WRITE_INPUT,
} from '../../../main/features/agent-chat/recorded-events';
import { registerChosenAgentChannels } from '../../../main/features/agents/channels';
import { FakePty } from '../../../main/features/agents/fake-pty';
import { createSliceBus } from '../../../main/features/audio/slices';
import { registerSessionChannels } from '../../../main/features/session/channels';
import { createSessionHost } from '../../../main/features/session/session';
import { createMainIpc } from '../../../main/ipc/bridge';
import { createFakeIpc } from '../../../main/ipc/fake-ipc';
import { createMemoryStore } from '../../../main/store/memory';
import { createGrilloApi } from '../../../preload/bridge';
import type { AgentKind, AgentRuntimeChoice } from '../../../shared/agents';
import { registerScreens, type ScreenModule } from '../../app/screens';
import { createShell, type Shell } from '../../app/shell';
import { FakeTerminalView } from '../../components/terminal/fake-terminal-view';
import { createAgentTabs, type AgentTabs } from '../agent-tab/agent-tabs';
import { registerTabPanels } from '../agent-tab/tab-panels';
import { terminalPanel } from '../agent-tab/terminal-panel';
import { createChatLog, MAX_RAW_LINES } from './chat-log';
import { chatViewPanel, RAW_STREAM_HEADER, USE_IT_SENDS_THE_BOX } from './chat-panel';

// Made-up project, member, tickets and speech only.
const PROJECT = 'example-org/chat-view-demo';
const HOST = 'ada-example';
const FOLDER = '/memory/chat-view-demo';
const OTHER_QUESTION_ID = '33333333-3333-4333-8333-333333333333';

const flush = async () => {
  for (let step = 0; step < 5; step += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

/** A clickable-options question in the shape Claude Code sends it, with its own request id. */
function questionLine(requestId: string, input: unknown): string {
  return JSON.stringify({
    type: 'control_request',
    request_id: requestId,
    request: { subtype: 'can_use_tool', tool_name: 'AskUserQuestion', input, tool_use_id: `toolu_${requestId}` },
  });
}

/**
 * The app as it runs, in process: the real agent chat and agent channels over the IPC fake (Claude Code played by
 * fake chat processes, or fake terminals under the terminal runtime), the real live session on the in-memory store,
 * and the shell with the agent tab showing the chat view above the built-in terminal.
 */
async function app(choice: AgentRuntimeChoice = 'chat') {
  const fake = createFakeIpc();
  const ipc = createMainIpc(fake.main, () => [fake.window]);
  const processes: FakeChatProcess[] = [];
  const ptys: FakePty[] = [];
  const tools = { findClaude: () => '/opt/made-up/bin/claude', shipSkills: async () => undefined, env: {} };
  const hub = createChatEventHub();
  const driver = registerAgentChatChannels(
    ipc,
    {
      ...tools,
      spawnProcess: (file, args, options) => {
        const process = new FakeChatProcess(file, args, options);
        processes.push(process);
        return process;
      },
    },
    hub.events,
  );
  const runtime = registerChosenAgentChannels(ipc, choice, {
    terminal: {
      ...tools,
      spawnPty: (file, args, options) => {
        const pty = new FakePty(file, args, options);
        ptys.push(pty);
        return pty;
      },
    },
    chat: { driver, observe: hub.observe },
  });

  const store = createMemoryStore({ now: () => new Date() });
  await store.createProject({ newRepository: { organisation: 'example-org', name: 'chat-view-demo' } });
  const bus = createSliceBus();
  const host = createSessionHost({
    store,
    slices: bus,
    transcriber: { transcribe: async (pcm) => `Words ${pcm[0]}.` },
    agents: runtime,
    held: (agentId, text) => ipc.send('session:held', { agentId, text }),
  });
  registerSessionChannels(ipc, host);

  const grillo = createGrilloApi(fake.renderer);
  // As the chat view's index.ts does when the shell starts: the log hears every agent from its first message.
  const log = createChatLog(grillo);
  const panels = registerTabPanels({}, [
    terminalPanel(() => new FakeTerminalView()),
    chatViewPanel({ log: () => log, terminal: terminalPanel(() => new FakeTerminalView()) }),
  ]);
  let tabs: AgentTabs | undefined;
  const agentTabScreen: ScreenModule = {
    id: 'agent-tab',
    title: 'Agent',
    start(shellContext) {
      tabs = createAgentTabs(shellContext, panels);
      return () => tabs?.dispose();
    },
    mount: (el, params) => (tabs as AgentTabs).show(el, params['agentId'] ?? ''),
  };
  const root = document.createElement('div');
  document.body.append(root);
  shell = createShell(root, { grillo, screens: registerScreens({ '/src/renderer/screens/agent-tab/index.ts': agentTabScreen }) });

  const content = () => root.querySelector('main') as HTMLElement;
  const chat = () => content().querySelector<HTMLElement>('.chat-view') as HTMLElement;
  const box = () => chat().querySelector<HTMLInputElement>('.msgbox input') as HTMLInputElement;
  const sendButton = () => chat().querySelector<HTMLButtonElement>('.msgbox button') as HTMLButtonElement;
  const buttonNamed = (name: string) =>
    [...chat().querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.startsWith(name)) as HTMLButtonElement;
  return {
    ipc,
    grillo,
    host,
    bus,
    processes,
    ptys,
    content,
    chat,
    box,
    sendButton,
    buttonNamed,
    /** The Use it line under the box, while it shows. */
    hint: () => {
      const hint = hintOf(chat());
      return hint && !hint.hidden ? hint.textContent : undefined;
    },
    bubbles: () =>
      [...chat().querySelectorAll('.msgs .bubble')].map((bubble) => ({
        me: bubble.classList.contains('me'),
        text: bubble.textContent ?? '',
      })),
    /** Starts an agent, lets its tab appear and opens it. */
    async startAgent(kind: AgentKind, ticket: string, firstMessage = '') {
      const title = `${kind.charAt(0).toUpperCase()}${kind.slice(1)} · ${ticket}`;
      const id = await grillo.invoke('agents:start', { kind, folder: FOLDER, firstMessage, title });
      await flush();
      shell?.navigate('agent-tab', { agentId: id });
      await flush();
      return { id, process: processes.at(-1) as FakeChatProcess };
    },
    /** What Grillo wrote into a chat agent's input after the start, as JSON events. */
    writtenAfterStart: (process: FakeChatProcess) => process.writtenEvents.slice(1),
  };
}

let shell: Shell | undefined;
const hintOf = (chat: HTMLElement) => chat.querySelector<HTMLElement>('.chat-hint');

afterEach(() => {
  shell?.dispose();
  shell = undefined;
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe('chat view: the body of every chat agent tab (prototype screen-chat-view)', () => {
  it('shows the conversation as bubbles from the first message on, and Send writes one chat message', async () => {
    const view = await app();
    const { process } = await view.startAgent('grilling', 'Sample ticket 4', '/grillo-answer 4');

    process.emit(recorded.init, recorded.assistantText('Sample question 4.1: a made-up question.'));
    view.box().value = 'Sample option A, for a sample reason.';
    view.box().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await flush();

    const head = view.chat().querySelector('.chat-head')?.textContent;
    expect(head).toContain('Grilling agent');
    expect(head).toContain('Sample ticket 4');
    expect(view.chat().querySelector('.msgs')?.getAttribute('role')).toBe('log');
    expect(view.bubbles()).toEqual([
      { me: true, text: expect.stringContaining('/grillo-answer 4') },
      { me: false, text: expect.stringContaining('Sample question 4.1: a made-up question.') },
      { me: true, text: expect.stringContaining('Sample option A, for a sample reason.') },
    ]);
    expect(view.writtenAfterStart(process).at(-1)).toEqual({
      type: 'user',
      message: { role: 'user', content: 'Sample option A, for a sample reason.' },
    });
    expect(view.box().value).toBe('');
  });

  it('answers a clickable-options question with one click on an option', async () => {
    const view = await app();
    const { process } = await view.startAgent('generic', 'Sample customer email');

    process.emit(recorded.questionRequest);
    const option = view.buttonNamed('Blue');
    expect(option.textContent).toContain('Write Blue into colour.txt.');
    option.click();
    await flush();

    expect(view.writtenAfterStart(process).at(-1)).toEqual({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: QUESTION_REQUEST_ID,
        response: { behavior: 'allow', updatedInput: { ...QUESTION_INPUT, answers: { 'Which colour?': 'Blue' } } },
      },
    });
    expect(option.getAttribute('aria-pressed')).toBe('true');
    expect(view.buttonNamed('Red').disabled).toBe(true);
  });

  it('answers with "Something else": the next message the member writes is the answer', async () => {
    const view = await app();
    const { process } = await view.startAgent('grilling', 'Sample ticket 4');
    process.emit(questionLine(OTHER_QUESTION_ID, QUESTION_INPUT));

    view.buttonNamed('Something else').click();
    view.box().value = 'A sample shade of green';
    view.sendButton().click();
    await flush();

    expect(view.writtenAfterStart(process).at(-1)).toEqual({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: OTHER_QUESTION_ID,
        response: {
          behavior: 'allow',
          updatedInput: { ...QUESTION_INPUT, answers: { 'Which colour?': 'A sample shade of green' } },
        },
      },
    });
    expect(view.buttonNamed('Blue').disabled).toBe(true);
  });

  it('sends the next message as a plain message once a question started with "Something else" is answered by a click', async () => {
    const view = await app();
    const { process } = await view.startAgent('grilling', 'Sample ticket 4');
    process.emit(recorded.questionRequest);

    view.buttonNamed('Something else').click();
    view.buttonNamed('Red').click();
    await flush();
    view.box().value = 'A sample remark';
    view.sendButton().click();
    await flush();

    expect(view.writtenAfterStart(process).at(-1)).toEqual({
      type: 'user',
      message: { role: 'user', content: 'A sample remark' },
    });
    expect(view.box().placeholder).toBe('Write to the agent…');
  });

  it('answers several questions at once, each with its own pick', async () => {
    const view = await app();
    const { process } = await view.startAgent('research', 'Sample topic');
    const second = {
      question: 'Which sample size?',
      header: 'Size',
      options: [
        { label: 'Small', description: 'A made-up small size.' },
        { label: 'Large', description: 'A made-up large size.' },
      ],
      multiSelect: true,
    };
    process.emit(questionLine(OTHER_QUESTION_ID, { questions: [...QUESTION_INPUT.questions, second] }));

    view.buttonNamed('Red').click();
    view.buttonNamed('Small').click();
    view.buttonNamed('Large').click();
    view.buttonNamed('Send answers').click();
    await flush();

    const sent = view.writtenAfterStart(process).at(-1) as { response: { response: { updatedInput: unknown } } };
    expect(sent.response.response.updatedInput).toEqual({
      questions: [...QUESTION_INPUT.questions, second],
      answers: { 'Which colour?': 'Red', 'Which sample size?': 'Small, Large' },
    });
  });

  it.each([
    ['Allow', { behavior: 'allow', updatedInput: WRITE_INPUT }],
    ['Deny', { behavior: 'deny', message: 'The member said no.' }],
  ])('answers a permission prompt with %s', async (choice, response) => {
    const view = await app();
    const { process } = await view.startAgent('task', 'Sample export');

    process.emit(recorded.permissionRequest);
    expect(view.chat().querySelector('.msgs')?.textContent).toContain('Asks permission');
    view.buttonNamed(choice).click();
    await flush();

    expect(view.writtenAfterStart(process).at(-1)).toEqual({
      type: 'control_response',
      response: { subtype: 'success', request_id: PERMISSION_REQUEST_ID, response },
    });
    expect(view.buttonNamed('Allow').disabled).toBe(true);
    expect(view.buttonNamed('Deny').disabled).toBe(true);
  });

  it('shows the raw event stream, read-only, under the chat while "Show terminal" is on', async () => {
    const view = await app();
    const { process } = await view.startAgent('grilling', 'Sample ticket 4');
    const prompt = JSON.stringify({ type: 'user', message: { role: 'user', content: '/grillo-answer 4' } });
    process.emit(recorded.init, prompt, recorded.toolResult, recorded.questionRequest);
    const terminal = () => view.chat().querySelector<HTMLElement>('pre.terminal') as HTMLElement;
    const toggle = [...view.chat().querySelectorAll<HTMLLabelElement>('.chat-head label.switch')].find((label) =>
      label.textContent?.includes('Show terminal'),
    );
    expect(terminal().hidden).toBe(true);

    toggle?.querySelector('input')?.click();

    expect(terminal().hidden).toBe(false);
    expect(terminal().getAttribute('aria-label')).toBe('Raw event stream');
    expect(terminal().textContent).toContain(RAW_STREAM_HEADER);
    expect(terminal().textContent).toContain(recorded.init);
    expect(terminal().textContent).toContain(recorded.questionRequest);
    expect(terminal().querySelector('input, textarea')).toBeNull();
    const toneOf = (line: string) =>
      [...terminal().querySelectorAll('.raw-line')].find((node) => node.textContent === line)?.className;
    expect([prompt, recorded.toolResult, recorded.questionRequest].map(toneOf)).toEqual([
      'raw-line t-prompt',
      'raw-line t-ok',
      'raw-line t-hl',
    ]);
  });

  it('turns a message it cannot read, or an error the agent reports, into an error note and carries on', async () => {
    const view = await app();
    const { id, process } = await view.startAgent('generic', 'Sample customer email');

    view.ipc.send('agent-chat:message', { id, message: { type: 'telemetry' } as never });
    process.emit(recorded.assistantText('Still here'));

    expect(view.chat().querySelector('.msgs .note.err')?.textContent).toContain('could not read a message');
    expect(view.bubbles().at(-1)?.text).toContain('Still here');
  });

  it('fills the message box with the live transcript while the channel is open, and Use it sends it as one message', async () => {
    const view = await app();
    const { id, process } = await view.startAgent('grilling', 'Sample ticket 3');
    await view.host.startSession(PROJECT);
    await view.host.tickConsent(HOST);
    await view.host.setRecording(true);
    await view.host.setChannel(id, true);
    await flush();

    for (const index of [0, 1]) view.bus.publish({ source: 'microphone', index, pcm: Int16Array.of(index) });
    await flush();
    const whileHeld = { value: view.box().value, sendable: !view.box().readOnly && !view.sendButton().disabled, hint: view.hint() };
    await view.host.useIt(id);
    await flush();

    expect(whileHeld.value).toBe('Words 0. Words 1.');
    expect(whileHeld.sendable).toBe(true);
    expect(whileHeld.hint).toBe(USE_IT_SENDS_THE_BOX);
    expect(view.writtenAfterStart(process).filter((event) => (event as { type: string }).type === 'user').at(-1)).toEqual({
      type: 'user',
      message: { role: 'user', content: 'Words 0.\nWords 1.\nuse it' },
    });
    expect(view.box().value).toBe('');
    expect(view.box().readOnly).toBe(false);
  });

  it('lets the member write again on a tab with no Use it once the channel closes and the session ends', async () => {
    const view = await app();
    const { id, process } = await view.startAgent('generic', 'Sample customer email');
    await view.host.startSession(PROJECT);
    await view.host.tickConsent(HOST);
    await view.host.setRecording(true);
    await view.host.setChannel(id, true);
    await flush();
    view.bus.publish({ source: 'microphone', index: 0, pcm: Int16Array.of(0) });
    await flush();
    await view.host.setChannel(id, false);
    await view.host.endSession();
    await flush();

    view.box().value = 'Sample note';
    view.sendButton().click();
    await flush();

    expect(view.writtenAfterStart(process).at(-1)).toEqual({ type: 'user', message: { role: 'user', content: 'Sample note' } });
    expect(view.box().value).toBe('');
    expect(view.box().readOnly).toBe(false);
    expect(view.sendButton().disabled).toBe(false);
    expect(view.hint()).toBeUndefined();
  });

  it('sends the held words with Send as the one message, without sending them again later', async () => {
    const view = await app();
    const { id, process } = await view.startAgent('task', 'Sample export');
    await view.host.startSession(PROJECT);
    await view.host.tickConsent(HOST);
    await view.host.setRecording(true);
    await view.host.setChannel(id, true);
    await flush();
    view.bus.publish({ source: 'microphone', index: 0, pcm: Int16Array.of(0) });
    await flush();

    view.box().value = `${view.box().value} Please note this.`;
    view.sendButton().click();
    await flush();
    await view.host.skip(id);
    await flush();

    const sent = view
      .writtenAfterStart(process)
      .filter((event) => (event as { type: string }).type === 'user')
      .map((event) => (event as { message: { content: string } }).message.content);
    expect(sent.slice(-2)).toEqual(['Words 0. Please note this.', 'skip']);
    expect(view.box().value).toBe('');
  });

  it('keeps only the newest raw lines in the shown terminal, as in its replay', async () => {
    const view = await app();
    const { process } = await view.startAgent('generic', 'Sample customer email');

    process.emit(...Array.from({ length: MAX_RAW_LINES + 1 }, (_, line) => JSON.stringify({ type: 'sample', line })));

    const lines = [...view.chat().querySelectorAll('pre.terminal .raw-line')].map((line) => line.textContent);
    expect(lines).toHaveLength(MAX_RAW_LINES);
    expect(lines[0]).toBe(JSON.stringify({ type: 'sample', line: 1 }));
    expect(lines.at(-1)).toBe(JSON.stringify({ type: 'sample', line: MAX_RAW_LINES }));
  });

  it("keeps the terminal as the body of a terminal agent's tab (GRILLO_AGENT_RUNTIME=terminal)", async () => {
    const view = await app('terminal');

    await view.startAgent('task', 'Sample export');

    expect(view.content().querySelector('.chat-view')).toBeNull();
    expect(view.content().querySelector('.agent-terminal')).not.toBeNull();
    expect(view.ptys).toHaveLength(1);
  });
});
