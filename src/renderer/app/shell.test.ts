// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { AgentInfo } from '../../shared/agents';
import type { EventChannel, EventPayload, GrilloApi } from '../../shared/ipc';
import { createShell, type Shell } from './shell';
import { loadScreens, registerScreens, type ScreenModule, type ScreenRegistry, type ShellContext } from './screens';

function agent(id: string, title: string, waiting = false): AgentInfo {
  return { id, kind: 'grilling', title, folder: '/projects/sample-1', waiting };
}

/** A stand-in for `window.grillo`: `agents:list` answers with `listAnswer`; `emit` plays an event from main. */
function fakeGrillo(listAnswer: Promise<AgentInfo[]> = Promise.resolve([])) {
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const grillo = {
    invoke: vi.fn((channel: string) => (channel === 'agents:list' ? listAnswer : Promise.resolve(undefined))),
    on: vi.fn((channel: string, listener: (payload: unknown) => void) => {
      const set = listeners.get(channel) ?? new Set();
      set.add(listener);
      listeners.set(channel, set);
      return () => set.delete(listener);
    }),
  } as unknown as GrilloApi;
  function emit<C extends EventChannel>(channel: C, payload: EventPayload<C>): void {
    listeners.get(channel)?.forEach((listener) => listener(payload));
  }
  return { grillo, emit, listenerCount: (channel: string) => listeners.get(channel)?.size ?? 0 };
}

function screen(id: string, title: string): ScreenModule & { mount: Mock<ScreenModule['mount']> } {
  return { id, title, mount: vi.fn<ScreenModule['mount']>() };
}

