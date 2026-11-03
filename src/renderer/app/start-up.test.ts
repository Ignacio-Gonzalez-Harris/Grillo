// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { AgentInfo } from '../../shared/agents';
import type { GrilloApi } from '../../shared/ipc';
import type { IdentityResult, ToolStatus, ToolsReport } from '../../shared/tools';
import * as setupCheck from '../screens/setup-check/index';
import { registerScreens, type ScreenModule, type ScreenRegistry } from './screens';
import { createShell, type Shell } from './shell';

const SETUP_FINISHED = 'setupFinished';

const ready: ToolStatus = { installed: true, signedIn: true, version: '1.0.0', guidance: null };
const missing: ToolStatus = {
  installed: false,
  signedIn: false,
  version: null,
  guidance: { action: 'install', url: 'https://example.com/install' },
};
const signedOut: ToolStatus = {
  installed: true,
  signedIn: false,
  version: '1.0.0',
  guidance: { action: 'sign-in', command: 'sample sign-in' },
};
const ALL_GREEN: ToolsReport = { claude: ready, gh: ready };
const MEMBER: IdentityResult = { ok: true, identity: { login: 'member-a', name: 'Ana Example', email: 'member-a@example.com' } };

type Handler = (payload: unknown) => unknown;

/** A stand-in for `window.grillo` whose settings outlive a restart, so one fake can play several starts of Grillo. */
function fakeGrillo(stored: Record<string, unknown>, overrides: Record<string, Handler> = {}) {
  const handlers: Record<string, Handler> = {
    'agents:list': () => [] satisfies AgentInfo[],
    'settings:get': (payload) => {
      const { key, defaultValue } = payload as { key: string; defaultValue: unknown };
      return Object.hasOwn(stored, key) ? stored[key] : defaultValue;
    },
    'settings:set': (payload) => {
      const { key, value } = payload as { key: string; value: unknown };
      stored[key] = value;
    },
    'tools:check': () => ALL_GREEN,
    'tools:identity': () => MEMBER,
    'updates:get-state': () => ({ currentVersion: '1.0.0', phase: 'none', version: null, percent: null, autoUpdate: false, manualInstall: false }),
    'transcription:get-model-updates': () => 'ask',
    ...overrides,
  };
  const invoke = vi.fn(async (channel: string, payload: unknown) => {
    const handler = handlers[channel];
    if (!handler) throw new Error(`No fake for ${channel}`);
    return handler(payload);
  });
  const grillo = { invoke, on: vi.fn(() => () => undefined) } as unknown as GrilloApi;
  return { grillo, calls: (channel: string) => invoke.mock.calls.filter(([name]) => name === channel) };
}

/** A promise the test settles by hand, for an answer that must stay pending. */
function deferred<T>() {
  let settle!: (value: T) => void;
  const promise = new Promise<T>((done) => (settle = done));
  return { promise, resolve: settle };
}

const flush = async () => {
  for (let i = 0; i < 5; i += 1) await new Promise((done) => setTimeout(done, 0));
};

function screen(id: string): ScreenModule & { mount: Mock<ScreenModule['mount']> } {
  return { id, title: id, mount: vi.fn<ScreenModule['mount']>() };
}

function registry(...modules: ScreenModule[]): ScreenRegistry {
  return registerScreens(Object.fromEntries(modules.map((module) => [`/src/renderer/screens/${module.id}/index.ts`, module])));
}

function screens() {
  const setup = screen('setup-check');
  const project = screen('project-creation');
  const map = screen('map');
  return { setup, project, map, registry: registry(setup, project, map) };
}

const shells: Shell[] = [];
/** A fresh shell is a fresh start of Grillo. */
function startGrillo(modules: ScreenRegistry, grillo: GrilloApi): HTMLElement {
  const root = document.createElement('div');
  document.body.append(root);
  shells.push(createShell(root, { grillo, screens: modules }));
  return root;
}

const activeTab = (root: HTMLElement) => root.querySelector('nav [aria-current="page"]')?.textContent;
const tab = (root: HTMLElement, label: string) =>
  [...root.querySelectorAll<HTMLElement>('nav .tab')].find((candidate) => candidate.textContent === label) as HTMLElement;
