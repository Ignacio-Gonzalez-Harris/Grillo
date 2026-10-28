import type { FeatureContext } from '../../app/features';
import type { Settings } from '../../app/settings';
import type { MainIpc } from '../../ipc/bridge';
import { createStore, storeKindFrom } from '../../store';
import type { Store } from '../../store/store';
import {
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

/**
 * The app's one store, which every feature reading the store shares: one per settings file, so one queue guards each
 * project folder (two git commands at once in one clone fail). The backend comes from GRILLO_STORE: `memory` for
 * made-up data, GitHub otherwise.
 */
export function appStore(settings: Settings): Store {
  let store = appStores.get(settings);
  if (store === undefined) {
    store = createStore(storeKindFrom(process.env), { settings });
    appStores.set(settings, store);
  }
  return store;
}

/** Puts the app's one store (`appStore`) on IPC. */
export function register({ ipc, settings }: FeatureContext): void {
  registerStoreIpc(ipc, appStore(settings), settings);
}