function registry(...screens: ScreenModule[]): ScreenRegistry {
  return registerScreens(Object.fromEntries(screens.map((s) => [`/src/renderer/screens/${s.id}/index.ts`, s])));
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

let shell: Shell | undefined;
function start(screens: ScreenRegistry, grillo: GrilloApi): HTMLElement {
  const root = document.createElement('div');
  document.body.append(root);
  shell = createShell(root, { grillo, screens });
  return root;
}

const tabLabels = (root: HTMLElement) =>
  [...root.querySelectorAll('nav .tab')].map((tab) => tab.querySelector('.tab-name')?.textContent ?? tab.textContent);
const activeTab = (root: HTMLElement) => root.querySelector('nav [aria-current="page"]')?.textContent;
const content = (root: HTMLElement) => root.querySelector('main') as HTMLElement;
const titlebarContext = (root: HTMLElement) => root.querySelector('.titlebar .context')?.textContent;
const agentTab = (root: HTMLElement, id: string) => root.querySelector<HTMLElement>(`[data-agent-id="${id}"]`);

/** The stylesheets the shell runs under in the app: the tokens, the glass components and its own. */
const SHELL_STYLESHEETS = ['../theme/tokens.css', '../theme/glass.css', 'shell.css'].map((sheet) => resolve(__dirname, sheet));
function useRealStylesheets(): void {
  for (const sheet of SHELL_STYLESHEETS) {
    const style = document.createElement('style');
    style.textContent = readFileSync(sheet, 'utf8');
    document.head.append(style);
  }
}

afterEach(() => {
  shell?.dispose();
  shell = undefined;
  document.body.replaceChildren();
  document.head.replaceChildren();
});

describe('app shell', () => {
  it('shows the fixed navigation in the prototype order and opens Setup first', () => {
    const root = start(registry(), fakeGrillo().grillo);

    expect(tabLabels(root)).toEqual(['Setup', 'Project', 'Map', 'Tickets', 'PRD', '+']);
    expect(root.querySelector('.window')?.classList.contains('glass')).toBe(true);
    expect(activeTab(root)).toBe('Setup');
    expect(titlebarContext(root)).toBe('Setup');
    expect(content(root).textContent).toContain('Setup is not built yet.');
  });

  it('shows the Grillo logo before the name in the title bar', () => {
    const root = start(registry(), fakeGrillo().grillo);

    const logo = root.querySelector<HTMLImageElement>('.titlebar img.logo');
    expect(logo?.getAttribute('src')).toMatch(/grillo-logo.*\.png$|^data:image\/png/);
    expect(logo?.alt).toBe('');
    expect(logo?.nextElementSibling?.textContent).toBe('Grillo');
  });

  it('opens the registered screen of a fixed tab and closes the screen it leaves', () => {
    const setup = screen('setup-check', 'Setup check');
    const cleanup = vi.fn();
    setup.mount.mockReturnValue(cleanup);
    const map = screen('map', 'The map');
    const root = start(registry(setup, map), fakeGrillo().grillo);

    (root.querySelector('nav') as HTMLElement).querySelectorAll<HTMLElement>('.tab')[2].click();

    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(map.mount).toHaveBeenCalledTimes(1);
    const [el, params, context] = map.mount.mock.calls[0];
    expect(content(root).contains(el)).toBe(true);
    expect(params).toEqual({});
    expect(typeof context.navigate).toBe('function');
    expect(activeTab(root)).toBe('Map');
    expect(titlebarContext(root)).toBe('The map');
  });

  it('opens a screen found by discovery, with its params, without the shell naming it', () => {
    const root = start(loadScreens(), fakeGrillo().grillo);

    shell?.navigate('fixture-hello', { name: 'Ada' });

    expect(content(root).textContent).toBe('Hello Ada');
    expect(titlebarContext(root)).toBe('Fixture hello');
    expect(activeTab(root)).toBeUndefined();
  });

  it("shows one tab per running agent with its name, the waiting dot and a header mount point that survives updates", async () => {
    const { grillo, emit } = fakeGrillo(Promise.resolve([agent('a1', 'Grilling · Map', true), agent('a2', 'Task · Sample ticket 3')]));
    const root = start(registry(), grillo);
    await flush();

    expect(tabLabels(root)).toEqual(['Setup', 'Project', 'Map', 'Tickets', 'PRD', 'Grilling · Map', 'Task · Sample ticket 3', '+']);
    expect(agentTab(root, 'a1')?.querySelector('.dot')?.hasAttribute('hidden')).toBe(false);
    expect(agentTab(root, 'a2')?.querySelector('.dot')?.hasAttribute('hidden')).toBe(true);
    const header = shell?.agentTabHeader('a1');
    expect(header && agentTab(root, 'a1')?.contains(header)).toBe(true);
    header?.append(document.createTextNode('Channel'));

    emit('agents:list-changed', [agent('a3', 'Generic · Sample note'), agent('a1', 'Grilling · Sample ticket 4', false)]);

    expect(tabLabels(root)).toEqual(['Setup', 'Project', 'Map', 'Tickets', 'PRD', 'Generic · Sample note', 'Grilling · Sample ticket 4', '+']);
    expect(agentTab(root, 'a2')).toBeNull();
    expect(shell?.agentTabHeader('a2')).toBeUndefined();
    expect(shell?.agentTabHeader('a1')).toBe(header);
    expect(header?.textContent).toBe('Channel');
    expect(agentTab(root, 'a1')?.querySelector('.dot')?.hasAttribute('hidden')).toBe(true);
  });

  it("opens an agent's tab on the agent-tab screen with its id", async () => {
    const agentScreen = screen('agent-tab', 'Agent');
    const { grillo, emit } = fakeGrillo(Promise.resolve([agent('a1', 'Grilling · Map')]));
    const root = start(registry(agentScreen), grillo);
    await flush();

    agentTab(root, 'a1')?.querySelector<HTMLElement>('.tab-name')?.click();

    expect(agentScreen.mount.mock.calls[0][1]).toEqual({ agentId: 'a1' });
    expect(agentTab(root, 'a1')?.classList.contains('active')).toBe(true);
    expect(titlebarContext(root)).toBe('Grilling · Map');

    emit('agents:list-changed', [agent('a1', 'Grilling · Sample ticket 4')]);

    expect(titlebarContext(root)).toBe('Grilling · Sample ticket 4');
  });

  it('opens the screen registered as generic-agent from "+"', () => {
    const generic = screen('generic-agent', 'Generic agent');
    const root = start(registry(generic), fakeGrillo().grillo);
    const add = root.querySelector<HTMLButtonElement>('nav .add');

    add?.click();

    expect(add?.getAttribute('aria-label')).toBe('Open a generic agent');
    expect(generic.mount).toHaveBeenCalledTimes(1);
    expect(add?.getAttribute('aria-pressed')).toBe('true');
  });

  describe('the current project', () => {
    const PROJECT_A = 'example-org/sample-project-1';
    const PROJECT_B = 'example-org/sample-project-2';
    const titlebarProject = (root: HTMLElement) => {
      const label = root.querySelector<HTMLElement>('.titlebar .project');
      return label && !label.hidden ? label.textContent : undefined;
    };
    const click = (root: HTMLElement, label: string) =>
      [...root.querySelectorAll<HTMLElement>('nav .tab')].find((tab) => tab.textContent === label)?.click();
    const lastParams = (module: { mount: Mock<ScreenModule['mount']> }) => module.mount.mock.calls.at(-1)?.[1];

    function projectScreens(...extra: ScreenModule[]) {
      const screens = {
        map: screen('map', 'Map'),
        tickets: screen('tickets', 'Tickets'),
        prd: screen('prd', 'PRD'),
        generic: screen('generic-agent', 'Generic agent'),
        project: screen('project-creation', 'Project creation and invites'),
        setup: screen('setup-check', 'Setup check'),
      };
      return { ...screens, registry: registry(...Object.values(screens), ...extra) };
    }

    it('opens the Map, Tickets and PRD tabs and "+" on the project the member opened, and follows a switch of project', () => {
      const screens = projectScreens();
      const root = start(screens.registry, fakeGrillo().grillo);

      shell?.navigate('map', { project: PROJECT_A });
      click(root, 'PRD');
      expect(lastParams(screens.prd)).toEqual({ project: PROJECT_A });
      click(root, 'Tickets');
      expect(lastParams(screens.tickets)).toEqual({ project: PROJECT_A });
      root.querySelector<HTMLElement>('nav .add')?.click();
      expect(lastParams(screens.generic)).toEqual({ project: PROJECT_A });

      shell?.navigate('tickets', { project: PROJECT_B, ticket: '4' });
      click(root, 'Map');
      expect(lastParams(screens.map)).toEqual({ project: PROJECT_B });
      click(root, 'PRD');
      expect(lastParams(screens.prd)).toEqual({ project: PROJECT_B });
    });

    it('names the current project in the title bar on its screens, never on Setup or the project list', () => {
      const screens = projectScreens();
      const root = start(screens.registry, fakeGrillo().grillo);
      expect(titlebarProject(root)).toBeUndefined();

      shell?.navigate('map', { project: PROJECT_A });
      expect(titlebarContext(root)).toBe('Map');
      expect(titlebarProject(root)).toBe(PROJECT_A);

      click(root, 'Project');
      expect(lastParams(screens.project)).toEqual({});
      expect(titlebarProject(root)).toBeUndefined();
      click(root, 'Setup');
      expect(titlebarProject(root)).toBeUndefined();
      click(root, 'PRD');
      expect(titlebarProject(root)).toBe(PROJECT_A);
    });

    it("follows the project a screen says it shows, such as a meeting agent's tab", () => {
      const meeting = screen('agent-tab', 'Agent');
      meeting.mount.mockImplementation((_el, _params, context) => context.showProject(PROJECT_B));
      const screens = projectScreens(meeting);
      const root = start(screens.registry, fakeGrillo().grillo);

      shell?.navigate('map', { project: PROJECT_A });
      shell?.navigate('agent-tab', { agentId: 'a1' });
      expect(titlebarProject(root)).toBe(PROJECT_B);

      click(root, 'Map');
      expect(lastParams(screens.map)).toEqual({ project: PROJECT_B });
    });

    it("names no project on an agent's tab that does not say which project it belongs to", async () => {
      const agentScreen = screen('agent-tab', 'Agent');
      const screens = projectScreens(agentScreen);
      const { grillo } = fakeGrillo(Promise.resolve([agent('a1', 'Generic · Sample notes')]));
      const root = start(screens.registry, grillo);
      await flush();

      shell?.navigate('map', { project: PROJECT_A });
      shell?.navigate('map', { project: PROJECT_B });
      agentTab(root, 'a1')?.querySelector<HTMLElement>('.tab-name')?.click();

      expect(titlebarContext(root)).toBe('Generic · Sample notes');
      expect(titlebarProject(root)).toBeUndefined();
      click(root, 'Map');
      expect(titlebarProject(root)).toBe(PROJECT_B);
    });

    it('opens the project tabs with no project before the member has opened one, and ignores a malformed one', () => {
      const screens = projectScreens();
      const root = start(screens.registry, fakeGrillo().grillo);

      shell?.navigate('map', { project: 'not a project id' });
      click(root, 'PRD');

      expect(lastParams(screens.prd)).toEqual({});
      expect(titlebarProject(root)).toBeUndefined();
    });
  });

  it.each([
    ['"+"', 'nav .add', 'The generic agent tab'],
    ['an agent tab', '[data-agent-id] .tab-name', 'The agent tab'],
  ])('names the screen %s opens while its story has not registered it', async (_case, selector, name) => {
    const root = start(registry(), fakeGrillo(Promise.resolve([agent('a1', 'Grilling · Map')])).grillo);
    await flush();

    root.querySelector<HTMLElement>(selector)?.click();

    expect(content(root).textContent).toBe(`${name} is not built yet.`);
  });

  it('keeps a newer agent list over an older answer that arrives late, and an empty strip when the list fails', async () => {
    let answer: (agents: AgentInfo[]) => void = () => undefined;
    const late = fakeGrillo(new Promise((resolve) => (answer = resolve)));
    const root = start(registry(), late.grillo);

    late.emit('agents:list-changed', [agent('new', 'Research · Sample ticket 2')]);
    answer([agent('old', 'Grilling · Map')]);
    await flush();

    expect(agentTab(root, 'new')).not.toBeNull();
    expect(agentTab(root, 'old')).toBeNull();

    shell?.dispose();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const failing = start(registry(), fakeGrillo(Promise.reject(new Error('no runtime'))).grillo);
    await flush();
    expect(failing.querySelectorAll('[data-agent-id]')).toHaveLength(0);
    expect(warn).toHaveBeenCalledWith('Grillo could not read the agent list; the agent tabs stay empty.', expect.any(Error));
    warn.mockRestore();
  });

  it("runs each screen's start once when the shell starts, with the shell context, and its cleanup on dispose", () => {
    const stop = vi.fn();
    const decorator = { ...screen('decorator', 'Decorator'), start: vi.fn<NonNullable<ScreenModule['start']>>(() => stop) };
    start(registry(decorator, screen('plain', 'Plain')), fakeGrillo().grillo);

    expect(decorator.start).toHaveBeenCalledTimes(1);
    expect(typeof decorator.start.mock.calls[0][0].onAgentTabs).toBe('function');
    expect(stop).not.toHaveBeenCalled();

    shell?.dispose();
    shell = undefined;

    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('tells agent-tab listeners the current tabs at once and after every change, once each tab header exists', async () => {
    const { grillo, emit } = fakeGrillo(Promise.resolve([agent('a1', 'Grilling · Map')]));
    const seen: Array<{ ids: string[]; headers: boolean[] }> = [];
    const watcher = {
      ...screen('watcher', 'Watcher'),
      start(context: ShellContext) {
        context.onAgentTabs((list) =>
          seen.push({ ids: list.map(({ id }) => id), headers: list.map(({ id }) => context.agentTabHeader(id) !== undefined) }),
        );
      },
    };
    const warn = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const failing = {
      ...screen('failing', 'Failing'),
      start(context: ShellContext) {
        context.onAgentTabs((list) => {
          if (list.length > 0) throw new Error('made-up listener failure');
        });
      },
    };
    const root = start(registry(failing, watcher), grillo);
    await flush();
    emit('agents:list-changed', [agent('a2', 'Task · Sample ticket 5')]);

    expect(seen).toEqual([
      { ids: [], headers: [] },
      { ids: ['a1'], headers: [true] },
      { ids: ['a2'], headers: [true] },
    ]);
    expect(agentTab(root, 'a2')).not.toBeNull();
    expect(warn).toHaveBeenCalledWith('An agent-tab listener failed; the other listeners still ran.', expect.any(Error));
    warn.mockRestore();
  });

  it('stops listening for agent changes when disposed', () => {
    const fake = fakeGrillo();
    start(registry(), fake.grillo);

    shell?.dispose();
    shell = undefined;

    expect(fake.listenerCount('agents:list-changed')).toBe(0);
  });

  it("makes Grillo's title bar the window's drag area, while anything clickable in it stays clickable", () => {
    useRealStylesheets();
    const root = start(registry(), fakeGrillo().grillo);
    const titlebar = root.querySelector<HTMLElement>('.titlebar') as HTMLElement;
    const link = document.createElement('a');
    link.href = '#sample';
    titlebar.append(document.createElement('button'), link);
    const region = (el: Element) => getComputedStyle(el).getPropertyValue('app-region');

    expect(region(titlebar)).toBe('drag');
    expect([...titlebar.querySelectorAll('button, a')].map(region)).toEqual(['no-drag', 'no-drag']);
  });

  it('fills the whole window with the glass panel: no gap and no rounded corners around it', () => {
    useRealStylesheets();
    const root = start(registry(), fakeGrillo().grillo);
    const frame = getComputedStyle(root.querySelector('.shell') as HTMLElement);
    const panel = getComputedStyle(root.querySelector('.window') as HTMLElement);

    // An unset length reads as an empty string here; both mean no gap.
    const pixels = (value: string) => Number.parseFloat(value) || 0;

    expect([frame.paddingTop, frame.paddingRight, frame.paddingBottom, frame.paddingLeft].map(pixels)).toEqual([0, 0, 0, 0]);
    expect(pixels(panel.borderTopLeftRadius)).toBe(0);
  });
});

describe('app shell: a save that became a pull request', () => {
  const NOTICE = { project: 'example-org/sample-project-1', url: 'https://github.com/example-org/sample-project-1/pull/3', title: 'grillo: add member member-b' };
  const notes = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>('.save-notices .note')];

  it('names the pull request above the open screen, links to it, and Dismiss takes the note away', () => {
    const fake = fakeGrillo();
    const root = start(registry(screen('setup-check', 'Setup')), fake.grillo);

    fake.emit('store:pull-request', NOTICE);
    fake.emit('store:pull-request', NOTICE);

    expect(notes(root).map((note) => note.querySelector('.grow')?.textContent)).toEqual([
      'Saved as pull request #3, "grillo: add member member-b". The main branch of example-org/sample-project-1 is protected, so the change reaches the project once someone merges that pull request.',
    ]);
    expect(notes(root)[0].getAttribute('role')).toBe('status');
    expect(root.querySelector('.save-notices')?.nextElementSibling).toBe(content(root));
    const link = notes(root)[0].querySelector('a') as HTMLAnchorElement;
    expect([link.textContent, link.getAttribute('href'), link.target]).toEqual(['Open on GitHub', NOTICE.url, '_blank']);

    (notes(root)[0].querySelector('button') as HTMLButtonElement).click();

    expect(notes(root)).toEqual([]);
  });

  it('keeps a dismissed note away when later saves join the same pull request, and still tells a new one', () => {
    const fake = fakeGrillo();
    const root = start(registry(), fake.grillo);
    fake.emit('store:pull-request', NOTICE);
    (notes(root)[0].querySelector('button') as HTMLButtonElement).click();

    fake.emit('store:pull-request', NOTICE);
    fake.emit('store:pull-request', { ...NOTICE, url: 'https://github.com/example-org/sample-project-1/pull/4', title: 'grillo: add source S2' });

    expect(notes(root).map((note) => note.querySelector('a')?.getAttribute('href'))).toEqual(['https://github.com/example-org/sample-project-1/pull/4']);
  });

  it('ignores a notice that is not one, or whose address is not a web address', () => {
    const fake = fakeGrillo();
    const root = start(registry(), fake.grillo);

    for (const payload of [null, { ...NOTICE, title: 7 }, { ...NOTICE, url: 'file:///etc/hosts' }]) {
      fake.emit('store:pull-request', payload as never);
    }

    expect(notes(root)).toEqual([]);
  });

  it('stops listening for saves when disposed', () => {
    const fake = fakeGrillo();
    start(registry(), fake.grillo);

    shell?.dispose();
    shell = undefined;

    expect(fake.listenerCount('store:pull-request')).toBe(0);
  });
});
