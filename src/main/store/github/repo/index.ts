import { StoreError, type Store, type StoreMethod } from '../../store';
import type { GithubDeps } from '..';

/**
 * The store methods kept in the repository itself: projects, members, invitations, the project folder
 * and the files of the Grillo folder (docs/store-layout.md). A stub until its backend story fills it.
 */
export const REPO_METHODS = [
  'currentMember',
  'viewerPermission',
  'listOrganisations',
  'listPendingInvitations',
  'acceptInvitation',
  'listProjects',
  'getProject',
  'createProject',
  'archiveProject',
  'unarchiveProject',
  'openProjectFolder',
  'listRecentProjects',
  'listMembers',
  'getMember',
  'addMember',
  'updateMember',
  'removeMember',
  'createSession',
  'getSession',
  'listSessions',
  'updateSession',
  'createSource',
  'getSource',
  'listSources',
  'getStructure',
  'updateStructure',
  'createPrdVersion',
  'getPrdVersion',
  'listPrdVersions',
  'getScore',
  'setScore',
] as const satisfies readonly StoreMethod[];

type RepoStore = Pick<Store, (typeof REPO_METHODS)[number]>;

export function createRepoStore(_deps: GithubDeps): RepoStore {
  const refuse = async (): Promise<never> => {
    throw new StoreError('not-implemented', 'The GitHub repository backend is not implemented yet');
  };
  return Object.fromEntries(REPO_METHODS.map((method) => [method, refuse])) as unknown as RepoStore;
}
