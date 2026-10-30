// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerAgentChannels } from '../../../main/features/agents/channels';
import { FakePty } from '../../../main/features/agents/fake-pty';
import { createMainIpc } from '../../../main/ipc/bridge';
import { createFakeIpc } from '../../../main/ipc/fake-ipc';
import { createGrilloApi } from '../../../preload/bridge';
import type { AgentInfo, AgentKind } from '../../../shared/agents';
import type { GrilloApi } from '../../../shared/ipc';
import { registerScreens, type ScreenModule, type ShellContext } from '../../app/screens';
import { createShell, type Shell } from '../../app/shell';
import { FakeTerminalView } from '../../components/terminal/fake-terminal-view';
import { createAgentTabs, type AgentTabs } from './agent-tabs';
import * as agentTabScreen from './index';
import { registerTabPanels, type TabPanel, type TabPanelContext } from './tab-panels';
import { terminalPanel } from './terminal-panel';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** The real agent channels over the IPC fake; Claude Code is played by fake terminals, one per agent started. */
function runtime() {
  const fake = createFakeIpc();
  const ptys: FakePty[] = [];
  registerAgentChannels(createMainIpc(fake.main, () => [fake.window]), {
    findClaude: () => '/opt/made-up/bin/claude',
    shipSkills: async () => undefined,
    spawnPty: (file, args, options) => {
      const pty = new FakePty(file, args, options);
      ptys.push(pty);
      return pty;
    },
    env: {},
  });
  const grillo = createGrilloApi(fake.renderer);
  async function startAgent(kind: AgentKind, title: string) {
    const id = await grillo.invoke('agents:start', { kind, folder: '/projects/sample-1', firstMessage: '', title });
    return { id, pty: ptys[ptys.length - 1] };
  }
  return { grillo, startAgent };
}

/** The agent-tab screen as index.ts builds it, with the given panels in place of the discovered ones. */
function screenWith(panels: TabPanel[]): ScreenModule {
  let tabs: AgentTabs | undefined;
  return {
    id: 'agent-tab',
    title: 'Agent',
    start(shell) {
      tabs = createAgentTabs(shell, registerTabPanels({}, panels));
      return () => tabs?.dispose();
    },
    mount: (el, params) => (tabs as AgentTabs).show(el, params['agentId'] ?? ''),
  };
}

/** A terminal body whose terminals are fakes the test can read and type into. */
function fakeTerminalBody() {
  const views: FakeTerminalView[] = [];
  const panel = terminalPanel(() => {
    const view = new FakeTerminalView();
    view.sizeToFit = { cols: 100, rows: 30 };
    views.push(view);
    return view;
  });
  return { panel, views };
}

let shell: Shell | undefined;
function open(screen: ScreenModule, grillo: GrilloApi): HTMLElement {
  const root = document.createElement('div');
  document.body.append(root);
  shell = createShell(root, { grillo, screens: registerScreens({ '/src/renderer/screens/agent-tab/index.ts': screen }) });
  return root;
}

const agentTab = (root: HTMLElement, id: string) => root.querySelector<HTMLElement>(`nav [data-agent-id="${id}"]`);
const content = (root: HTMLElement) => root.querySelector('main') as HTMLElement;
const typeBoxInput = (root: HTMLElement) => content(root).querySelector<HTMLInputElement>('.typebox input');

