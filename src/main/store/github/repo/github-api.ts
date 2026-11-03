/**
 * Every `gh` call the repository backend makes, each turning GitHub's answer into a typed value. A refusal
 * GitHub gives (not found, forbidden, invalid) becomes a `StoreError` of the matching kind; every other
 * failure stays the `GhError` (a `backend` refusal) the gh runner throws.
 */
import { GhError, type Gh } from '../../gh';
import { StoreError } from '../../store';
import type { Invitation, Login, Organisation, Permission, RepositoryAccess, RepositoryRef, RepositoryVisibility } from '../../types';
import { isLogin, projectIdOf, sameLogin } from './names';

/** What one repository read tells the backend. */
export interface RepositoryInfo {
  archived: boolean;
  issuesEnabled: boolean;
  /** The branch the Grillo folder lives on: the repository's default ("main"). */
  defaultBranch: string;
  permission: Permission;
  /** True for a repository Grillo created: in an organisation, every member invited to it becomes an admin (PRD section 7). */
  createdByGrillo: boolean;
  /** False only when GitHub says it is private: anyone can comment on a public repository, so the doubt counts as public. */
  isPublic: boolean;
  /** True when a user owns it, not an organisation: it has only an owner and collaborators, and invites take no permission. */
  personal: boolean;
}

export interface GithubIdentity {
  login: Login;
  name: string | null;
  email: string | null;
}

/** How many open pull requests one check reads; Grillo's own waiting saves are far fewer. */
const OPEN_PULL_REQUEST_LIMIT = 500;

/** The topic Grillo puts on every repository it creates (docs/store-layout.md). */
export const CREATED_BY_GRILLO_TOPIC = 'grillo-created';

/** The labels Grillo adds to every project repository (docs/store-layout.md, "Labels"). */
export const GRILLO_LABELS: readonly { name: string; description: string }[] = [
  { name: 'wayfinder:map', description: "The project's map" },
  { name: 'wayfinder:grilling', description: 'Ticket kind: grilling' },
  { name: 'wayfinder:research', description: 'Ticket kind: research' },
  { name: 'wayfinder:prototype', description: 'Ticket kind: prototype' },
  { name: 'wayfinder:task', description: 'Ticket kind: task' },
  { name: 'domain:none', description: 'Fits no member: open to anyone' },
];

/** One page is enough: nobody belongs to a hundred organisations or holds a hundred open invitations. */
const PAGE_SIZE = 100;
const PAGE = `per_page=${PAGE_SIZE}`;
const HTTP_STATUS = /\(HTTP (\d{3})\)/;
const REPOSITORY_MISSING = /Could not resolve to a Repository/i;
const ALREADY_EXISTS = /already exists/i;
const NOT_FOUND = 404;
const FORBIDDEN = 403;
/** GitHub's `owner.type` of a repository a person owns. */
const USER_ACCOUNT = 'User';
const UNPROCESSABLE = 422;

type Refusals = Partial<Record<'notFound' | 'forbidden' | 'invalid' | 'conflict', string>>;

function statusOf(error: GhError): number | null {
  const match = HTTP_STATUS.exec(error.stderr);
  return match ? Number(match[1]) : null;
}

/** Turns the refusals GitHub gives into store refusals with a message the member can act on. */
async function refusing<T>(call: Promise<T>, refusals: Refusals): Promise<T> {
  try {
    return await call;
  } catch (error) {
    if (!(error instanceof GhError) || error.reason !== 'api-error') {
      throw error;
    }
    const status = statusOf(error);
    if (refusals.notFound && (status === NOT_FOUND || REPOSITORY_MISSING.test(error.stderr))) {
      throw new StoreError('not-found', refusals.notFound);
    }
    if (refusals.forbidden && status === FORBIDDEN) {
      throw new StoreError('forbidden', refusals.forbidden);
    }
    if (refusals.conflict && ALREADY_EXISTS.test(error.stderr)) {
      throw new StoreError('conflict', refusals.conflict);
    }
    if (refusals.invalid && status === UNPROCESSABLE) {
      throw new StoreError('invalid', `${refusals.invalid}: ${error.stderr.trim()}`);
    }
    throw error;
  }
}

/** The call's answer, or `fallback` when GitHub answers that the thing is not there. */
async function unlessMissing<T>(call: Promise<T>, fallback: T): Promise<T> {
  try {
    return await refusing(call, { notFound: 'missing' });
  } catch (error) {
    if (error instanceof StoreError && error.kind === 'not-found') {
      return fallback;
    }
    throw error;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function object(value: unknown, what: string): Record<string, unknown> {
  if (!isObject(value)) {
    throw new Error(`expected ${what} as an object`);
  }
  return value;
}

function list(value: unknown, what: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`expected a list of ${what}`);
  }
  return value;
}

