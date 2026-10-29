// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { registerStoreIpc } from '../../../main/features/store/ipc';
import { createMainIpc } from '../../../main/ipc/bridge';
import { createFakeIpc } from '../../../main/ipc/fake-ipc';
import { createMemoryStore } from '../../../main/store/memory';
import { createMemorySettings } from '../../../main/store/memory/settings';
import { createGrilloApi } from '../../../preload/bridge';
import type { ChatActionResult, ChatMessage } from '../../../shared/agent-chat';
import type { AgentInfo, AgentKind, StartAgentRequest } from '../../../shared/agents';
import type { IdentityResult } from '../../../shared/tools';
import { registerScreens, type ScreenModule } from '../../app/screens';
import { createShell, type Shell } from '../../app/shell';
import * as supportAgentScreen from './index';
import { NO_PROJECT, SUPPORT_COMMAND, SUPPORT_TITLE } from './support-agent';

// Made-up projects, logins, tab names and messages only.
const PROJECT = 'example-org/sample-project-1';
const folderOf = (project: string) => `/memory/Grillo/${project}`;
const MEMBER = 'member-example';
const TARGET = 'Grilling · Sample ticket 3';

const flush = async () => {
  for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

let shell: Shell | undefined;

afterEach(() => {
  shell?.dispose();
  shell = undefined;
  document.body.replaceChildren();
});

interface AppOptions {
  opened?: boolean;
  startFails?: string;
  identity?: IdentityResult;
  relayAnswer?: ChatActionResult;
}

/**
 * The app as it runs, in process: the in-memory store behind the real store IPC, a stand-in agent runtime that only
 * records what is started and sent, a stand-in agent chat relay, and the shell with this screen registered as
 * discovery would (the agent tab itself only records that it was opened).
 */
async function app(options: AppOptions = {}) {
  const fake = createFakeIpc();
  const ipc = createMainIpc(fake.main, () => [fake.window]);
  const store = createMemoryStore({ now: () => new Date('2026-10-22T10:00:00.000Z') });
  registerStoreIpc(ipc, store, createMemorySettings());

  let running: AgentInfo[] = [];
  const starts: StartAgentRequest[] = [];
  const sent: Array<{ id: string; text: string }> = [];
  const relays: Array<{ targetAgentId: string; member: string; text: string }> = [];
  const announce = () => ipc.send('agents:list-changed', running);
  ipc.handle('agents:list', () => running);
  let startFails = options.startFails;
  ipc.handle('agents:start', (request) => {
    if (startFails) throw new Error(startFails);
    starts.push(request);
    const id = `agent-${starts.length}`;
    running = [...running, { id, kind: request.kind, title: request.title, folder: request.folder, waiting: false }];
    announce();
    return id;
  });
  ipc.handle('agents:send', (request) => {
    sent.push(request);
  });
  const posted: ChatActionResult = { ok: true };
  ipc.handle('agent-chat:relay', (request) => {
    relays.push(request);
    return options.relayAnswer ?? posted;
  });
  const signedIn: IdentityResult = { ok: true, identity: { login: MEMBER, name: null, email: null } };
  ipc.handle('tools:identity', () => options.identity ?? signedIn);

  await store.createProject({ newRepository: { organisation: 'example-org', name: 'sample-project-1' } });
  if (options.opened !== false) await store.openProjectFolder(PROJECT);

  const visited: Array<{ screenId: string; params: Record<string, string> }> = [];
  const recorder = (screenId: string): ScreenModule => ({
    id: screenId,
    title: screenId,
    mount: (_el, params) => {
      visited.push({ screenId, params: { ...params } });
    },
  });
  const root = document.createElement('div');
  document.body.append(root);
  shell = createShell(root, {
    grillo: createGrilloApi(fake.renderer),
    screens: registerScreens({
      '/src/renderer/screens/support-agent/index.ts': supportAgentScreen,
      '/src/renderer/screens/agent-tab/index.ts': recorder('agent-tab'),
      '/src/renderer/screens/map/index.ts': recorder('map'),
    }),
  });
  await flush();

  return {
    root,
    starts,
    sent,
    relays,
    visited,
    /** The runtime starts agents again, as after the member installs Claude Code. */
    fixStart() {
      startFails = undefined;
    },
    /** Another agent appears on the tab bar, as the runtime announces it. */
    run(id: string, kind: AgentKind, title: string) {
      running = [...running, { id, kind, title, folder: folderOf(PROJECT), waiting: false }];
      announce();
    },
    stop(id: string) {
      running = running.filter((agent) => agent.id !== id);
      announce();
    },
    /** One chat message from an agent, as the agent chat protocol sends it. */
    async says(id: string, message: ChatMessage) {
      ipc.send('agent-chat:message', { id, message });
      await flush();
    },
  };
}

const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
/** The tab bar's tabs after the separators: the agent tabs, then "+". */
const agentTabLabels = (root: HTMLElement) =>
  [...root.querySelectorAll('nav .agent-tabs > .tab')].map((tab) => text(tab.querySelector('.tab-name') ?? tab));
const supportTab = (root: HTMLElement) => root.querySelector<HTMLButtonElement>('nav .support-tab .tab-name');
const screenContent = (root: HTMLElement) => root.querySelector('main') as HTMLElement;
async function openSupport(root: HTMLElement): Promise<void> {
  supportTab(root)?.click();
  await flush();
}
const relayRequest = (to: string, message: string) => ['I will pass it on.', '```grillo-relay', `to: ${to}`, '', message, '```'].join('\n');

describe('support agent tab: registration', () => {
  it('registers as the Support screen through screen discovery', () => {
    const registry = registerScreens({ '/src/renderer/screens/support-agent/index.ts': supportAgentScreen });
    expect(registry.get('support-agent')?.title).toBe('Support');
  });
});

describe('support agent tab: on the tab bar', () => {
  it('shows Support as the first agent tab, before any agent runs and before agents started earlier', async () => {
    const { root, run } = await app();
    expect(agentTabLabels(root)).toEqual(['Support']);

    run('grilling-1', 'grilling', TARGET);
    await flush();
    expect(agentTabLabels(root)).toEqual(['Support', TARGET]);
    expect([...root.querySelectorAll('nav .tab')].map((tab) => text(tab.querySelector('.tab-name') ?? tab)).at(-1)).toBe(
      '+',
    );
  });

  it('marks Support as the open tab while its screen shows, and not after leaving it', async () => {
    const { root, run } = await app({ opened: false });
    await openSupport(root);
    const tab = root.querySelector('nav .support-tab') as HTMLElement;
    expect(tab.classList.contains('active')).toBe(true);
    expect(tab.getAttribute('aria-current')).toBe('page');

    run('grilling-1', 'grilling', TARGET);
    shell?.navigate('map');
    await flush();
    expect(tab.classList.contains('active')).toBe(false);
    expect(tab.hasAttribute('aria-current')).toBe(false);
  });

  it('becomes the running support agent\'s own tab, kept first, and comes back when that agent stops', async () => {
    const { root, run, stop } = await app();
    run('grilling-1', 'grilling', TARGET);
    await openSupport(root);

    expect(agentTabLabels(root)).toEqual([SUPPORT_TITLE, TARGET]);
    expect(root.querySelector('nav .support-tab')).toBeNull();
    const first = root.querySelector('nav .agent-tabs > .tab') as HTMLElement;
    expect(first.dataset['agentId']).toBe('agent-1');

    run('grilling-2', 'grilling', 'Grilling · Sample ticket 4');
    await flush();
    expect(agentTabLabels(root)).toEqual([SUPPORT_TITLE, TARGET, 'Grilling · Sample ticket 4']);

    stop('agent-1');
    await flush();
    expect(agentTabLabels(root)).toEqual(['Support', TARGET, 'Grilling · Sample ticket 4']);
    expect(root.querySelector('nav .support-tab')).not.toBeNull();
  });

  it('takes the Support tab off the tab bar when the shell closes', async () => {
    const { root } = await app();
    shell?.dispose();
    shell = undefined;
    expect(root.querySelector('nav .support-tab')).toBeNull();
  });
});

describe('support agent tab: Answering about the project', () => {
  it('starts the support agent in the project folder with /grillo-support on first open, and opens its agent tab', async () => {
    const { root, starts, visited } = await app();
    await openSupport(root);

    expect(SUPPORT_COMMAND).toBe('/grillo-support');
    expect(starts).toEqual([
      { kind: 'support', folder: folderOf(PROJECT), firstMessage: SUPPORT_COMMAND, title: SUPPORT_TITLE },
    ]);
    expect(visited.at(-1)).toEqual({ screenId: 'agent-tab', params: { agentId: 'agent-1' } });
  });

  it('opens the running support agent instead of starting a second one', async () => {
    const { root, starts, visited, run } = await app();
    run('support-1', 'support', SUPPORT_TITLE);
    await flush();
    shell?.navigate('support-agent');
    await flush();

    expect(starts).toEqual([]);
    expect(visited.at(-1)).toEqual({ screenId: 'agent-tab', params: { agentId: 'support-1' } });
    expect(agentTabLabels(root)[0]).toBe(SUPPORT_TITLE);
  });

  it('starts one support agent only, however often Support is pressed while it starts', async () => {
    const { root, starts } = await app();
    supportTab(root)?.click();
    supportTab(root)?.click();
    await flush();

    expect(starts).toHaveLength(1);
  });

  it('shows the support agent card while it starts, styled from the prototype', async () => {
    const { root } = await app();
    supportTab(root)?.click();

    const card = screenContent(root).querySelector('.support-agent .card.chat') as HTMLElement;
    expect([...card.querySelectorAll('.chat-head > span')].map((span) => text(span))).toEqual([
      'Support agent',
      '· tips, side questions and messages to other agents',
    ]);
    expect(text(card.querySelector('.chat-event'))).toBe(
      'Opening the Support tab: Grillo starts the support agent with /grillo-support.',
    );
    expect(card.querySelector('.chat-event code')?.textContent).toBe(SUPPORT_COMMAND);
    await flush();
  });

  it('asks for a project and starts nothing when the member has opened none', async () => {
    const { root, starts } = await app({ opened: false });
    await openSupport(root);

    expect(text(screenContent(root).querySelector('.note.warn'))).toBe(NO_PROJECT);
    expect(screenContent(root).querySelector('.chat-event')).toBeNull();
    expect(starts).toEqual([]);
  });

  it('shows why the agent did not start, with Try again', async () => {
    const { root, visited } = await app({ startFails: 'Claude Code is not installed.' });
    await openSupport(root);

    expect(text(screenContent(root).querySelector('.note.err'))).toBe(
      'The support agent did not start: Claude Code is not installed.',
    );
    expect(visited.some(({ screenId }) => screenId === 'agent-tab')).toBe(false);
    expect(screenContent(root).querySelector('.chat-event')).toBeNull();
    const again = [...screenContent(root).querySelectorAll('button')].find((button) => text(button) === 'Try again');
    expect(again).toBeDefined();
  });

  it('starts the agent on Try again once the cause is fixed', async () => {
    const harness = await app({ startFails: 'Claude Code is not installed.' });
    await openSupport(harness.root);
    harness.fixStart();
    const again = [...screenContent(harness.root).querySelectorAll('button')].find((button) => text(button) === 'Try again');
    again?.click();
    await flush();

    expect(harness.starts.map((start) => start.firstMessage)).toEqual([SUPPORT_COMMAND]);
    expect(harness.visited.at(-1)).toEqual({ screenId: 'agent-tab', params: { agentId: 'agent-1' } });
  });
});

describe('support agent tab: Relay waiting for Send, then Relayed', () => {
  async function withSupport(options: AppOptions = {}) {
    const harness = await app(options);
    harness.run('grilling-1', 'grilling', TARGET);
    await openSupport(harness.root);
    return harness;
  }

  it('posts the relay request into the named tab through the agent chat relay, for the member, and answers relayed:', async () => {
    const { relays, sent, says } = await withSupport();
    await says('agent-1', { type: 'assistant', text: relayRequest(TARGET, 'Please also ask about the sample edge case.') });

    expect(relays).toEqual([
      { targetAgentId: 'grilling-1', member: MEMBER, text: 'Please also ask about the sample edge case.' },
    ]);
    expect(sent).toEqual([{ id: 'agent-1', text: `relayed: ${TARGET}` }]);
  });

  it('answers every request of one message, in order, each on its own', async () => {
    const { relays, sent, says, run } = await withSupport();
    run('grilling-2', 'grilling', 'Grilling · Sample ticket 4');
    await flush();
    await says('agent-1', {
      type: 'assistant',
      text: [relayRequest(TARGET, 'Sample message one.'), relayRequest('Grilling · Sample ticket 4', 'Sample message two.')].join(
        '\n',
      ),
    });

    expect(relays.map((relay) => relay.targetAgentId)).toEqual(['grilling-1', 'grilling-2']);
    expect(sent.map((answer) => answer.text)).toEqual([`relayed: ${TARGET}`, 'relayed: Grilling · Sample ticket 4']);
  });

  it.each([
    ['an unknown tab, listing the open tabs', relayRequest('Grilling · No such ticket', 'Sample.'), `not relayed: No open agent tab is named 'Grilling · No such ticket'. Open tabs: ${TARGET}`],
    ['the support tab itself', relayRequest(SUPPORT_TITLE, 'Sample.'), 'not relayed: The target is the support tab itself; name another agent tab'],
    ['a request that writes the mark itself', relayRequest(TARGET, '[from Support, for someone] Sample.'), 'not relayed: The message writes the mark [from Support, for …] itself; Grillo adds the mark, so leave it out'],
    ['a block that is never closed', ['```grillo-relay', `to: ${TARGET}`, '', 'Sample.'].join('\n'), 'not relayed: A relay request block is not closed with ``` on a line of its own'],
  ])('posts nothing for %s and answers not relayed: with the reason', async (_case, message, answer) => {
    const { relays, sent, says } = await withSupport();
    await says('agent-1', { type: 'assistant', text: message });

    expect(relays).toEqual([]);
    expect(sent).toEqual([{ id: 'agent-1', text: answer }]);
  });

  it('answers not relayed: with the relay\'s own reason when the target cannot take the message', async () => {
    const { sent, says } = await withSupport({ relayAnswer: { ok: false, reason: "No chat agent with id 'grilling-1'" } });
    await says('agent-1', { type: 'assistant', text: relayRequest(TARGET, 'Sample.') });

    expect(sent).toEqual([{ id: 'agent-1', text: "not relayed: No chat agent with id 'grilling-1'" }]);
  });

  it('posts nothing when Grillo cannot read the member\'s GitHub login', async () => {
    const { relays, sent, says } = await withSupport({ identity: { ok: false, reason: 'signed-out' } });
    await says('agent-1', { type: 'assistant', text: relayRequest(TARGET, 'Sample.') });

    expect(relays).toEqual([]);
    expect(sent).toEqual([
      { id: 'agent-1', text: 'not relayed: Grillo could not read your GitHub login (signed-out); sign in with gh and ask again' },
    ]);
  });

  it.each([
    ['a request in another agent\'s message', 'grilling-1', { type: 'assistant', text: relayRequest(TARGET, 'Sample.') }],
    ['the member\'s own words that only look like a request', 'agent-1', { type: 'user', text: relayRequest(TARGET, 'Sample.') }],
    ['a message with no request', 'agent-1', { type: 'assistant', text: 'Sample ticket 2 is assigned to member-c.' }],
    ['a malformed message', 'agent-1', { type: 'assistant', text: null } as unknown as ChatMessage],
    ['an unknown agent', 'agent-9', { type: 'assistant', text: relayRequest(TARGET, 'Sample.') }],
  ])('ignores %s', async (_case, id, message) => {
    const { relays, sent, says } = await withSupport();
    await says(id, message as ChatMessage);

    expect(relays).toEqual([]);
    expect(sent).toEqual([]);
  });
});