const checkingNote = (root: HTMLElement) => root.querySelector('main [role="status"]');

afterEach(() => {
  shells.splice(0).forEach((shell) => shell.dispose());
  document.body.replaceChildren();
  document.head.replaceChildren();
  vi.restoreAllMocks();
});

describe('which screen Grillo opens on', () => {
  it.each<[string, Record<string, unknown>, Record<string, Handler>]>([
    ['the setting is absent', {}, {}],
    ['the setting cannot be read', {}, { 'settings:get': () => Promise.reject(new Error('made-up read failure')) }],
    ['the setting holds text', { [SETUP_FINISHED]: 'true' }, {}],
    ['the setting holds a number', { [SETUP_FINISHED]: 1 }, {}],
    ['the setting holds false', { [SETUP_FINISHED]: false }, {}],
    ['the setting holds nothing', { [SETUP_FINISHED]: null }, {}],
    ['the setting holds an object', { [SETUP_FINISHED]: { finished: true } }, {}],
  ])('opens Setup as a first launch, with no start-up check, when %s', async (_case, stored, overrides) => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const modules = screens();
    const fake = fakeGrillo(stored, overrides);
    const root = startGrillo(modules.registry, fake.grillo);
    await flush();

    expect(modules.setup.mount).toHaveBeenCalledTimes(1);
    expect(modules.project.mount).not.toHaveBeenCalled();
    expect(activeTab(root)).toBe('Setup');
    expect(checkingNote(root)).toBeNull();
    expect(fake.calls('tools:check')).toEqual([]);
  });

  it('shows no screen and no checking note while the setting is being read', async () => {
    const answer = deferred<unknown>();
    const modules = screens();
    const root = startGrillo(modules.registry, fakeGrillo({}, { 'settings:get': () => answer.promise }).grillo);
    await flush();

    expect(modules.setup.mount).not.toHaveBeenCalled();
    expect(checkingNote(root)).toBeNull();
    expect(activeTab(root)).toBeUndefined();
  });

  it('opens Project on a later start when every check passes, showing a checking note and never Setup meanwhile', async () => {
    const check = deferred<ToolsReport>();
    const modules = screens();
    const fake = fakeGrillo({ [SETUP_FINISHED]: true }, { 'tools:check': () => check.promise });
    const root = startGrillo(modules.registry, fake.grillo);
    await flush();

    expect(checkingNote(root)?.textContent).toBe('Checking your setup…');
    expect(checkingNote(root)?.classList.contains('card')).toBe(true);
    expect(activeTab(root)).toBeUndefined();
    expect(root.querySelector('.titlebar .context')?.textContent).toBe('');
    expect(modules.setup.mount).not.toHaveBeenCalled();
    expect(modules.project.mount).not.toHaveBeenCalled();

    check.resolve(ALL_GREEN);
    await flush();

    expect(modules.project.mount).toHaveBeenCalledTimes(1);
    expect(modules.setup.mount).not.toHaveBeenCalled();
    expect(activeTab(root)).toBe('Project');
    expect(checkingNote(root)).toBeNull();
    expect(fake.calls('tools:check').map(([, payload]) => payload)).toEqual([{ force: false }]);
    expect(fake.calls('tools:identity')).toHaveLength(1);
  });

  it('opens Project when GitHub shares no email, as Continue does not ask for one either', async () => {
    const modules = screens();
    const noEmail: IdentityResult = { ok: true, identity: { login: 'member-b', name: null, email: null } };
    startGrillo(modules.registry, fakeGrillo({ [SETUP_FINISHED]: true }, { 'tools:identity': () => noEmail }).grillo);
    await flush();

    expect(modules.project.mount).toHaveBeenCalledTimes(1);
  });

  it.each<[string, Record<string, Handler>]>([
    ['Claude Code is missing', { 'tools:check': () => ({ claude: missing, gh: ready }) }],
    ['gh is missing', { 'tools:check': () => ({ claude: ready, gh: missing }) }],
    ['Claude Code is signed out', { 'tools:check': () => ({ claude: signedOut, gh: ready }) }],
    ['gh is signed out', { 'tools:check': () => ({ claude: ready, gh: signedOut }) }],
    ['the identity is signed out', { 'tools:identity': () => ({ ok: false, reason: 'signed-out' }) }],
    ['the check is refused', { 'tools:check': () => Promise.reject(new Error('made-up failure')) }],
    ['the check gives no answer', { 'tools:check': () => null }],
    ['the check answers in the wrong shape', { 'tools:check': () => ({ claude: ready }) }],
    ['the identity call is refused', { 'tools:identity': () => Promise.reject(new Error('made-up failure')) }],
    ['the identity gives no answer', { 'tools:identity': () => null }],
    ['the identity has an empty login', { 'tools:identity': () => ({ ok: true, identity: { login: '', name: null, email: null } }) }],
  ])('opens Setup on a later start when %s, and keeps the setting', async (_case, overrides) => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const modules = screens();
    const stored = { [SETUP_FINISHED]: true };
    const fake = fakeGrillo(stored, overrides);
    const root = startGrillo(modules.registry, fake.grillo);
    await flush();

    expect(modules.setup.mount).toHaveBeenCalledTimes(1);
    expect(modules.project.mount).not.toHaveBeenCalled();
    expect(activeTab(root)).toBe('Setup');
    expect(fake.calls('settings:set')).toEqual([]);
    expect(stored[SETUP_FINISHED]).toBe(true);
  });

  it.each<[string, ToolsReport]>([
    ['passes', ALL_GREEN],
    ['fails', { claude: missing, gh: ready }],
  ])('keeps a tab the member opened while the check runs, when it then %s', async (_case, report) => {
    const check = deferred<ToolsReport>();
    const modules = screens();
    const root = startGrillo(modules.registry, fakeGrillo({ [SETUP_FINISHED]: true }, { 'tools:check': () => check.promise }).grillo);
    await flush();

    tab(root, 'Map').click();
    check.resolve(report);
    await flush();

    expect(modules.map.mount).toHaveBeenCalledTimes(1);
    expect(activeTab(root)).toBe('Map');
    expect(modules.project.mount).not.toHaveBeenCalled();
    expect(modules.setup.mount).not.toHaveBeenCalled();
    expect(checkingNote(root)).toBeNull();
  });

  it('keeps a tab the member opened while the setting is being read, with no checking note over it', async () => {
    const answer = deferred<unknown>();
    const modules = screens();
    const root = startGrillo(modules.registry, fakeGrillo({}, { 'settings:get': () => answer.promise }).grillo);

    tab(root, 'Map').click();
    answer.resolve(true);
    await flush();

    expect(activeTab(root)).toBe('Map');
    expect(modules.map.mount).toHaveBeenCalledTimes(1);
    expect(modules.project.mount).not.toHaveBeenCalled();
    expect(checkingNote(root)).toBeNull();
  });

  it('opens nothing once the shell is closed while the check runs', async () => {
    const check = deferred<ToolsReport>();
    const modules = screens();
    startGrillo(modules.registry, fakeGrillo({ [SETUP_FINISHED]: true }, { 'tools:check': () => check.promise }).grillo);
    await flush();

    shells.splice(0).forEach((shell) => shell.dispose());
    check.resolve(ALL_GREEN);
    await flush();

    expect(modules.project.mount).not.toHaveBeenCalled();
    expect(modules.setup.mount).not.toHaveBeenCalled();
  });
});

