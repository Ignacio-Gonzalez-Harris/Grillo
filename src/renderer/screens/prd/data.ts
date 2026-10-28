/**
 * What the PRD view reads through the store: which project it shows, that project's kept PRD versions, and what is
 * still left on the map while no version exists.
 *
 * Store results are checked before they are drawn. Anything Grillo cannot read is refused with one `StoreError`
 * (`backend`), the only error the screen handles; it shows that error's message.
 */
import type { Store } from '../../../main/store/store';
import type { PrdVersion, ProjectId } from '../../../main/store/types';
import { StoreError } from '../../../shared/store';

const PROJECT_ID = /^[^/\s]+\/[^/\s]+$/;

function unreadable(what: string): never {
  throw new StoreError('backend', `Grillo could not read ${what} from the store.`);
}

const isText = (value: unknown): value is string => typeof value === 'string';

function isProjectId(value: unknown): value is ProjectId {
  return isText(value) && PROJECT_ID.test(value);
}

/**
 * The project the screen shows: the one it was opened with (`{ project: '<owner>/<repo>' }`), else the project opened
 * last, since the PRD tab opens with no parameters. Null when the member has opened no project yet.
 */
export async function projectToShow(store: Store, params: Readonly<Record<string, string>>): Promise<ProjectId | null> {
  const given = params['project'];
  if (isProjectId(given)) return given;
  const recent: unknown = await store.listRecentProjects();
  if (!Array.isArray(recent)) unreadable('the recent projects');
  const latest = (recent[0] as { project?: unknown } | null | undefined)?.project;
  return isProjectId(latest) ? latest : null;
}

export async function projectFolder(store: Store, project: ProjectId): Promise<string> {
  const folder: unknown = await store.openProjectFolder(project);
  if (!isText(folder) || folder === '') unreadable(`the folder of ${project}`);
  return folder;
}

function isVersion(value: unknown): value is PrdVersion {
  const version = value as Partial<Record<keyof PrdVersion, unknown>> | null;
  return (
    typeof version === 'object' &&
    version !== null &&
    Number.isInteger(version.number) &&
    (version.number as number) > 0 &&
    isText(version.date) &&
    isText(version.body) &&
    isText(version.appendix)
  );
}

/** Every kept version, newest first, each number once. */
export async function readVersions(store: Store, project: ProjectId): Promise<PrdVersion[]> {
  const listed: unknown = await store.listPrdVersions(project);
  if (!Array.isArray(listed) || !listed.every(isVersion)) unreadable(`the PRD versions of ${project}`);
  const byNumber = new Map<number, PrdVersion>();
  for (const version of listed) {
    if (!byNumber.has(version.number)) byNumber.set(version.number, version);
  }
  return [...byNumber.values()].sort((a, b) => b.number - a.number);
}

/** What keeps the map from being done: its open tickets and its fog items. */
export interface LeftOnMap {
  openTickets: number;
  fog: number;
}

/** What is left on the map, or null while the project has no map yet. */
export async function readLeftOnMap(store: Store, project: ProjectId): Promise<LeftOnMap | null> {
  let map: unknown;
  try {
    map = await store.getMap(project);
  } catch (error) {
    if (error instanceof StoreError && error.kind === 'not-found') return null;
    throw error;
  }
  const fog = (map as { fog?: unknown } | null)?.fog;
  if (!Array.isArray(fog)) unreadable(`the map of ${project}`);
  const tickets: unknown = await store.listTickets(project, { state: 'open' });
  if (!Array.isArray(tickets)) unreadable(`the tickets of ${project}`);
  return { openTickets: tickets.length, fog: fog.length };
}
