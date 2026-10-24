import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGrilloApi } from '../../../preload/bridge';
import type { EventChannel, EventPayload } from '../../../shared/ipc';
import { AUTO_UPDATE_SETTING, createUpdatesClient } from '../../../shared/updates';
import type { Settings } from '../../app/settings';
import { createMainIpc } from '../../ipc/bridge';
import { createFakeIpc } from '../../ipc/fake-ipc';
import { createFakeUpdater } from './fake-updater';
import { CHECK_INTERVAL_MS, createUpdatesFeature, type UpdatesFeatureOptions } from './updates';

const UPDATE_EVENTS = ['updates:update-available', 'updates:download-progress', 'updates:ready-to-install'] as const;

function memorySettings(initial: Record<string, unknown> = {}): Settings & { values: Record<string, unknown> } {
  const values = { ...initial };
  return {
    values,
    get: (key, defaultValue) => (Object.hasOwn(values, key) ? (values[key] as typeof defaultValue) : defaultValue),
    set: (key, value) => {
      values[key] = value;
    },
  };
}

function setUp(options: Partial<UpdatesFeatureOptions> = {}) {
  const fake = createFakeIpc();
  const ipc = createMainIpc(fake.main, () => [fake.window]);
  const grillo = createGrilloApi(fake.renderer);
  const { updater, state } = createFakeUpdater();
  const log = { info: vi.fn(), warn: vi.fn() };
  const events: { channel: EventChannel; payload: EventPayload<EventChannel> }[] = [];
  for (const channel of UPDATE_EVENTS) {
    grillo.on(channel, (payload) => events.push({ channel, payload }));
  }
  const feature = createUpdatesFeature({
    ipc,
    settings: memorySettings(),
    updater: () => updater,
    currentVersion: '1.0.0',
    isPackaged: true,
    platform: 'win32',
    macBuildSigned: false,
    log,
    ...options,
  });
  return { feature, client: createUpdatesClient(grillo), grillo, updater, state, log, events };
}

/** Lets the feature's pending promises (a check, a download) settle. */
const settle = () => vi.advanceTimersByTimeAsync(0);

