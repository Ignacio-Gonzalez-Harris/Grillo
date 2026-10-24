import { homedir } from 'node:os';
import { join } from 'node:path';
import { runProcess } from '../../gh';
import { DEFAULT_PRD_STRUCTURE } from '../../defaults';
import { readRecentProjects, recordRecentProject } from '../../recent-projects';
import { StoreError, type NewMember, type Store, type StoreMethod } from '../../store';
import type { Member, PrdStructure, PrdVersion, Project, ProjectId, RepositoryRef, Score } from '../../types';
import type { GithubDeps } from '..';
import { createProjectFolders, type FolderReader, type SavePlan } from './folder';
import { createGithubApi, type RepositoryInfo } from './github-api';
import {
  GRILLO_FILES,
  isLogin,
  isRepositoryName,
  isSessionId,
  isVersionNumber,
  numbersIn,
  projectIdOf,
  repositoryOf,
  sameLogin,
  sessionIdOf,
  sourceNumberOf,
} from './names';
import {
  formatMembers,
  formatPrdVersion,
  formatScore,
  formatSession,
  formatSource,
  formatStructure,
  holdsAppendixMarker,
  parseMembers,
  parsePrdVersion,
  parseScore,
  parseSession,
  parseSource,
  parseStructure,
  SOURCE_KINDS,
  type MemberLine,
} from './records';

/**
 * The store methods kept in the repository itself: projects, members, invitations, the project folder
 * and the files of the Grillo folder (docs/store-layout.md).
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

/** Project folders live at `~/Grillo/<owner>/<repo>` unless told otherwise. */
export const DEFAULT_FOLDER_ROOT = join(homedir(), 'Grillo');
const LOWEST_MARK = 0;
const HIGHEST_MARK = 10;

function refuse(kind: ConstructorParameters<typeof StoreError>[0], message: string): never {
  throw new StoreError(kind, message);
}

/** Every section a name and a note, both text, as `structure.json` must hold them. */
function checkStructure(structure: PrdStructure): void {
  const sections: unknown[] = Array.isArray(structure?.sections) ? structure.sections : [];
  const names = sections.map((section) => {
    const { name, note } = fieldsOf(section as PrdStructure['sections'][number], 'a PRD section');
    checkText(note, 'note');
    return checkText(name, 'name').trim();
  });
  if (names.length === 0 || names.some((name) => name === '')) {
    refuse('invalid', 'A PRD structure needs at least one section, and every section a name');
  }
  if (new Set(names).size !== names.length) {
    refuse('invalid', 'Two PRD sections cannot share a name');
  }
}

/** The fields of an argument that arrived over IPC; anything but an object is refused. */
function fieldsOf<T extends object>(value: T | null | undefined, what: string): Partial<T> {
  if (typeof value !== 'object' || value === null) {
    refuse('invalid', `Expected ${what}`);
  }
  return value;
}

function checkText(value: unknown, field: string): string {
  return typeof value === 'string' ? value : refuse('invalid', `'${field}' must be text`);
}

function checkLogins(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every(isLogin)) {
    refuse('invalid', 'Expected a list of GitHub logins');
  }
  return [...value];
}

function checkScore(score: Score): void {
  const { overall, criteria, sections } = fieldsOf(score, 'a score');
  if (!Array.isArray(criteria) || !Array.isArray(sections) || [...criteria, ...sections].some((item) => typeof item !== 'object' || item === null)) {
    refuse('invalid', 'A score needs its criteria and sections lists');
  }
  for (const item of [...criteria, ...sections]) {
    checkText(item.name, 'name');
    checkText(item.comment, 'comment');
  }
  const marks = [overall, ...criteria.map((item) => item.mark), ...sections.map((item) => item.mark)];
  if (marks.some((mark) => typeof mark !== 'number' || !Number.isFinite(mark) || mark < LOWEST_MARK || mark > HIGHEST_MARK)) {
    refuse('invalid', `Every mark must be a number from ${LOWEST_MARK} to ${HIGHEST_MARK}`);
  }
}

function checkDomains(domains: unknown): string[] {
  if (!Array.isArray(domains) || domains.some((domain) => typeof domain !== 'string')) {
    refuse('invalid', 'Domains must be a list of text');
  }
  return [...domains];
}

