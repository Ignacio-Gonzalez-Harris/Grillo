// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EventChannel, EventPayload, GrilloApi } from '../../shared/ipc';
import type { ToolStatus } from '../../shared/tools';
import type { UpdateState } from '../../shared/updates';
import { RELEASE_PAGE_URL } from '../screens/setup-check/update-card';
import { registerScreens } from './screens';
import { createShell, type Shell } from './shell';

const NO_UPDATE: UpdateState = {
  currentVersion: '1.0.0',
  phase: 'none',
  version: null,
  percent: null,
  autoUpdate: false,
  manualInstall: false,
};
const OFFER: UpdateState = { ...NO_UPDATE, phase: 'available', version: '1.1.0' };
const READY_TOOL: ToolStatus = { installed: true, signedIn: true, version: '1.0.0', guidance: null };

type Handler = (payload: unknown) => unknown;

/** A stand-in for `window.grillo`: each channel answers from `handlers`; `emit` plays an event from main. */
function fakeGrillo(overrides: Record<string, Handler> = {}) {
  const handlers: Record<string, Handler> = {
    'agents:list': () => [],
    'updates:get-state': () => NO_UPDATE,
    'updates:set-auto-update': (enabled) => ({ ...NO_UPDATE, autoUpdate: enabled }),
    'updates:install': () => undefined,
    'updates:later': () => undefined,
    'transcription:get-model-updates': () => 'ask',
    'transcription:set-model-updates': () => undefined,
    ...overrides,
  };
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const invoke = vi.fn(async (channel: string, payload: unknown) => {
    const handler = handlers[channel];
    if (!handler) throw new Error(`No fake for ${channel}`);
    return handler(payload);
  });
  const grillo = {
    invoke,
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
  const calls = (channel: string) => invoke.mock.calls.filter(([name]) => name === channel).map(([, payload]) => payload);
  const listenerCount = (prefix: string) =>
    [...listeners.entries()].filter(([channel]) => channel.startsWith(prefix)).reduce((sum, [, set]) => sum + set.size, 0);
  return { grillo, emit, calls, listenerCount };
}

const flush = async () => {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

const shells: Shell[] = [];
/** Starts Grillo (a fresh shell is a restart) and opens the map, a screen that shows no update offer of its own. */
async function startOnMap(grillo: GrilloApi): Promise<HTMLElement> {
  const root = document.createElement('div');
  document.body.append(root);
  const shell = createShell(root, { grillo, screens: registerScreens({}) });
  shells.push(shell);
  await flush();
  shell.navigate('map');
  return root;
}

/** Everything a later start needs to pass, so Grillo opens on Project. */
const LATER_START: Record<string, Handler> = {
  'settings:get': () => true,
  'tools:check': () => ({ claude: READY_TOOL, gh: READY_TOOL }),
  'tools:identity': () => ({ ok: true, identity: { login: 'member-a', name: null, email: null } }),
};

/** Starts Grillo (a fresh shell is a restart) and leaves it on whichever screen it chooses. */
async function start(grillo: GrilloApi): Promise<HTMLElement> {
  const root = document.createElement('div');
  document.body.append(root);
  shells.push(createShell(root, { grillo, screens: registerScreens({}) }));
  await flush();
  return root;
}

const popup = (root: HTMLElement) => root.querySelector<HTMLElement>('.window > .overlay');
const isShown = (root: HTMLElement) => popup(root)?.hidden === false;
const dialog = (root: HTMLElement) => popup(root)?.querySelector<HTMLElement>('[role="dialog"]');
const buttonNamed = (root: HTMLElement, label: string) =>
  [...(popup(root)?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find((b) => b.textContent === label);
const screenBehind = (root: HTMLElement) => root.querySelector<HTMLElement>('main.window-body');
const activeTab = (root: HTMLElement) => root.querySelector('nav [aria-current="page"]')?.textContent;

afterEach(() => {
  shells.splice(0).forEach((shell) => shell.dispose());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('update pop-up over any screen', () => {
  it('shows the setup check offer card as a pop-up over the open screen when an update is found', async () => {
    const fake = fakeGrillo();
    const root = await startOnMap(fake.grillo);
    expect(isShown(root)).toBe(false);

    fake.emit('updates:update-available', { version: '1.1.0' });

    expect(isShown(root)).toBe(true);
    expect(dialog(root)?.getAttribute('aria-modal')).toBe('true');
    expect(dialog(root)?.getAttribute('aria-label')).toBe('Update offer');
    expect(dialog(root)?.textContent).toContain('Grillo 1.1.0 is available. You have 1.0.0.');
    expect(dialog(root)?.textContent).toContain('Shown once per version. Later hides it until Grillo restarts.');
    expect(buttonNamed(root, 'Download and install')).toBeDefined();
    expect(buttonNamed(root, 'Later')).toBeDefined();
    expect(screenBehind(root)?.textContent).toContain('Map is not built yet.');
    expect(screenBehind(root)?.hasAttribute('inert')).toBe(true);
    expect(root.querySelector('nav')?.hasAttribute('inert')).toBe(true);
  });

  it('shows the pop-up once per version: Later hides it until Grillo restarts, a newer version shows it again', async () => {
    const fake = fakeGrillo();
    const root = await startOnMap(fake.grillo);
    fake.emit('updates:update-available', { version: '1.1.0' });

    buttonNamed(root, 'Later')?.click();
    await flush();

    expect(isShown(root)).toBe(false);
    expect(fake.calls('updates:later')).toHaveLength(1);
    expect(screenBehind(root)?.hasAttribute('inert')).toBe(false);

    fake.emit('updates:update-available', { version: '1.1.0' });
    expect(isShown(root)).toBe(false);

    fake.emit('updates:update-available', { version: '1.2.0' });
    expect(isShown(root)).toBe(true);
    expect(dialog(root)?.textContent).toContain('Grillo 1.2.0 is available.');

    const restarted = await startOnMap(fake.grillo);
    fake.emit('updates:update-available', { version: '1.1.0' });
    expect(isShown(restarted)).toBe(true);
  });

  it('follows the download in the pop-up: downloading with its percent, then ready with Restart and install', async () => {
    const fake = fakeGrillo();
    const root = await startOnMap(fake.grillo);
    fake.emit('updates:update-available', { version: '1.1.0' });

    buttonNamed(root, 'Download and install')?.click();
    await flush();
    expect(fake.calls('updates:install')).toHaveLength(1);
    fake.emit('updates:download-progress', { version: '1.1.0', percent: 42 });

    expect(dialog(root)?.textContent).toContain('Downloading Grillo 1.1.0: 42%.');
    expect(buttonNamed(root, 'Download and install')?.disabled).toBe(true);

    fake.emit('updates:ready-to-install', { version: '1.1.0' });

    expect(isShown(root)).toBe(true);
    expect(dialog(root)?.textContent).toContain('Grillo 1.1.0 is downloaded. Restart Grillo to install it.');
    expect(buttonNamed(root, 'Restart and install')).toBeDefined();
  });

  it('offers the manual route on a Mac that cannot install updates itself, as the setup check does', async () => {
    const fake = fakeGrillo({ 'updates:get-state': () => ({ ...NO_UPDATE, manualInstall: true }) });
    const openPage = vi.spyOn(window, 'open').mockImplementation(() => null);
    const root = await startOnMap(fake.grillo);
    fake.emit('updates:update-available', { version: '1.1.0' });

    expect(dialog(root)?.textContent).toContain(
      'Grillo cannot install updates by itself on this Mac until it is signed. Download and install opens the release page',
    );
    buttonNamed(root, 'Download and install')?.click();
    await flush();

    expect(openPage).toHaveBeenCalledWith(RELEASE_PAGE_URL);
    expect(fake.calls('updates:install')).toEqual([]);
  });

  it('does not cover the setup check, which shows the offer itself, and counts that version as offered', async () => {
    const fake = fakeGrillo();
    const root = document.createElement('div');
    document.body.append(root);
    const shell = createShell(root, { grillo: fake.grillo, screens: registerScreens({}) });
    shells.push(shell);
    await flush();

    fake.emit('updates:update-available', { version: '1.1.0' });
    expect(isShown(root)).toBe(false);

    shell.navigate('map');
    fake.emit('updates:update-available', { version: '1.1.0' });
    expect(isShown(root)).toBe(false);
  });

  it('opens for a version main found before the pop-up was listening, once, and an event for it changes nothing', async () => {
    const fake = fakeGrillo({ ...LATER_START, 'updates:get-state': () => OFFER });
    const root = await start(fake.grillo);

    expect(isShown(root)).toBe(true);
    expect(dialog(root)?.textContent).toContain('Grillo 1.1.0 is available. You have 1.0.0.');

    buttonNamed(root, 'Later')?.click();
    await flush();
    fake.emit('updates:update-available', { version: '1.1.0' });

    expect(isShown(root)).toBe(false);
  });

  it.each<[string, UpdateState, string]>([
    ['downloading', { ...OFFER, phase: 'downloading', percent: 42 }, 'Downloading Grillo 1.1.0: 42%.'],
    ['ready to install', { ...OFFER, phase: 'ready' }, 'Grillo 1.1.0 is downloaded.'],
  ])('opens for a version already %s when the pop-up started listening', async (_case, state, says) => {
    const root = await start(fakeGrillo({ ...LATER_START, 'updates:get-state': () => state }).grillo);

    expect(isShown(root)).toBe(true);
    expect(dialog(root)?.textContent).toContain(says);
  });

  it('does not bring back a version Later put off, when the window reads the update state again', async () => {
    let state: UpdateState = OFFER;
    const fake = fakeGrillo({
      ...LATER_START,
      'updates:get-state': () => state,
      // As the updates feature does: Later takes the offer away until Grillo restarts.
      'updates:later': () => {
        state = NO_UPDATE;
      },
    });
    const root = await start(fake.grillo);
    expect(isShown(root)).toBe(true);
    buttonNamed(root, 'Later')?.click();
    await flush();

    // The window loads again while the main process keeps running.
    const reloaded = await start(fake.grillo);

    expect(isShown(root)).toBe(false);
    expect(isShown(reloaded)).toBe(false);
  });

  it.each<[string, Handler]>([
    ['a refused read', () => Promise.reject(new Error('made-up failure'))],
    ['no answer', () => null],
    ['an offer with no version', () => ({ ...OFFER, version: null })],
    ['an unknown phase', () => ({ ...OFFER, phase: 'gremlins' })],
  ])('opens no pop-up for %s of the update state, and still follows later events', async (_case, read) => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fake = fakeGrillo({ 'updates:get-state': read });
    const root = await startOnMap(fake.grillo);
    await flush();
    expect(isShown(root)).toBe(false);

    fake.emit('updates:update-available', { version: '1.1.0' });

    expect(isShown(root)).toBe(true);
  });

  it.each([
    ['no payload', null],
    ['a payload without a version', {}],
    ['an empty version', { version: '' }],
    ['a version that is not text', { version: 7 }],
    ['a payload that is not an object', 'version 1.1.0'],
  ])('opens no pop-up for an update event with %s', async (_case, payload) => {
    const fake = fakeGrillo();
    const root = await startOnMap(fake.grillo);

    fake.emit('updates:update-available', payload as never);

    expect(isShown(root)).toBe(false);
  });

  it('opens no pop-up for download or ready events of a version it never offered', async () => {
    const fake = fakeGrillo();
    const root = await startOnMap(fake.grillo);

    fake.emit('updates:download-progress', { version: '1.1.0', percent: 10 });
    fake.emit('updates:ready-to-install', { version: '1.1.0' });

    expect(isShown(root)).toBe(false);
  });

  describe('for a member who starts on Project', () => {
    it('offers a version found after the start through the pop-up', async () => {
      const fake = fakeGrillo(LATER_START);
      const root = await start(fake.grillo);
      expect(activeTab(root)).toBe('Project');
      expect(isShown(root)).toBe(false);

      fake.emit('updates:update-available', { version: '1.1.0' });

      expect(isShown(root)).toBe(true);
    });

    it('offers a version found before the window was listening', async () => {
      const root = await start(fakeGrillo({ ...LATER_START, 'updates:get-state': () => OFFER }).grillo);

      expect(activeTab(root)).toBe('Project');
      expect(isShown(root)).toBe(true);
      expect(dialog(root)?.textContent).toContain('Grillo 1.1.0 is available.');
    });

    it('offers a version found while the start-up check runs, only once Project is open', async () => {
      let state = NO_UPDATE;
      let answerCheck: (report: unknown) => void = () => undefined;
      const fake = fakeGrillo({
        ...LATER_START,
        'updates:get-state': () => state,
        'tools:check': () => new Promise((done) => (answerCheck = done)),
      });
      const root = await start(fake.grillo);

      state = OFFER;
      fake.emit('updates:update-available', { version: '1.1.0' });
      expect(isShown(root)).toBe(false);

      answerCheck({ claude: READY_TOOL, gh: READY_TOOL });
      await flush();

      expect(activeTab(root)).toBe('Project');
      expect(isShown(root)).toBe(true);
    });
  });

  describe('for a member who lands on Setup', () => {
    it.each<[string, Record<string, Handler>]>([
      ['on a first launch', {}],
      ['on a failing later start', { 'settings:get': () => true, 'tools:check': () => Promise.reject(new Error('made-up failure')) }],
    ])('leaves a version found early to the setup card %s, and does not pop it up on the next screen', async (_case, overrides) => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const fake = fakeGrillo({ 'updates:get-state': () => OFFER, ...overrides });
      const root = document.createElement('div');
      document.body.append(root);
      const shell = createShell(root, { grillo: fake.grillo, screens: registerScreens({}) });
      shells.push(shell);
      await flush();

      expect(activeTab(root)).toBe('Setup');
      expect(isShown(root)).toBe(false);

      shell.navigate('map');
      await flush();

      expect(isShown(root)).toBe(false);
    });
  });

  it('stops listening to the update events when the shell is disposed', async () => {
    const fake = fakeGrillo();
    await startOnMap(fake.grillo);
    expect(fake.listenerCount('updates:')).toBeGreaterThan(0);

    shells.splice(0).forEach((shell) => shell.dispose());

    expect(fake.listenerCount('updates:')).toBe(0);
  });
});