function login(value: unknown, what: string): Login {
  if (!isLogin(value)) {
    throw new Error(`expected ${what} to be a GitHub login`);
  }
  return value;
}

const optionalText = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);

function repositoryRef(value: unknown): RepositoryRef {
  const repository = object(value, 'a repository');
  const name = repository.name;
  if (typeof name !== 'string' || name === '') {
    throw new Error('expected a repository name');
  }
  return { owner: login(object(repository.owner, 'a repository owner').login, 'the owner'), name };
}

function permissionOf(permissions: Record<string, unknown>): Permission {
  if (permissions.admin === true) {
    return 'admin';
  }
  return permissions.push === true || permissions.maintain === true ? 'write' : 'read';
}

function parsePullRequestUrls(value: unknown): string[] {
  return list(value, 'pull requests').map((entry) => {
    const url = object(entry, 'a pull request').url;
    if (typeof url !== 'string' || url === '') {
      throw new Error('expected every pull request to carry its address');
    }
    return url;
  });
}

function parseRepository(value: unknown): RepositoryInfo {
  const repository = object(value, 'a repository');
  const { archived, has_issues: issues, default_branch: branch, topics = [] } = repository;
  if (typeof archived !== 'boolean' || typeof issues !== 'boolean' || typeof branch !== 'string' || branch === '') {
    throw new Error('expected archived, has_issues and default_branch');
  }
  return {
    archived,
    issuesEnabled: issues,
    defaultBranch: branch,
    permission: permissionOf(object(repository.permissions, 'the permissions')),
    createdByGrillo: list(topics, 'topics').includes(CREATED_BY_GRILLO_TOPIC),
    isPublic: repository.private !== true,
    personal: isObject(repository.owner) && repository.owner.type === USER_ACCOUNT,
  };
}

function parseIdentity(value: unknown): GithubIdentity {
  const user = object(value, 'a user');
  return { login: login(user.login, 'the user'), name: optionalText(user.name), email: optionalText(user.email) };
}

function parsePrimaryEmail(value: unknown): string | null {
  const primary = list(value, 'emails').find((entry) => isObject(entry) && entry.primary === true);
  return isObject(primary) ? optionalText(primary.email) : null;
}

function parseOrganisations(value: unknown): Organisation[] {
  return list(value, 'organisations').map((entry) => ({ login: login(object(entry, 'an organisation').login, 'the organisation'), name: null }));
}

/** One page of the member's repositories, the archived ones still in it: only a short page is the last page. */
function parseRepositoryPage(value: unknown): (RepositoryAccess & { archived: boolean })[] {
  return list(value, 'repositories').map((entry) => {
    const repository = object(entry, 'a repository');
    if (typeof repository.archived !== 'boolean') {
      throw new Error('expected archived');
    }
    return {
      repository: repositoryRef(repository),
      permission: permissionOf(object(repository.permissions, 'the permissions')),
      archived: repository.archived,
    };
  });
}

function parseInvitations(value: unknown): Invitation[] {
  return list(value, 'invitations').map((entry) => {
    const invitation = object(entry, 'an invitation');
    const { id, created_at: createdAt } = invitation;
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || typeof createdAt !== 'string') {
      throw new Error('expected an invitation id and created_at');
    }
    return {
      id,
      repository: repositoryRef(invitation.repository),
      inviter: login(object(invitation.inviter, 'the inviter').login, 'the inviter'),
      createdAt,
    };
  });
}

/** The pending invitations of one repository: invitation id and invitee login. */
function parseRepositoryInvitations(value: unknown): { id: number; invitee: Login }[] {
  return list(value, 'invitations').map((entry) => {
    const invitation = object(entry, 'an invitation');
    if (typeof invitation.id !== 'number') {
      throw new Error('expected an invitation id');
    }
    return { id: invitation.id, invitee: login(object(invitation.invitee, 'the invitee').login, 'the invitee') };
  });
}

const repoPath = (ref: RepositoryRef): string => `repos/${ref.owner}/${ref.name}`;

export type GithubApi = ReturnType<typeof createGithubApi>;