describe('from a first launch to later starts, through the real setup check', () => {
  const realScreens = () => {
    const project = screen('project-creation');
    const setup = { ...setupCheck, mount: vi.fn(setupCheck.mount) };
    return { project, setup, registry: registry(setup, project) };
  };
  const continueButton = (root: HTMLElement) =>
    [...root.querySelectorAll<HTMLButtonElement>('main button')].find((button) => button.textContent === 'Continue') as HTMLButtonElement;

  it('stores the setting on Continue, opens Project on the next start, Setup on a failing one, and Project again after that', async () => {
    const stored: Record<string, unknown> = {};
    let report: ToolsReport = ALL_GREEN;
    const fake = fakeGrillo(stored, { 'tools:check': () => report });

    const first = realScreens();
    const firstRoot = startGrillo(first.registry, fake.grillo);
    await flush();
    expect(first.setup.mount).toHaveBeenCalledTimes(1);
    continueButton(firstRoot).click();
    await flush();
    expect(stored).toEqual({ [SETUP_FINISHED]: true });
    expect(first.project.mount).toHaveBeenCalledTimes(1);

    const passing = realScreens();
    startGrillo(passing.registry, fake.grillo);
    await flush();
    expect(passing.project.mount).toHaveBeenCalledTimes(1);
    expect(passing.setup.mount).not.toHaveBeenCalled();

    report = { claude: signedOut, gh: ready };
    const failing = realScreens();
    const failingRoot = startGrillo(failing.registry, fake.grillo);
    await flush();
    expect(failing.setup.mount).toHaveBeenCalledTimes(1);
    expect(continueButton(failingRoot).disabled).toBe(true);
    expect(stored).toEqual({ [SETUP_FINISHED]: true });

    report = ALL_GREEN;
    const again = realScreens();
    startGrillo(again.registry, fake.grillo);
    await flush();
    expect(again.project.mount).toHaveBeenCalledTimes(1);
    expect(again.setup.mount).not.toHaveBeenCalled();
  });

  it('lets a member open Setup by hand after a passing start, and Continue there goes to Project', async () => {
    const stored = { [SETUP_FINISHED]: true };
    const modules = realScreens();
    const root = startGrillo(modules.registry, fakeGrillo(stored).grillo);
    await flush();

    tab(root, 'Setup').click();
    await flush();

    expect(activeTab(root)).toBe('Setup');
    expect(root.querySelector('main .update-card')).not.toBeNull();
    continueButton(root).click();
    await flush();
    expect(activeTab(root)).toBe('Project');
    expect(modules.project.mount).toHaveBeenCalledTimes(2);
  });
});

