// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { registerStoreIpc } from '../../../main/features/store/ipc';
import { createMainIpc } from '../../../main/ipc/bridge';
import { createFakeIpc } from '../../../main/ipc/fake-ipc';
import { createMemoryStore } from '../../../main/store/memory';
import { createMemorySettings } from '../../../main/store/memory/settings';
import { createGrilloApi } from '../../../preload/bridge';
import type { AgentInfo, StartAgentRequest } from '../../../shared/agents';
import { registerScreens, type ScreenModule } from '../../app/screens';
import { createShell, type Shell } from '../../app/shell';
import * as genericAgentScreen from './index';
import { GENERIC_COMMAND, HELP_TEXT, NO_PROJECT } from './generic-agent';

// Made-up projects and tab names only.
const PROJECT = 'example-org/sample-project-1';
const OTHER_PROJECT = 'example-org/sample-project-2';
const folderOf = (project: string) => `/memory/Grillo/${project}`;

const flush = async () => {
  for (let i = 0; i < 4; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

let shell: Shell | undefined;

afterEach(() => {
  shell?.dispose();
  shell = undefined;
  document.body.replaceChildren();
});

/**
 * The app as it runs, in process: the in-memory store behind the real store IPC, a stand-in agent runtime that only
 * records what is started, and the shell with this screen registered as discovery would.
 */
async function app(options: { opened?: boolean; startFails?: string } = {}) {
  const fake = createFakeIpc();
  const ipc = createMainIpc(fake.main, () => [fake.window]);
  const store = createMemoryStore({ now: () => new Date('2026-10-22T10:00:00.000Z') });
  registerStoreIpc(ipc, store, createMemorySettings());

  let running: AgentInfo[] = [];
  const starts: StartAgentRequest[] = [];
  ipc.handle('agents:list', () => running);
  ipc.handle('agents:start', (request) => {
    if (options.startFails) throw new Error(options.startFails);
    starts.push(request);
    const id = `agent-${starts.length}`;
    running = [...running, { id, kind: request.kind, title: request.title, folder: request.folder, waiting: false }];
    ipc.send('agents:list-changed', running);
    return id;
  });

  for (const name of ['sample-project-1', 'sample-project-2']) {
    await store.createProject({ newRepository: { organisation: 'example-org', name } });
  }
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
      '/src/renderer/screens/generic-agent/index.ts': genericAgentScreen,
      '/src/renderer/screens/map/index.ts': recorder('map'),
      '/src/renderer/screens/project-creation/index.ts': recorder('project-creation'),
      '/src/renderer/screens/agent-tab/index.ts': recorder('agent-tab'),
    }),
  });
  return {
    starts,
    visited,
    dialog: () => root.querySelector('main [role="dialog"]') as HTMLElement,
    async pressPlus() {
      (root.querySelector('nav .add') as HTMLButtonElement).click();
      await flush();
    },
  };
}

const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
const buttonNamed = (scope: Element, label: string) => {
  const found = [...scope.querySelectorAll<HTMLButtonElement>('button')].find((candidate) => text(candidate) === label);
  if (!found) throw new Error(`No button '${label}' in: ${scope.textContent}`);
  return found;
};
const nameField = (dialog: HTMLElement) => dialog.querySelector('label.field input') as HTMLInputElement;
function typeName(dialog: HTMLElement, name: string): void {
  const input = nameField(dialog);
  input.value = name;
  input.dispatchEvent(new Event('input'));
}
async function click(button: HTMLButtonElement): Promise<void> {
  button.click();
  await flush();
}

describe('generic agent tab: registration', () => {
  it('registers under the id the shell\'s "+" opens, through screen discovery', () => {
    const registry = registerScreens({ '/src/renderer/screens/generic-agent/index.ts': genericAgentScreen });
    expect(registry.get('generic-agent')?.title).toBe('Generic agent');
  });
});