export function createGithubApi(gh: Gh) {
  const account = (member: Login): Promise<GithubIdentity | null> =>
    unlessMissing(gh.json(['api', `users/${member}`], parseIdentity), null);

  return {
    /** The signed-in member; a private email is asked for once more, and stays null when GitHub keeps it. */
    async identity(): Promise<GithubIdentity> {
      const identity = await gh.json(['api', 'user'], parseIdentity);
      if (identity.email !== null) {
        return identity;
      }
      const email = await gh.json(['api', 'user/emails'], parsePrimaryEmail).catch(() => null);
      return { ...identity, email };
    },

    /** The account behind a login, with the login as GitHub spells it; null when there is no such account. */
    account,

    /** Another member's public name and email; both null when the account no longer exists. */
    async profile(member: Login): Promise<Omit<GithubIdentity, 'login'>> {
      const found = await account(member);
      return { name: found?.name ?? null, email: found?.email ?? null };
    },

    organisations(): Promise<Organisation[]> {
      return gh.json(['api', `user/orgs?${PAGE}`], parseOrganisations);
    },

    /** Page by page, unlike the lists above: a member of a large organisation reaches hundreds of repositories. */
    async repositories(): Promise<RepositoryAccess[]> {
      const found: RepositoryAccess[] = [];
      for (let page = 1; ; page += 1) {
        const entries = await gh.json(['api', `user/repos?${PAGE}&page=${page}`], parseRepositoryPage);
        for (const { repository, permission, archived } of entries) {
          if (!archived) found.push({ repository, permission });
        }
        if (entries.length < PAGE_SIZE) return found;
      }
    },

    invitations(): Promise<Invitation[]> {
      return gh.json(['api', `user/repository_invitations?${PAGE}`], parseInvitations);
    },

    async acceptInvitation(id: number): Promise<void> {
      await refusing(gh.text(['api', '--method', 'PATCH', `user/repository_invitations/${id}`]), {
        notFound: `No pending invitation ${id}`,
      });
    },

    repository(ref: RepositoryRef): Promise<RepositoryInfo> {
      return refusing(gh.json(['api', repoPath(ref)], parseRepository), {
        notFound: `No repository ${projectIdOf(ref)}, or you have no access to it`,
      });
    },

    /** A new repository with a first commit on its default branch, marked as created by Grillo. */
    async createRepository(ref: RepositoryRef, visibility: RepositoryVisibility): Promise<void> {
      const id = projectIdOf(ref);
      await refusing(gh.text(['repo', 'create', id, visibility === 'public' ? '--public' : '--private', '--add-readme']), {
        conflict: `Repository ${id} already exists`,
        notFound: `No account or organisation ${ref.owner}, or you cannot create repositories under it`,
        forbidden: `You may not create repositories under ${ref.owner}`,
      });
      await gh.text(['repo', 'edit', id, '--add-topic', CREATED_BY_GRILLO_TOPIC]);
    },

    /** Creates Grillo's labels, or refreshes their descriptions when the repository already has them. */
    async addLabels(ref: RepositoryRef): Promise<void> {
      for (const label of GRILLO_LABELS) {
        await gh.text(['label', 'create', label.name, '--repo', projectIdOf(ref), '--description', label.description, '--force']);
      }
    },

    /**
     * A repository collaborator invitation; GitHub adds an existing collaborator's new permission directly. `permission`
     * is null for a personal repository: GitHub's `permission` is "only valid on organization-owned repositories".
     */
    async invite(ref: RepositoryRef, member: Login, permission: 'admin' | 'push' | null): Promise<void> {
      const fields = permission === null ? [] : ['-f', `permission=${permission}`];
      await refusing(gh.text(['api', '--method', 'PUT', `${repoPath(ref)}/collaborators/${member}`, ...fields]), {
        notFound: `No GitHub account ${member}`,
        forbidden: `GitHub refused to invite ${member} to ${projectIdOf(ref)}`,
        invalid: `GitHub refused to invite ${member}`,
      });
    },

    /** Withdraws a pending invitation and removes the collaborator; either may already be gone. */
    async uninvite(ref: RepositoryRef, member: Login): Promise<void> {
      const pending = await gh.json(['api', `${repoPath(ref)}/invitations?${PAGE}`], parseRepositoryInvitations);
      for (const invitation of pending.filter((entry) => sameLogin(entry.invitee, member))) {
        await gh.text(['api', '--method', 'DELETE', `${repoPath(ref)}/invitations/${invitation.id}`]);
      }
      await unlessMissing(gh.text(['api', '--method', 'DELETE', `${repoPath(ref)}/collaborators/${member}`]), '');
    },

    async setArchived(ref: RepositoryRef, archived: boolean): Promise<void> {
      await gh.text(['api', '--method', 'PATCH', repoPath(ref), '-F', `archived=${archived}`]);
    },

    /** Opens a pull request and returns its address. */
    async openPullRequest(ref: RepositoryRef, change: { base: string; head: string; title: string; body: string }): Promise<string> {
      const url = await gh.text([
        'pr',
        'create',
        '--repo',
        projectIdOf(ref),
        '--base',
        change.base,
        '--head',
        change.head,
        '--title',
        change.title,
        '--body',
        change.body,
      ]);
      return url.trim();
    },

    /** The addresses of the repository's open pull requests, to tell which of Grillo's saves still wait. */
    openPullRequestUrls(ref: RepositoryRef): Promise<string[]> {
      return gh.json(
        ['pr', 'list', '--repo', projectIdOf(ref), '--state', 'open', '--json', 'url', '--limit', String(OPEN_PULL_REQUEST_LIMIT)],
        parsePullRequestUrls,
      );
    },
  };
}
