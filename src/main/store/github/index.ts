import type { Settings } from '../../app/settings';
import type { Gh } from '../gh';
import type { Store } from '../store';
import { createIssuesStore } from './issues';
import { createRepoStore } from './repo';

/** What both GitHub backends work with. */
export interface GithubDeps {
  gh: Gh;
  /** The app's settings file: recent projects live there. */
  settings: Settings;
}

/** The GitHub store: the repository backend and the issues backend together make up the whole interface. */
export function createGithubStore(deps: GithubDeps): Store {
  return { ...createRepoStore(deps), ...createIssuesStore(deps) };
}