describe('the tab bar', () => {
  const STYLESHEETS = ['../theme/tokens.css', '../theme/glass.css', 'shell.css'].map((sheet) => resolve(__dirname, sheet));
  const useRealStylesheets = () => {
    for (const sheet of STYLESHEETS) {
      const style = document.createElement('style');
      style.textContent = readFileSync(sheet, 'utf8');
      document.head.append(style);
    }
  };
  const manyAgents: AgentInfo[] = Array.from({ length: 30 }, (_, at) => ({
    id: `a${at}`,
    kind: 'grilling',
    title: `Grilling · Sample ticket ${at}`,
    folder: '/projects/sample-1',
    waiting: false,
  }));

  it('has Project first and Setup last, after "+" and every agent tab, outside the strip that scrolls', async () => {
    useRealStylesheets();
    const fake = fakeGrillo({}, { 'agents:list': () => manyAgents });
    const root = startGrillo(screens().registry, fake.grillo);
    await flush();

    const nav = root.querySelector('nav') as HTMLElement;
    const tabs = [...nav.querySelectorAll<HTMLElement>('.tab')];
    expect(tabs[0].textContent).toBe('Project');
    expect(tabs.at(-1)?.textContent).toBe('Setup');
    expect(tabs.at(-2)?.textContent).toBe('+');
    expect(tabs).toHaveLength(manyAgents.length + 6);

    const strip = nav.querySelector('.tab-strip') as HTMLElement;
    const setup = tab(root, 'Setup');
    expect(setup.parentElement).toBe(nav);
    expect(strip.contains(setup)).toBe(false);
    expect(strip.contains(nav.querySelector('.agent-tabs'))).toBe(true);
    expect(strip.contains(nav.querySelector('.add'))).toBe(true);
    expect(getComputedStyle(strip).overflowX).toBe('auto');
    expect(getComputedStyle(nav).overflowX).not.toBe('auto');
  });
});
