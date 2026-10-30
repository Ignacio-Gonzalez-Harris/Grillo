import { describe, expect, it, vi } from 'vitest';
import { createGrilloApi } from '../../../preload/bridge';
import type { FeatureContext } from '../../app/features';
import { createMainIpc } from '../../ipc/bridge';
import { createFakeIpc } from '../../ipc/fake-ipc';
import type { StoreOptions } from '../../store';
import { createMemoryStore } from '../../store/memory';
import { createMemorySettings } from '../../store/memory/settings';
import type { PullRequestNotice } from '../../store/store';
import { register } from './ipc';

// The app's store is the real GitHub store, which needs gh and git; this file swaps it for the memory store and keeps
// the notice callback the feature hands over, so a test can play a save that became a pull request.
const handed = vi.hoisted(() => ({ onPullRequest: undefined as StoreOptions['onPullRequest'] }));
vi.mock('../../store', async (original) => ({
  ...(await original<typeof import('../../store')>()),
  createStore: (_kind: string, options: StoreOptions) => {
    handed.onPullRequest = options.onPullRequest;
    return createMemoryStore({ settings: options.settings });
  },
}));

describe('store feature: saves that became a pull request', () => {
  it('tells every window which pull request holds the save, on store:pull-request', () => {
    const fake = createFakeIpc();
    const ipc = createMainIpc(fake.main, () => [fake.window]);
    const grillo = createGrilloApi(fake.renderer);
    const heard: PullRequestNotice[] = [];
    grillo.on('store:pull-request', (notice) => heard.push(notice));
    register({ ipc, settings: createMemorySettings() } satisfies FeatureContext);
    const notice = { project: 'example-org/demo', url: 'https://github.com/example-org/demo/pull/3', title: 'grillo: add source S2' };

    handed.onPullRequest?.(notice);

    expect(heard).toEqual([notice]);
  });
});