afterEach(() => {
  shell?.dispose();
  shell = undefined;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('agent tab', () => {
  it("opens an agent's tab on its terminal: output streams in, keystrokes and the fitted size go out", async () => {
    const { grillo, startAgent } = runtime();
    const { panel, views } = fakeTerminalBody();
    const root = open(screenWith([panel]), grillo);
    const { id, pty } = await startAgent('grilling', 'Grilling · Sample ticket 3');
    pty.print('Sample question 3.1\r\n');

    agentTab(root, id)?.querySelector<HTMLElement>('.tab-name')?.click();
    views[0].type('2');
    await flush();

    expect(views).toHaveLength(1);
    expect(content(root).querySelector('.agent-terminal .agent-terminal-screen')).toBe(views[0].openedIn);
    expect(views[0].text).toBe('Sample question 3.1\r\n');
    expect(pty.written).toEqual(['2']);
    expect(pty.sizes).toEqual([[100, 30]]);
    expect(views[0].focusCount).toBe(1);
    expect(root.querySelector('.titlebar .context')?.textContent).toBe('Grilling · Sample ticket 3');
  });

  it('keeps the same terminal, with the output it missed, when the member comes back to the tab', async () => {
    const { grillo, startAgent } = runtime();
    const { panel, views } = fakeTerminalBody();
    const root = open(screenWith([panel]), grillo);
    const { id, pty } = await startAgent('generic', 'Generic · Sample note');
    shell?.navigate('agent-tab', { agentId: id });

    shell?.navigate('map');
    pty.print('written while away');
    shell?.navigate('agent-tab', { agentId: id });

    expect(views).toHaveLength(1);
    expect(views[0].text).toBe('written while away');
    expect(content(root).querySelector('.agent-terminal .agent-terminal-screen')).toBe(views[0].openedIn);
  });

  it('types in the type box always: Enter or Send types the line then Enter, and setInput fills the box', async () => {
    const { grillo, startAgent } = runtime();
    const { panel } = fakeTerminalBody();
    let context: TabPanelContext | undefined;
    const controls: TabPanel = { kinds: 'all', slot: 'controls', priority: 1, mount: (_el, ctx) => void (context = ctx) };
    const root = open(screenWith([panel, controls]), grillo);
    const { id, pty } = await startAgent('grilling', 'Grilling · Sample ticket 3');
    shell?.navigate('agent-tab', { agentId: id });
    const input = typeBoxInput(root) as HTMLInputElement;

    context?.setInput('…sample live transcript words');
    expect(input.value).toBe('…sample live transcript words');
    content(root).querySelector<HTMLButtonElement>('.typebox .btn')?.click();
    await flush();
    input.value = 'Sample typed answer';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await flush();

    expect(input.placeholder).toBe('Type to the agent…');
    expect(input.getAttribute('aria-label')).toBe('Type to the agent');
    expect(input.value).toBe('');
    expect(pty.written).toEqual(['…sample live transcript words', '\r', 'Sample typed answer', '\r']);
  });

  it('mounts controls beside the body and header panels inside the tab, for the kinds they serve, highest first', async () => {
    const { grillo, startAgent } = runtime();
    const { panel } = fakeTerminalBody();
    const labelled = (text: string, overrides: Partial<TabPanel>): TabPanel => ({
      kinds: 'all',
      slot: 'controls',
      priority: 1,
      mount: (el) => void (el.textContent = text),
      ...overrides,
    });
    const root = open(
      screenWith([
        panel,
        labelled('Present', { kinds: ['grilling'], priority: 2 }),
        labelled('Recording', { kinds: ['grilling'] }),
        labelled('Channel', { slot: 'header' }),
        labelled('Host', { slot: 'header', kinds: ['grilling'], priority: 5 }),
      ]),
      grillo,
    );
    const grilling = await startAgent('grilling', 'Grilling · Sample ticket 3');
    const generic = await startAgent('generic', 'Generic · Sample note');

    expect(agentTab(root, grilling.id)?.querySelector('.tab-header')?.textContent).toBe('HostChannel');
    expect(agentTab(root, generic.id)?.querySelector('.tab-header')?.textContent).toBe('Channel');
    expect(agentTab(root, grilling.id)?.querySelector('.tab-name')?.textContent).toBe('Grilling · Sample ticket 3');

    shell?.navigate('agent-tab', { agentId: grilling.id });
    const grillingTab = content(root).querySelector('.agent-tab');
    expect(grillingTab?.classList.contains('with-controls')).toBe(true);
    expect([...(grillingTab?.querySelectorAll('.agent-tab-control') ?? [])].map((el) => el.textContent)).toEqual(['Present', 'Recording']);
    expect(grillingTab?.querySelector('.agent-tab-body .agent-terminal')).not.toBeNull();

    shell?.navigate('agent-tab', { agentId: generic.id });
    expect(content(root).querySelector('.agent-tab')?.classList.contains('with-controls')).toBe(false);
    expect(content(root).querySelector('.agent-tab-controls')).toBeNull();
  });

  it('shows a higher-priority body panel in place of the terminal, as the chat view will', async () => {
    const { grillo, startAgent } = runtime();
    const { panel, views } = fakeTerminalBody();
    const chat: TabPanel = { kinds: ['grilling'], slot: 'body', priority: 10, mount: (el) => void (el.textContent = 'Sample chat view') };
    const root = open(screenWith([panel, chat]), grillo);
    const { id } = await startAgent('grilling', 'Grilling · Sample ticket 3');

    shell?.navigate('agent-tab', { agentId: id });

    expect(content(root).querySelector('.agent-tab-body')?.textContent).toBe('Sample chat view');
    expect(views).toHaveLength(0);
  });

  it('says the agent is not running, in place of its panels, when it stops while its tab is open', async () => {
    const { grillo, startAgent } = runtime();
    const { panel } = fakeTerminalBody();
    const root = open(screenWith([panel]), grillo);
    const { id } = await startAgent('task', 'Task · Sample ticket 5');
    shell?.navigate('agent-tab', { agentId: id });

    await grillo.invoke('agents:stop', { id });

    expect(content(root).querySelector('.agent-tab')).toBeNull();
    expect(content(root).textContent).toBe('This agent is not running.');
  });

  it('says why the agent ended under "not running", when a panel can tell, and ignores a note that is not text', async () => {
    const { grillo, startAgent } = runtime();
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const body: TabPanel = { kinds: 'all', slot: 'body', priority: 1, mount: () => ({ endNote: () => 'Made-up reason it ended.' }) };
    const junk: TabPanel[] = [
      { kinds: 'all', slot: 'controls', priority: 2, mount: () => ({ endNote: () => 42 as unknown as string }) },
      { kinds: 'all', slot: 'controls', priority: 1, mount: () => ({ endNote: () => { throw new Error('made-up note failure'); } }) },
    ];
    const root = open(screenWith([body, ...junk]), grillo);
    const { id } = await startAgent('task', 'Task · Sample ticket 5');
    shell?.navigate('agent-tab', { agentId: id });

    await grillo.invoke('agents:stop', { id });

    const paragraphs = [...content(root).querySelectorAll('p')].map((p) => p.textContent);
    expect(paragraphs).toEqual(['This agent is not running.', 'Made-up reason it ended.']);
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it("takes an agent's panels down when it stops, and says so if its tab is opened after", async () => {
    const { grillo, startAgent } = runtime();
    const { panel, views } = fakeTerminalBody();
    const headerGone = vi.fn();
    const header: TabPanel = { kinds: 'all', slot: 'header', priority: 1, mount: () => ({ dispose: headerGone }) };
    const root = open(screenWith([panel, header]), grillo);
    const { id } = await startAgent('task', 'Task · Sample ticket 5');
    shell?.navigate('agent-tab', { agentId: id });

    await grillo.invoke('agents:stop', { id });
    shell?.navigate('agent-tab', { agentId: id });

    expect(views[0].disposed).toBe(true);
    expect(headerGone).toHaveBeenCalledTimes(1);
    expect(agentTab(root, id)).toBeNull();
    expect(content(root).textContent).toBe('This agent is not running.');
  });

  it('reports a panel that throws or returns junk, and the rest of the tab still works', async () => {
    const { grillo, startAgent } = runtime();
    const { panel, views } = fakeTerminalBody();
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const broken: TabPanel[] = [
      { kinds: 'all', slot: 'controls', priority: 3, mount: () => { throw new Error('made-up mount failure'); } },
      { kinds: 'all', slot: 'controls', priority: 2, mount: () => 42 as never },
      { kinds: 'all', slot: 'controls', priority: 1, mount: () => ({ shown: 'yes', dispose: null }) as never },
      { kinds: 'all', slot: 'header', priority: 1, mount: () => ({ shown: () => { throw new Error('made-up show failure'); } }) },
    ];
    const root = open(screenWith([panel, ...broken]), grillo);
    const { id, pty } = await startAgent('grilling', 'Grilling · Sample ticket 3');

    shell?.navigate('agent-tab', { agentId: id });
    pty.print('still streaming');

    expect(views[0].text).toBe('still streaming');
    expect(content(root).querySelectorAll('.agent-tab-control')).toHaveLength(3);
    expect(error).toHaveBeenCalledWith(`A tab panel of agent ${id} failed to mount; the rest of the tab still works.`, expect.any(Error));
    expect(error).toHaveBeenCalledWith(`A tab panel of agent ${id} failed to show; the rest of the tab still works.`, expect.any(Error));
  });

  it('ignores agent list entries that are not agents, and opens each agent once', () => {
    const { panel, views } = fakeTerminalBody();
    let tell: (agents: readonly AgentInfo[]) => void = () => undefined;
    const shellContext: ShellContext = {
      grillo: runtime().grillo,
      navigate: () => undefined,
      agentTabHeader: () => undefined,
      onAgentTabs: (listener) => {
        tell = listener;
        return () => undefined;
      },
      showProject: () => undefined,
    };
    const tabs = createAgentTabs(shellContext, registerTabPanels({}, [panel]));
    const good: AgentInfo = { id: 'a1', kind: 'grilling', title: 'Grilling · Sample ticket 1', folder: '/projects/sample-1', waiting: false };

    tell([null, 'a1', 42, {}, { id: '', kind: 'grilling' }, { id: 'a2', kind: 'wizard' }, { id: 7, kind: 'task' }, good, good] as never);

    expect(views).toHaveLength(1);
    const el = document.createElement('div');
    tabs.show(el, 'a2');
    expect(el.textContent).toBe('This agent is not running.');
    tabs.dispose();
    expect(views[0].disposed).toBe(true);
  });

  it('is the screen the shell opens for an agent, with the real terminal and the discovered panels', async () => {
    const { grillo, startAgent } = runtime();
    const root = open(agentTabScreen, grillo);
    const { id, pty } = await startAgent('grilling', 'Grilling · Sample ticket 3');
    pty.print('Sample output');

    agentTab(root, id)?.querySelector<HTMLElement>('.tab-name')?.click();

    expect(content(root).querySelector('.agent-tab-body .agent-terminal-screen .xterm')).not.toBeNull();
    expect(typeBoxInput(root)).not.toBeNull();
    // The fixture tab-panel.ts (src/renderer/app/__fixtures__/screens/fixture-panels/) is found by discovery.
    expect(agentTab(root, id)?.querySelector('.tab-header')?.textContent).toBe('Fixture header');
    expect(content(root).querySelector('.agent-tab-control')?.textContent).toBe('Fixture controls');
  });
});
