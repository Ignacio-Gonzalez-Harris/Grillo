import type { FeatureContext } from '../../app/features';
import type { Settings } from '../../app/settings';
import type { MainIpc } from '../../ipc/bridge';
import { createStore, storeKindFrom } from '../../store';
import type { PullRequestNotice, Store } from '../../store/store';
import {
  PULL_REQUEST_CHANNEL,
  STORE_METHODS,
  StoreError,
  storeChannel,
  type SettingValue,
  type StoreMethod,
  type StoreResult,
} from '../../../shared/store';

type AnyStoreMethod = (...args: unknown[]) => Promise<unknown>;
type AnyHandle = (channel: string, fn: (args: unknown[]) => Promise<StoreResult<unknown>>) => void;

/** Runs one store call; a refusal becomes data the renderer turns back into a `StoreError`. */
async function settle(store: Store, method: StoreMethod, args: unknown[]): Promise<StoreResult<unknown>> {
  try {
    return { ok: true, value: await (store[method] as AnyStoreMethod)(...args) };
  } catch (error) {
    if (error instanceof StoreError) {
      return { ok: false, error: { kind: error.kind, message: error.message } };
    }
    throw error;
  }
}

/** Puts every `Store` method on `store:<method>` and the settings on `settings:get` / `settings:set`. */
export function registerStoreIpc(ipc: MainIpc, store: Store, settings: Settings): void {
  const handle = ipc.handle as unknown as AnyHandle;
  for (const method of STORE_METHODS) {
    handle(storeChannel(method), (args) => settle(store, method, args));
  }
  ipc.handle('settings:get', ({ key, defaultValue }) => settings.get<SettingValue>(key, defaultValue));
  ipc.handle('settings:set', ({ key, value }) => settings.set(key, value));
}

const appStores = new WeakMap<Settings, Store>();
/** Per settings file, where the app's store sends word of a save that became a pull request: the windows. */
const pullRequestSinks = new WeakMap<Settings, (notice: PullRequestNotice) => void>();

/**
 * The app's one store, which every feature reading the store shares: one per settings file, so one queue guards each
 * project folder (two git commands at once in one clone fail). The backend comes from GRILLO_STORE: `memory` for
 * made-up data, GitHub otherwise.
 */
export function appStore(settings: Settings): Store {
  let store = appStores.get(settings);
  if (store === undefined) {
    store = createStore(storeKindFrom(process.env), { settings, onPullRequest: (notice) => pullRequestSinks.get(settings)?.(notice) });
    appStores.set(settings, store);
  }
  return store;
}

/** Puts the app's one store (`appStore`) on IPC, and tells every window when a save became a pull request. */
export function register({ ipc, settings }: FeatureContext): void {
  pullRequestSinks.set(settings, (notice) => ipc.send(PULL_REQUEST_CHANNEL, notice));
  registerStoreIpc(ipc, appStore(settings), settings);
}