describe('app update check', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('checks at start and every hour, and reports a found update as updateAvailable', async () => {
    const { feature, client, state, updater, events } = setUp();
    feature.start();
    await settle();
    expect(state.checks).toBe(1);
    expect(await client.getUpdateState()).toMatchObject({ phase: 'none', version: null, currentVersion: '1.0.0' });

    state.published = '1.1.0';
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS);

    expect(state.checks).toBe(2);
    expect(events).toEqual([{ channel: 'updates:update-available', payload: { version: '1.1.0' } }]);
    expect(await client.getUpdateState()).toEqual({
      currentVersion: '1.0.0',
      phase: 'available',
      version: '1.1.0',
      percent: null,
      autoUpdate: false,
      manualInstall: false,
    });
    expect(updater.autoDownload).toBe(false);
    expect(state.downloads).toBe(0);
    feature.stop();
  });

  it('install() downloads with progress, reports readyToInstall, then quits and installs silently', async () => {
    const { feature, client, state, events } = setUp();
    state.published = '1.1.0';
    feature.start();
    await settle();

    await client.install();

    expect(events.map((event) => event.channel)).toEqual([
      'updates:update-available',
      'updates:download-progress',
      'updates:download-progress',
      'updates:ready-to-install',
    ]);
    expect(events[2].payload).toEqual({ version: '1.1.0', percent: 100 });
    expect(state.installs).toEqual([[true, true]]);
    expect((await client.getUpdateState()).phase).toBe('ready');
    feature.stop();
  });

  it('later() hides the offered version until restart, but a newer version is offered again', async () => {
    const { feature, client, state, events } = setUp();
    state.published = '1.1.0';
    feature.start();
    await settle();

    await client.later();
    expect(await client.getUpdateState()).toMatchObject({ phase: 'none', version: null });
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS);
    expect(events).toHaveLength(1);

    state.published = '1.2.0';
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS);
    expect(events.at(-1)).toEqual({ channel: 'updates:update-available', payload: { version: '1.2.0' } });
    expect(state.downloads).toBe(0);
    feature.stop();
  });

  it('with autoUpdate on, downloads silently and leaves the install to the next quit', async () => {
    const settings = memorySettings({ [AUTO_UPDATE_SETTING]: true });
    const { feature, client, state, updater } = setUp({ settings });
    state.published = '1.1.0';
    feature.start();
    await settle();

    expect(updater.autoDownload).toBe(true);
    expect(updater.autoInstallOnAppQuit).toBe(true);
    expect(state.installs).toEqual([]);
    expect(await client.getUpdateState()).toMatchObject({ phase: 'ready', version: '1.1.0', autoUpdate: true });
    feature.stop();
  });

  it('setAutoUpdate() saves the switch (off by default) and applies it to the updater straight away', async () => {
    const settings = memorySettings();
    const { feature, client, state, updater, grillo } = setUp({ settings });
    state.published = '1.1.0';
    feature.start();
    await settle();
    expect(updater.autoInstallOnAppQuit).toBe(false);

    expect(await client.setAutoUpdate(true)).toMatchObject({ autoUpdate: true });
    await settle();
    expect(settings.values[AUTO_UPDATE_SETTING]).toBe(true);
    expect(updater.autoInstallOnAppQuit).toBe(true);
    expect((await client.getUpdateState()).phase).toBe('ready');
    expect(state.installs).toEqual([]);

    await client.setAutoUpdate(false);
    expect(settings.values[AUTO_UPDATE_SETTING]).toBe(false);
    expect(updater.autoInstallOnAppQuit).toBe(false);
    await expect(grillo.invoke('updates:set-auto-update', 'yes' as unknown as boolean)).rejects.toThrow(/boolean/);
    feature.stop();
  });

  it.each([
    { platform: 'darwin', macBuildSigned: false, manualInstall: true },
    { platform: 'darwin', macBuildSigned: true, manualInstall: false },
    { platform: 'win32', macBuildSigned: false, manualInstall: false },
  ] as const)(
    'on $platform with signed=$macBuildSigned, manualInstall is $manualInstall',
    async ({ platform, macBuildSigned, manualInstall }) => {
      const settings = memorySettings({ [AUTO_UPDATE_SETTING]: true });
      const { feature, client, state, updater } = setUp({ settings, platform, macBuildSigned });
      state.published = '1.1.0';
      feature.start();
      await settle();
      await client.install();

      expect((await client.getUpdateState()).manualInstall).toBe(manualInstall);
      expect(updater.autoInstallOnAppQuit).toBe(!manualInstall);
      expect(state.downloads > 0).toBe(!manualInstall);
      feature.stop();
    },
  );

  it('a dev run never checks: it logs and reports nothing to offer', async () => {
    const updaterFactory = vi.fn();
    const { feature, client, log } = setUp({ isPackaged: false, updater: updaterFactory });
    feature.start();
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS);

    expect(updaterFactory).not.toHaveBeenCalled();
    expect(log.info).toHaveBeenCalledWith(expect.stringMatching(/development run/));
    expect(await client.getUpdateState()).toMatchObject({ phase: 'none', manualInstall: false });
    await expect(client.install()).resolves.toBeUndefined();
    feature.stop();
  });

  it('a failed check or download only logs a warning, and a failed download offers the update again', async () => {
    const { feature, client, state, log, events } = setUp();
    state.checkFailure = new Error('HttpError: 404 latest.yml not found');
    feature.start();
    await settle();
    expect(log.warn).toHaveBeenCalledWith(expect.stringMatching(/404 latest\.yml/));

    state.checkFailure = null;
    state.published = '1.1.0';
    state.downloadFailure = new Error('net::ERR_CONNECTION_RESET');
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS);
    await expect(client.install()).resolves.toBeUndefined();

    expect(log.warn).toHaveBeenCalledWith(expect.stringMatching(/ERR_CONNECTION_RESET/));
    expect(await client.getUpdateState()).toMatchObject({ phase: 'available', percent: null });
    expect(events.filter((event) => event.channel === 'updates:update-available')).toHaveLength(2);
    expect(state.installs).toEqual([]);
    feature.stop();
  });

  it('a failed silent download with autoUpdate on is logged once, never left as an unhandled rejection', async () => {
    vi.useRealTimers();
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const settings = memorySettings({ [AUTO_UPDATE_SETTING]: true });
      const { feature, client, state, log } = setUp({ settings });
      state.published = '1.1.0';
      state.downloadFailure = new Error('net::ERR_CONNECTION_RESET');
      feature.start();
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(unhandled).not.toHaveBeenCalled();
      expect(log.warn).toHaveBeenCalledTimes(1);
      expect(log.warn).toHaveBeenCalledWith(expect.stringMatching(/ERR_CONNECTION_RESET/));
      expect(await client.getUpdateState()).toMatchObject({ phase: 'available', version: '1.1.0' });
      feature.stop();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('ignores malformed updater answers instead of throwing', async () => {
    const { feature, client, updater, log, events } = setUp();
    feature.start();
    await settle();

    for (const info of [null, undefined, {}, { version: null }, { version: '' }, { version: 42 }, { version: ['1.1.0'] }]) {
      updater.emit('update-available', info);
      updater.emit('update-downloaded', info);
    }
    updater.emit('error', null);
    expect(events).toEqual([]);
    expect((await client.getUpdateState()).phase).toBe('none');

    updater.emit('update-available', { version: '1.1.0' });
    for (const progress of [null, {}, { percent: Number.NaN }, { percent: '50' }]) {
      updater.emit('download-progress', progress);
    }
    updater.emit('download-progress', { percent: 140 });
    updater.emit('download-progress', { percent: -3 });

    expect(events.slice(1)).toEqual([
      { channel: 'updates:download-progress', payload: { version: '1.1.0', percent: 100 } },
      { channel: 'updates:download-progress', payload: { version: '1.1.0', percent: 0 } },
    ]);
    expect(log.warn).toHaveBeenCalled();
    feature.stop();
  });
});
