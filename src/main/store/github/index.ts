import type { Settings } from '../../app/settings';
import type { Gh, ProcessRunner } from '../gh';
import type { Store } from '../store';
import { createIssuesStore } from './issues';
import { createRepoStore } from './repo';
import type { PullRequestNotice } from './repo/folder';

/** What both GitHub backends work with. */
export interface GithubDeps {
  gh: Gh;
  /** The app's settings file: recent projects live there. */
  settings: Settings;
  /** Runs git in the project folders; the real git when left out. */
  git?: ProcessRunner;
  /** Where project folders live: `<folderRoot>/<owner>/<repo>`; `~/Grillo` when left out. */
  folderRoot?: string;
  /** The clock; the system clock when left out. */
  now?: () => Date;
  /** Told when a save reached a protected main as a pull request instead of a direct push. */
  onPullRequest?: (notice: PullRequestNotice) => void;
}

/** The GitHub store: the repository backend and the issues backend together make up the whole interface. */
export function createGithubStore(deps: GithubDeps): Store {
  return { ...createRepoStore(deps), ...createIssuesStore(deps) };
}
