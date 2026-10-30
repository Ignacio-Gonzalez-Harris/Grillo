import type { Settings } from '../app/settings';
import { createGh, type Gh } from './gh';
import { createGithubStore } from './github';
import { createMemoryStore } from './memory';
import type { PullRequestNotice, Store } from './store';

export type StoreKind = 'memory' | 'github';

export interface StoreOptions {
  settings: Settings;
  /** The GitHub CLI runner; the real `gh` when left out. */
  gh?: Gh;
  /** Told when a save became a pull request because main is protected; the memory store never saves that way. */
  onPullRequest?: (notice: PullRequestNotice) => void;
}

/** The one place a backend is chosen; everything else sees only `Store`. */
export function createStore(kind: StoreKind, { settings, gh = createGh(), onPullRequest }: StoreOptions): Store {
  return kind === 'memory' ? createMemoryStore({ settings }) : createGithubStore({ gh, settings, onPullRequest });
}

/** The env variable that picks the backend; GitHub when unset. */
export const STORE_KIND_VARIABLE = 'GRILLO_STORE';

export function storeKindFrom(env: Record<string, string | undefined>): StoreKind {
  const value = env[STORE_KIND_VARIABLE];
  if (value === undefined || value === '' || value === 'github') {
    return 'github';
  }
  if (value === 'memory') {
    return 'memory';
  }
  throw new Error(`${STORE_KIND_VARIABLE} must be 'memory' or 'github', got '${value}'`);
}