function lineOf(lines: MemberLine[], login: unknown): MemberLine | undefined {
  return typeof login === 'string' ? lines.find((line) => sameLogin(line.login, login)) : undefined;
}

/** The members' logins as the members file spells them; a login of no member is refused. */
function memberLoginsOf(lines: MemberLine[], logins: string[], id: ProjectId): string[] {
  return logins.map((login) => lineOf(lines, login)?.login ?? refuse('invalid', `${login} is not a member of ${id}`));
}

const noGrilloProject = (id: ProjectId): never => refuse('not-found', `${id} holds no Grillo project`);

/** Admin-only actions are refused with the reason the screen shows next to the greyed-out control. */
function checkAdmin(repository: RepositoryInfo, id: ProjectId, action: string): void {
  if (repository.permission !== 'admin') {
    refuse('forbidden', `Only an admin of the repository ${id} may ${action}; ask one of its admins`);
  }
}

export function createRepoStore(deps: GithubDeps): RepoStore {
  const { gh, settings } = deps;
  const now = deps.now ?? (() => new Date());
  const api = createGithubApi(gh);
  const folders = createProjectFolders({
    gh,
    api,
    git: deps.git ?? runProcess,
    root: deps.folderRoot ?? DEFAULT_FOLDER_ROOT,
    now,
    onPullRequest: deps.onPullRequest ?? (() => undefined),
  });
  const timestamp = (): string => now().toISOString();

  async function writable(ref: RepositoryRef): Promise<RepositoryInfo> {
    const repository = await api.repository(ref);
    if (repository.archived) {
      refuse('read-only', `Project ${projectIdOf(ref)} is closed (its repository is archived): unarchive it to change anything`);
    }
    return repository;
  }

  async function memberLines(files: FolderReader, id: ProjectId): Promise<MemberLine[]> {
    return parseMembers((await files.read(GRILLO_FILES.members)) ?? noGrilloProject(id), GRILLO_FILES.members);
  }

  async function structureOf(files: FolderReader, id: ProjectId): Promise<PrdStructure> {
    return parseStructure((await files.read(GRILLO_FILES.structure)) ?? noGrilloProject(id), GRILLO_FILES.structure);
  }

  async function withProfile(line: MemberLine): Promise<Member> {
    const { name, email } = await api.profile(line.login);
    return { login: line.login, name, email, role: line.role, domains: [...line.domains] };
  }

  const withProfiles = (lines: MemberLine[]): Promise<Member[]> => Promise.all(lines.map(withProfile));

  async function readProject(ref: RepositoryRef, repository: RepositoryInfo): Promise<Project> {
    const id = projectIdOf(ref);
    const { structure, lines } = await folders.reading(ref, async (files) => ({
      structure: await structureOf(files, id),
      lines: await memberLines(files, id),
    }));
    return { id, name: ref.name, repository: ref, structure, members: await withProfiles(lines), archived: repository.archived };
  }

  /** Labels, then the members file (the signed-in member alone) and the structure, saved to main. */
  async function startProject(ref: RepositoryRef, repository: RepositoryInfo, structure: PrdStructure): Promise<Project> {
    const me = await api.identity();
    const lines: MemberLine[] = [{ login: me.login, role: '', domains: [] }];
    await api.addLabels(ref);
    await folders.saving(ref, repository.defaultBranch, async () => ({
      changes: [
        { path: GRILLO_FILES.members, content: formatMembers(lines) },
        { path: GRILLO_FILES.structure, content: formatStructure(structure) },
      ],
      message: 'grillo: start the project',
      result: undefined,
    }));
    const members: Member[] = [{ ...me, role: '', domains: [] }];
    return { id: projectIdOf(ref), name: ref.name, repository: ref, structure, members, archived: false };
  }

  /** A save to an open project's main branch. */
  async function save<T>(id: ProjectId, plan: (files: FolderReader) => Promise<SavePlan<T>>): Promise<T> {
    const ref = repositoryOf(id);
    const { defaultBranch } = await writable(ref);
    return folders.saving(ref, defaultBranch, plan);
  }

  function read<T>(id: ProjectId, work: (files: FolderReader) => Promise<T>): Promise<T> {
    return folders.reading(repositoryOf(id), work);
  }

  async function sessionIn(files: FolderReader, sessionId: string) {
    const path = GRILLO_FILES.session(sessionId);
    const content = isSessionId(sessionId) ? await files.read(path) : null;
    return parseSession(content ?? refuse('not-found', `No session ${String(sessionId)}`), sessionId, path);
  }

  async function versionIn(files: FolderReader, number: number): Promise<PrdVersion> {
    const path = GRILLO_FILES.version(number);
    const content = isVersionNumber(number) ? await files.read(path) : null;
    const version = parsePrdVersion(content ?? refuse('not-found', `No PRD version ${String(number)}`), path);
    const score = await files.read(GRILLO_FILES.score(number));
    return { ...version, number, score: score === null ? null : parseScore(score, GRILLO_FILES.score(number)) };
  }

  async function nextNumber(files: FolderReader, folder: string, prefix: string, suffix: string): Promise<number> {
    return Math.max(0, ...numbersIn(await files.list(folder), prefix, suffix)) + 1;
  }

  return {
    async currentMember(id) {
      const lines = await read(id, (files) => memberLines(files, id));
      const me = await api.identity();
      const line = lineOf(lines, me.login);
      return { ...me, role: line?.role ?? '', domains: line?.domains ?? [] };
    },
    async viewerPermission(id) {
      return (await api.repository(repositoryOf(id))).permission;
    },
    listOrganisations: () => api.organisations(),
    listPendingInvitations: () => api.invitations(),
    async acceptInvitation(id) {
      if (!Number.isSafeInteger(id)) {
        refuse('invalid', `'${String(id)}' is not an invitation id`);
      }
      await api.acceptInvitation(id);
    },

    /** The projects this laptop knows: the recent projects, minus any whose repository is gone or closed to the member. */
    async listProjects() {
      const projects: Project[] = [];
      for (const { project } of readRecentProjects(settings)) {
        try {
          const ref = repositoryOf(project);
          projects.push(await readProject(ref, await api.repository(ref)));
        } catch (error) {
          if (!(error instanceof StoreError) || !['not-found', 'forbidden', 'invalid'].includes(error.kind)) {
            throw error;
          }
        }
      }
      return projects;
    },
    async getProject(id) {
      const ref = repositoryOf(id);
      return readProject(ref, await api.repository(ref));
    },
    async createProject(input) {
      fieldsOf(input, 'a new or a connected repository');
      const structure = input.structure ?? DEFAULT_PRD_STRUCTURE;
      checkStructure(structure);
      if ('newRepository' in input) {
        const { organisation, name } = input.newRepository;
        if (!isLogin(organisation)) {
          refuse('invalid', `'${String(organisation)}' is not an organisation`);
        }
        if (!isRepositoryName(name)) {
          refuse('invalid', `'${String(name)}' is not a repository name: letters, digits, '.', '-' and '_' only`);
        }
        const ref = { owner: organisation, name };
        await api.createRepository(ref);
        return startProject(ref, await api.repository(ref), structure);
      }
      const ref = repositoryOf(projectIdOf(input.connectRepository ?? { owner: '', name: '' }));
      const id = projectIdOf(ref);
      const repository = await api.repository(ref);
      if (repository.permission === 'read') {
        refuse('forbidden', `Connecting ${id} needs write access; you have read access`);
      }
      if (!repository.issuesEnabled) {
        refuse('invalid', `Issues are turned off in ${id}: turn them on in the repository settings, then connect again`);
      }
      const existing = await folders.reading(ref, (files) => files.read(GRILLO_FILES.structure));
      if (existing !== null) {
        return readProject(ref, repository);
      }
      if (repository.archived) {
        refuse('read-only', `${id} is archived: unarchive it before connecting it`);
      }
      return startProject(ref, repository, structure);
    },
    async archiveProject(id) {
      const ref = repositoryOf(id);
      checkAdmin(await api.repository(ref), id, 'close the project');
      await api.setArchived(ref, true);
    },
    async unarchiveProject(id) {
      const ref = repositoryOf(id);
      checkAdmin(await api.repository(ref), id, 'reopen the project');
      await api.setArchived(ref, false);
    },
    async openProjectFolder(id) {
      const folder = await folders.open(repositoryOf(id));
      recordRecentProject(settings, id, timestamp());
      return folder;
    },
    async listRecentProjects() {
      return readRecentProjects(settings);
    },

    async listMembers(id) {
      return withProfiles(await read(id, (files) => memberLines(files, id)));
    },
    async getMember(id, login) {
      const lines = await read(id, (files) => memberLines(files, id));
      return withProfile(lineOf(lines, login) ?? refuse('not-found', `${String(login)} is not a member of ${id}`));
    },
    async addMember(id, member: NewMember) {
      const ref = repositoryOf(id);
      const repository = await writable(ref);
      checkAdmin(repository, id, 'invite people');
      const { login, role } = fieldsOf(member, 'a new member');
      if (!isLogin(login)) {
        refuse('invalid', `'${String(login)}' is not a GitHub login`);
      }
      const fields = { role: checkText(role, 'role'), domains: checkDomains(member.domains) };
      const lines = await folders.reading(ref, (files) => memberLines(files, id));
      if (lineOf(lines, login)) {
        refuse('conflict', `${login} is already a member of ${id}`);
      }
      const account = (await api.account(login)) ?? refuse('invalid', `No GitHub account ${login}`);
      const line: MemberLine = { login: account.login, ...fields };
      await api.invite(ref, account.login, repository.createdByGrillo ? 'admin' : 'push');
      await folders.saving(ref, repository.defaultBranch, async (files) => {
        const others = (await memberLines(files, id)).filter((entry) => !sameLogin(entry.login, account.login));
        return { changes: [{ path: GRILLO_FILES.members, content: formatMembers([...others, line]) }], message: `grillo: add member ${account.login}`, result: undefined };
      });
      return { ...account, ...fields };
    },
    async updateMember(id, login, patch) {
      const { role, domains: newDomains } = fieldsOf(patch, 'the member fields to change');
      const domains = newDomains === undefined ? undefined : checkDomains(newDomains);
      const updated = await save(id, async (files) => {
        const lines = await memberLines(files, id);
        const line = lineOf(lines, login) ?? refuse('not-found', `${String(login)} is not a member of ${id}`);
        const next: MemberLine = { ...line, role: role === undefined ? line.role : checkText(role, 'role'), domains: domains ?? line.domains };
        const content = formatMembers(lines.map((entry) => (entry === line ? next : entry)));
        return { changes: [{ path: GRILLO_FILES.members, content }], message: `grillo: update member ${login}`, result: next };
      });
      return withProfile(updated);
    },
    async removeMember(id, login) {
      const ref = repositoryOf(id);
      const repository = await writable(ref);
      checkAdmin(repository, id, 'remove people');
      const removed = await folders.saving(ref, repository.defaultBranch, async (files) => {
        const lines = await memberLines(files, id);
        const line = lineOf(lines, login) ?? refuse('not-found', `${String(login)} is not a member of ${id}`);
        const content = formatMembers(lines.filter((entry) => entry !== line));
        return { changes: [{ path: GRILLO_FILES.members, content }], message: `grillo: remove member ${line.login}`, result: line.login };
      });
      await api.uninvite(ref, removed);
    },

    async createSession(id, session) {
      const logins = checkLogins(fieldsOf(session, 'a new session').present);
      return save(id, async (files) => {
        const present = memberLoginsOf(await memberLines(files, id), logins, id);
        const started = now();
        const sessionId = sessionIdOf(started);
        if ((await files.read(GRILLO_FILES.session(sessionId))) !== null) {
          refuse('conflict', `A session named ${sessionId} already exists`);
        }
        const session = { id: sessionId, date: started.toISOString(), present: [...present], consent: null, transcript: '' };
        return { changes: [{ path: GRILLO_FILES.session(sessionId), content: formatSession(session) }], message: `grillo: start session ${sessionId}`, result: session };
      });
    },
    async getSession(id, sessionId) {
      return read(id, (files) => sessionIn(files, sessionId));
    },
    async listSessions(id) {
      return read(id, async (files) => {
        const ids = (await files.list(GRILLO_FILES.sessions)).map((name) => name.replace(/\.md$/, '')).filter(isSessionId).sort();
        return Promise.all(ids.map((sessionId) => sessionIn(files, sessionId)));
      });
    },
    async updateSession(id, sessionId, patch) {
      const { consent, present, transcript } = fieldsOf(patch, 'the session fields to change');
      if (present !== undefined) {
        checkLogins(present);
      }
      if (transcript !== undefined) {
        checkText(transcript, 'transcript');
      }
      const host = consent ? (await api.identity()).login : null;
      return save(id, async (files) => {
        const session = await sessionIn(files, sessionId);
        if (present !== undefined) {
          session.present = memberLoginsOf(await memberLines(files, id), present, id);
        }
        if (transcript !== undefined) {
          session.transcript = transcript;
        }
        if (host !== null) {
          session.consent = { by: host, at: timestamp() };
        }
        return { changes: [{ path: GRILLO_FILES.session(sessionId), content: formatSession(session) }], message: `grillo: update session ${sessionId}`, result: session };
      });
    },

    async createSource(id, input) {
      const { kind, who, when, where, text } = fieldsOf(input, 'a new source');
      if (kind === undefined || !SOURCE_KINDS.includes(kind)) {
        refuse('invalid', `'${String(kind)}' is not a source kind`);
      }
      const fields = { who: checkText(who, 'who'), when: checkText(when, 'when'), where: checkText(where, 'where'), text: checkText(text, 'text') };
      return save(id, async (files) => {
        const number = await nextNumber(files, GRILLO_FILES.sources, 'S', '.md');
        const source = { code: `S${number}`, kind, ...fields };
        return { changes: [{ path: GRILLO_FILES.source(number), content: formatSource(source) }], message: `grillo: add source ${source.code}`, result: source };
      });
    },
    async getSource(id, code) {
      return read(id, async (files) => {
        const number = sourceNumberOf(code);
        const content = number === null ? null : await files.read(GRILLO_FILES.source(number));
        return parseSource(content ?? refuse('not-found', `No source ${String(code)}`), code, GRILLO_FILES.source(number ?? 0));
      });
    },
    async listSources(id) {
      return read(id, async (files) => {
        const numbers = numbersIn(await files.list(GRILLO_FILES.sources), 'S', '.md');
        return Promise.all(
          numbers.map(async (number) => parseSource((await files.read(GRILLO_FILES.source(number))) ?? '', `S${number}`, GRILLO_FILES.source(number))),
        );
      });
    },

    async getStructure(id) {
      return read(id, (files) => structureOf(files, id));
    },
    async updateStructure(id, structure) {
      checkStructure(structure);
      const kept = { sections: structure.sections.map(({ name, note }) => ({ name, note })) };
      return save(id, async (files) => {
        await structureOf(files, id);
        return { changes: [{ path: GRILLO_FILES.structure, content: formatStructure(kept) }], message: 'grillo: update the PRD structure', result: kept };
      });
    },

    async createPrdVersion(id, input) {
      const fields = fieldsOf(input, 'a new PRD version');
      const body = checkText(fields.body, 'body');
      const appendix = checkText(fields.appendix, 'appendix');
      if (holdsAppendixMarker(body)) {
        refuse('invalid', 'A PRD body cannot hold the appendix marker line');
      }
      return save(id, async (files) => {
        const number = await nextNumber(files, GRILLO_FILES.prd, 'v', '.md');
        const version: PrdVersion = { number, date: timestamp(), body, appendix, score: null };
        return { changes: [{ path: GRILLO_FILES.version(number), content: formatPrdVersion(version) }], message: `grillo: add PRD version ${number}`, result: version };
      });
    },
    async getPrdVersion(id, number) {
      return read(id, (files) => versionIn(files, number));
    },
    async listPrdVersions(id) {
      return read(id, async (files) => {
        const numbers = numbersIn(await files.list(GRILLO_FILES.prd), 'v', '.md');
        return Promise.all(numbers.map((number) => versionIn(files, number)));
      });
    },

    async getScore(id, number) {
      return (await read(id, (files) => versionIn(files, number))).score;
    },
    async setScore(id, number, score) {
      if (score !== null) {
        checkScore(score);
      }
      return save(id, async (files) => {
        await versionIn(files, number);
        const content = score === null ? null : formatScore(score);
        return { changes: [{ path: GRILLO_FILES.score(number), content }], message: `grillo: score PRD version ${number}`, result: score };
      });
    },
  };
}

