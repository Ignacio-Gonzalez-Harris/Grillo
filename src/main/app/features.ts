import type { MainIpc } from '../ipc/bridge';
import type { Settings } from './settings';

/** What main hands every feature when it starts. */
export interface FeatureContext {
  ipc: MainIpc;
  settings: Settings;
}

/** The contract of `src/main/features/<name>/ipc.ts`. */
export interface FeatureModule {
  register(context: FeatureContext): void;
}

const FEATURE_FOLDER = /([^/\\]+)[/\\]ipc\.ts$/;

function featureName(path: string): string {
  const match = FEATURE_FOLDER.exec(path);
  if (!match) {
    throw new Error(`Feature module path '${path}' does not end in <feature>/ipc.ts`);
  }
  return match[1];
}

function isFeatureModule(module: unknown): module is FeatureModule {
  return typeof (module as Partial<FeatureModule> | null)?.register === 'function';
}

/** Registers every discovered feature, in folder-name order, and returns the names registered. */
export function registerFeatures(modules: Record<string, unknown>, context: FeatureContext): string[] {
  const features = Object.entries(modules)
    .map(([path, module]) => ({ name: featureName(path), module }))
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const { name, module } of features) {
    if (!isFeatureModule(module)) {
      throw new Error(`Feature '${name}' must export a register(context) function from its ipc.ts`);
    }
    module.register(context);
  }
  return features.map(({ name }) => name);
}

/**
 * Finds every `src/main/features/<name>/ipc.ts` at build time, so a new feature is a new folder and
 * never an edit to a shared file. `@features` is an alias set in electron.vite.config.mts (and pointed
 * at a fixture folder in vitest.config.mts).
 */
export function loadFeatures(context: FeatureContext): string[] {
  return registerFeatures(import.meta.glob('@features/*/ipc.ts', { eager: true }), context);
}
