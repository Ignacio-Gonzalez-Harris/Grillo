import type { GrilloApi } from '../../shared/ipc';
import type { AgentId } from '../../shared/agents';

/** What a screen is opened with, such as `{ agentId: 'a1' }` for an agent's tab. */
export type ScreenParams = Readonly<Record<string, string>>;

/** What the shell hands every screen when it mounts it. */
export interface ShellContext {
  /** The renderer's only way to reach the main process (`window.grillo`). */
  grillo: GrilloApi;
  /** Opens another screen in the shell's content area. */
  navigate(screenId: string, params?: ScreenParams): void;
  /** The empty element inside an agent's tab, beside its name and waiting dot, where a header control mounts. */
  agentTabHeader(agentId: AgentId): HTMLElement | undefined;
}

/**
 * The contract of `src/renderer/screens/<name>/index.ts`: named exports `id`, `title` and `mount`.
 * `mount` may return a function the shell calls when the member leaves the screen.
 */
export interface ScreenModule {
  id: string;
  title: string;
  mount(el: HTMLElement, params: ScreenParams, shell: ShellContext): void | (() => void);
}

export type ScreenRegistry = ReadonlyMap<string, ScreenModule>;

const SCREEN_FOLDER = /([^/\\]+)[/\\]index\.ts$/;

function folderName(path: string): string {
  const match = SCREEN_FOLDER.exec(path);
  if (!match) {
    throw new Error(`Screen module path '${path}' does not end in <screen>/index.ts`);
  }
  return match[1];
}

function isScreenModule(module: unknown): module is ScreenModule {
  const candidate = module as Partial<ScreenModule> | null;
  return (
    typeof candidate?.id === 'string' &&
    candidate.id !== '' &&
    typeof candidate.title === 'string' &&
    typeof candidate.mount === 'function'
  );
}

/** Builds the registry from discovered modules, keyed by screen id, in folder-name order. */
export function registerScreens(modules: Record<string, unknown>): ScreenRegistry {
  const folders = Object.entries(modules)
    .map(([path, module]) => ({ folder: folderName(path), module }))
    .sort((a, b) => a.folder.localeCompare(b.folder));

  const registry = new Map<string, ScreenModule>();
  const folderOf = new Map<string, string>();
  for (const { folder, module } of folders) {
    if (!isScreenModule(module)) {
      throw new Error(`Screen folder '${folder}' must export id, title and mount(el, params) from its index.ts`);
    }
    const earlier = folderOf.get(module.id);
    if (earlier !== undefined) {
      throw new Error(`Screen id '${module.id}' is registered by both '${earlier}' and '${folder}'`);
    }
    folderOf.set(module.id, folder);
    registry.set(module.id, module);
  }
  return registry;
}

/**
 * Finds every `src/renderer/screens/<name>/index.ts` at build time, so a new screen is a new folder and never an
 * edit to the shell. `@screens` is an alias set in electron.vite.config.mts (and pointed at a fixture folder in
 * vitest.config.mts).
 */
export function loadScreens(): ScreenRegistry {
  return registerScreens(import.meta.glob('@screens/*/index.ts', { eager: true }));
}
