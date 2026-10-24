import type { Settings } from '../app/settings';
import type { IsoDateTime, ProjectId, RecentProject } from './types';

/** The settings key holding the recent projects: `[{ project: "<owner>/<repo>", lastOpened: "<ISO>" }]`. */
export const RECENT_PROJECTS_KEY = 'recentProjects';

function isRecentProject(entry: unknown): entry is RecentProject {
  const candidate = entry as Partial<RecentProject> | null;
  return typeof candidate?.project === 'string' && typeof candidate.lastOpened === 'string';
}

/** Last opened first. Entries of the wrong shape (a hand-edited or older settings file) are left out. */
export function readRecentProjects(settings: Settings): RecentProject[] {
  const stored = settings.get<unknown>(RECENT_PROJECTS_KEY, []);
  const entries = Array.isArray(stored) ? stored.filter(isRecentProject) : [];
  return entries
    .map(({ project, lastOpened }) => ({ project, lastOpened }))
    .sort((a, b) => b.lastOpened.localeCompare(a.lastOpened));
}

/** Records the project as opened now; each project appears once. */
export function recordRecentProject(settings: Settings, project: ProjectId, lastOpened: IsoDateTime): void {
  const others = readRecentProjects(settings).filter((entry) => entry.project !== project);
  settings.set(RECENT_PROJECTS_KEY, [{ project, lastOpened }, ...others]);
}
