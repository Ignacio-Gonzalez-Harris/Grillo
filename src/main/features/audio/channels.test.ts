import { describe, expect, it, vi } from 'vitest';
import { createGrilloApi } from '../../../preload/bridge';
import { type AudioSlice, INPUT_DEVICE_SETTING, SAMPLES_PER_SLICE } from '../../../shared/audio';
import type { Settings } from '../../app/settings';
import { createMainIpc } from '../../ipc/bridge';
import { createFakeIpc } from '../../ipc/fake-ipc';
import { registerAudioChannels, type AudioChannelDeps } from './channels';

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

function connect(overrides: Partial<AudioChannelDeps> = {}) {
  const deps: AudioChannelDeps = {
    settings: memorySettings(),
    microphoneAccess: async () => ({ granted: true, instruction: 'Allow it in settings.' }),
    callAudioSupport: () => ({ supported: true }),
    deliverSlice: vi.fn(),
    ...overrides,
  };
  const fake = createFakeIpc();
  registerAudioChannels(createMainIpc(fake.main, () => [fake.window]), deps);
  return { grillo: createGrilloApi(fake.renderer), deps };
}

describe('audio IPC channels', () => {
  it('answers the microphone and call-audio questions from the platform checks', async () => {
    const denied = { granted: false, instruction: 'Open System Settings.' };
    const unsupported = { supported: false as const, reason: 'Not on a Mac yet.' };
    const { grillo } = connect({ microphoneAccess: async () => denied, callAudioSupport: () => unsupported });

    await expect(grillo.invoke('audio:microphone-access', undefined)).resolves.toEqual(denied);
    await expect(grillo.invoke('audio:call-support', undefined)).resolves.toEqual(unsupported);
  });

  it('delivers a well-formed slice to main with its samples intact', async () => {
    const deliverSlice = vi.fn();
    const { grillo } = connect({ deliverSlice });
    const pcm = Int16Array.from({ length: SAMPLES_PER_SLICE }, (_, i) => (i % 200) - 100);

    await grillo.invoke('audio:slice', { source: 'call', index: 3, pcm });

    expect(deliverSlice).toHaveBeenCalledWith({ source: 'call', index: 3, pcm });
  });

  it.each<[string, unknown]>([
    ['null', null],
    ['an unknown source', { source: 'camera', index: 0, pcm: new Int16Array(10) }],
    ['a missing source', { index: 0, pcm: new Int16Array(10) }],
    ['a negative index', { source: 'microphone', index: -1, pcm: new Int16Array(10) }],
    ['a fractional index', { source: 'microphone', index: 1.5, pcm: new Int16Array(10) }],
    ['float samples', { source: 'microphone', index: 0, pcm: new Float32Array(10) }],
    ['a plain number list', { source: 'microphone', index: 0, pcm: [1, 2, 3] }],
    ['no samples', { source: 'microphone', index: 0, pcm: new Int16Array(0) }],
    ['more than one slice of samples', { source: 'microphone', index: 0, pcm: new Int16Array(SAMPLES_PER_SLICE + 1) }],
  ])('rejects a slice with %s and delivers nothing', async (_name, slice) => {
    const deliverSlice = vi.fn();
    const { grillo } = connect({ deliverSlice });

    await expect(grillo.invoke('audio:slice', slice as AudioSlice)).rejects.toThrow(/audio slice|capture source/);
    expect(deliverSlice).not.toHaveBeenCalled();
  });

  it('keeps the picked microphone in the settings file, the system default until one is picked', async () => {
    const settings = memorySettings();
    const { grillo } = connect({ settings });

    await expect(grillo.invoke('audio:get-input-device', undefined)).resolves.toBeNull();
    await grillo.invoke('audio:set-input-device', 'usb-mic-1');
    await expect(grillo.invoke('audio:get-input-device', undefined)).resolves.toBe('usb-mic-1');
    expect(settings.values[INPUT_DEVICE_SETTING]).toBe('usb-mic-1');
    await grillo.invoke('audio:set-input-device', null);
    await expect(grillo.invoke('audio:get-input-device', undefined)).resolves.toBeNull();
  });

  it('refuses an empty or non-text device id, and reads a corrupt saved value as the system default', async () => {
    const { grillo } = connect({ settings: memorySettings({ [INPUT_DEVICE_SETTING]: 42 }) });

    await expect(grillo.invoke('audio:get-input-device', undefined)).resolves.toBeNull();
    await expect(grillo.invoke('audio:set-input-device', '')).rejects.toThrow(/device id/);
    await expect(grillo.invoke('audio:set-input-device', 7 as unknown as string)).rejects.toThrow(/device id/);
  });
});
