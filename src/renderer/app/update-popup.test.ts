// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EventChannel, EventPayload, GrilloApi } from '../../shared/ipc';
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

const popup = (root: HTMLElement) => root.querySelector<HTMLElement>('.window > .overlay');
const isShown = (root: HTMLElement) => popup(root)?.hidden === false;
const dialog = (root: HTMLElement) => popup(root)?.querySelector<HTMLElement>('[role="dialog"]');
const buttonNamed = (root: HTMLElement, label: string) =>
  [...(popup(root)?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find((b) => b.textContent === label);
const screenBehind = (root: HTMLElement) => root.querySelector<HTMLElement>('main.window-body');

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

  it('stops listening to the update events when the shell is disposed', async () => {
    const fake = fakeGrillo();
    await startOnMap(fake.grillo);
    expect(fake.listenerCount('updates:')).toBeGreaterThan(0);

    shells.splice(0).forEach((shell) => shell.dispose());

    expect(fake.listenerCount('updates:')).toBe(0);
  });
});
