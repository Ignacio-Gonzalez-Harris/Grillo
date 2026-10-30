import { describe, expect, it, vi } from 'vitest';
import { createMainIpc } from '../ipc/bridge';
import { createFakeIpc } from '../ipc/fake-ipc';
import { registerFeatures, type FeatureContext } from './features';
import type { Settings } from './settings';
import { startOrQuit, STARTUP_FAILED_TITLE } from './startup';

const unusedSettings: Settings = {
  get: (_key, defaultValue) => defaultValue,
  set: () => undefined,
};

function featureContext(): FeatureContext {
  const fake = createFakeIpc();
  return { ipc: createMainIpc(fake.main, () => [fake.window]), settings: unusedSettings };
}

function failureHandler() {
  return { showError: vi.fn<(title: string, content: string) => void>(), quit: vi.fn<() => void>(), log: vi.fn() };
}

describe('start-up', () => {
  it("shows a feature's start-up error in the system's error dialog, then quits", async () => {
    const failure = failureHandler();
    const broken = {
      register: () => {
        throw new Error('the speech model folder is read-only');
      },
    };

    await startOrQuit(
      () => registerFeatures({ '/src/main/features/broken/ipc.ts': broken }, featureContext()),
      failure,
      failure.log,
    );

    expect(failure.showError).toHaveBeenCalledOnce();
    const [title, content] = failure.showError.mock.calls[0];
    expect(title).toBe(STARTUP_FAILED_TITLE);
    expect(content).toContain("Feature 'broken' could not start: the speech model folder is read-only");
    expect(content).toContain('Grillo will close now.');
    expect(failure.quit).toHaveBeenCalledOnce();
    expect(failure.showError.mock.invocationCallOrder[0]).toBeLessThan(failure.quit.mock.invocationCallOrder[0]);
  });

  it.each<[string, unknown, string]>([
    ['an Error', new Error('disk full'), 'disk full'],
    ['a string', 'no PATH', 'no PATH'],
    ['an Error with no message', new Error(''), 'An unknown error stopped it.'],
    ['undefined', undefined, 'An unknown error stopped it.'],
    ['null', null, 'An unknown error stopped it.'],
    ['a plain object', { code: 7 }, 'An unknown error stopped it.'],
  ])('shows a readable reason and quits when a rejected start-up throws %s', async (_case, thrown, reason) => {
    const failure = failureHandler();

    await startOrQuit(() => Promise.reject(thrown), failure, failure.log);

    expect(failure.showError).toHaveBeenCalledWith(STARTUP_FAILED_TITLE, expect.stringMatching(new RegExp(`^${reason}\n`)));
    expect(failure.quit).toHaveBeenCalledOnce();
    expect(failure.log).toHaveBeenCalledWith('Grillo could not start.', thrown);
  });

  it('shows nothing and keeps running when every feature starts', async () => {
    const failure = failureHandler();
    const healthy = { register: vi.fn() };

    await startOrQuit(
      () => registerFeatures({ '/src/main/features/healthy/ipc.ts': healthy }, featureContext()),
      failure,
      failure.log,
    );

    expect(healthy.register).toHaveBeenCalledOnce();
    expect(failure.showError).not.toHaveBeenCalled();
    expect(failure.quit).not.toHaveBeenCalled();
  });
});