describe('generic agent tab: Naming the new tab', () => {
  it('opens from "+" as the naming dialog, with Open agent locked until the tab has a name', async () => {
    const { dialog, pressPlus } = await app();
    await pressPlus();

    const naming = dialog();
    expect(naming.getAttribute('aria-label')).toBe('Name the new tab');
    expect(naming.classList.contains('glass-strong')).toBe(true);
    expect(text(naming.querySelector('h4'))).toBe('New generic agent');
    expect(text(naming.querySelector('label.field'))).toBe('Tab name');
    expect(text(naming.querySelector('p.small.muted'))).toBe(HELP_TEXT);
    expect(buttonNamed(naming, 'Cancel').disabled).toBe(false);
    expect(buttonNamed(naming, 'Open agent').classList.contains('primary')).toBe(true);
    expect(buttonNamed(naming, 'Open agent').disabled).toBe(true);

    for (const [name, locked] of [['   ', true], ['Sample customer email', false], ['', true]] as const) {
      typeName(naming, name);
      expect(buttonNamed(naming, 'Open agent').disabled, `'${name}'`).toBe(locked);
    }
  });

  it('starts a generic agent in the project folder with /grillo-generic, in a tab of that name, and opens its tab', async () => {
    const { dialog, starts, visited, pressPlus } = await app();
    await pressPlus();
    typeName(dialog(), '  Sample customer email ');
    await click(buttonNamed(dialog(), 'Open agent'));

    expect(GENERIC_COMMAND).toBe('/grillo-generic');
    expect(starts).toEqual([
      { kind: 'generic', folder: folderOf(PROJECT), firstMessage: GENERIC_COMMAND, title: 'Generic · Sample customer email' },
    ]);
    expect(visited.at(-1)).toEqual({ screenId: 'agent-tab', params: { agentId: 'agent-1' } });
  });

  it('opens the agent on Enter in the tab name field, but not while the name is blank', async () => {
    const { dialog, starts, pressPlus } = await app();
    await pressPlus();
    const pressEnter = async () => {
      nameField(dialog()).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await flush();
    };

    await pressEnter();
    expect(starts).toEqual([]);

    typeName(dialog(), 'Sample hallway note');
    await pressEnter();
    expect(starts.map((start) => start.title)).toEqual(['Generic · Sample hallway note']);
  });

  it('starts the agent in the project the screen was opened with', async () => {
    const { dialog, starts } = await app();
    shell?.navigate('generic-agent', { project: OTHER_PROJECT });
    await flush();
    typeName(dialog(), 'Sample note');
    await click(buttonNamed(dialog(), 'Open agent'));

    expect(starts.map((start) => start.folder)).toEqual([folderOf(OTHER_PROJECT)]);
  });

  it('asks for a project, with Open agent locked, when the member has opened none', async () => {
    const { dialog, starts, pressPlus } = await app({ opened: false });
    await pressPlus();
    typeName(dialog(), 'Sample customer email');

    expect(text(dialog().querySelector('.note.warn'))).toBe(NO_PROJECT);
    expect(buttonNamed(dialog(), 'Open agent').disabled).toBe(true);
    expect(starts).toEqual([]);
  });

  it('shows why the agent did not start, keeps the name and lets the member try again', async () => {
    const { dialog, visited, pressPlus } = await app({ startFails: 'Claude Code is not installed.' });
    await pressPlus();
    typeName(dialog(), 'Sample customer email');
    await click(buttonNamed(dialog(), 'Open agent'));

    expect(text(dialog().querySelector('.note.err'))).toContain('Claude Code is not installed.');
    expect(nameField(dialog()).value).toBe('Sample customer email');
    expect(buttonNamed(dialog(), 'Open agent').disabled).toBe(false);
    expect(visited.some(({ screenId }) => screenId === 'agent-tab')).toBe(false);
  });

  it('goes back to the map of the project on Cancel, and to the project screen when none is open', async () => {
    for (const [opened, expected] of [
      [true, { screenId: 'map', params: { project: PROJECT } }],
      [false, { screenId: 'project-creation', params: {} }],
    ] as const) {
      const { dialog, starts, visited, pressPlus } = await app({ opened });
      await pressPlus();
      await click(buttonNamed(dialog(), 'Cancel'));

      expect(visited.at(-1)).toEqual(expected);
      expect(starts).toEqual([]);
      shell?.dispose();
      shell = undefined;
      document.body.replaceChildren();
    }
  });
});
