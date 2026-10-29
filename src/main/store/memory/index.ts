import type { Settings } from '../../app/settings';
import { DEFAULT_PRD_STRUCTURE } from '../defaults';
import { readRecentProjects, recordRecentProject } from '../recent-projects';
import { StoreError, type CloseResult, type CommentInput, type Store, type TicketPatch, type TicketTags } from '../store';
import type {
  Answer,
  Decision,
  Discussion,
  GrillingSession,
  Invitation,
  Login,
  Member,
  Organisation,
  Permission,
  PickupComment,
  PrdStructure,
  PrdVersion,
  Project,
  ProjectId,
  ProjectMap,
  RepositoryRef,
  Score,
  Source,
  Ticket,
  TicketId,
} from '../types';
import { createMemorySettings } from './settings';

/** The signed-in member as GitHub knows them. */
export interface MemoryIdentity {
  login: Login;
  name: string | null;
  email: string | null;
}

/** An existing repository the member could connect. */
export interface MemoryRepository {
  repository: RepositoryRef;
  permission: Permission;
  issuesEnabled: boolean;
}

/** The made-up GitHub surroundings the in-memory store starts from. */
export interface MemorySeed {
  identity: MemoryIdentity;
  organisations: Organisation[];
  repositories: MemoryRepository[];
  invitations: Invitation[];
  /** Project folders are reported as `<folderRoot>/<owner>/<repo>`; nothing is written to disk. */
  folderRoot: string;
}

export interface MemoryStoreOptions {
  seed?: Partial<MemorySeed>;
  /** Where recent projects are kept; memory only when left out. */
  settings?: Settings;
  now?: () => Date;
}

/** The in-memory store, plus what only a test or a demo needs to stage. */
export interface MemoryStore extends Store {
  /** Stands in for a member commenting on the ticket in GitHub's own web or phone app. */
  addMemberComment(id: TicketId, author: Login, text: string): PickupComment;
}

/** Made-up people and organisations only. */
export const DEFAULT_MEMORY_SEED: MemorySeed = {
  identity: { login: 'ada-example', name: 'Ada Example', email: 'ada@example.com' },
  organisations: [{ login: 'example-org', name: 'Example Org' }],
  repositories: [
    { repository: { owner: 'example-org', name: 'team-code' }, permission: 'write', issuesEnabled: true },
  ],
  invitations: [
    {
      id: 1,
      repository: { owner: 'example-org', name: 'kickoff-notes' },
      inviter: 'ben-example',
      createdAt: '2026-10-20T09:00:00.000Z',
    },
  ],
  folderRoot: '/memory/Grillo',
};

const REPOSITORY_NAME = /^[A-Za-z0-9._-]+$/;
const MERGE_POINTER = /^Merged into #(\d+)$/;
const mergePointer = (number: number): string => `Merged into #${number}`;
const LOWEST_MARK = 0;
const HIGHEST_MARK = 10;

interface TicketRecord {
  /** `duplicateOf` is not kept: it is read from the merge decision (docs/store-layout.md). */
  ticket: Omit<Ticket, 'questions' | 'duplicateOf'>;
  questions: { code: string; text: string }[];
  nextQuestion: number;
  answers: Answer[];
  /** Answer id → the plain member comment it was turned from. */
  answerSources: Map<string, string>;
  discussions: Discussion[];
  decisions: Decision[];
  comments: PickupComment[];
}

interface ProjectRecord {
  id: ProjectId;
  name: string;
  repository: RepositoryRef;
  archived: boolean;
  permission: Permission;
  structure: PrdStructure;
  members: Member[];
  map: ProjectMap | null;
  tickets: Map<number, TicketRecord>;
  nextIssue: number;
  sources: Source[];
  sessions: GrillingSession[];
  versions: PrdVersion[];
}

const clone = <T>(value: T): T => structuredClone(value);

function refuse(kind: ConstructorParameters<typeof StoreError>[0], message: string): never {
  throw new StoreError(kind, message);
}

function projectIdOf({ owner, name }: RepositoryRef): ProjectId {
  return `${owner}/${name}`;
}

function sessionIdOf(date: Date): string {
  const iso = date.toISOString();
  return `${iso.slice(0, 10)}-${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}`;
}

function checkStructure(structure: PrdStructure): void {
  const names = structure.sections.map((section) => section.name.trim());
  if (names.length === 0 || names.some((name) => name === '')) {
    refuse('invalid', 'A PRD structure needs at least one section, and every section a name');
  }
  if (new Set(names).size !== names.length) {
    refuse('invalid', 'Two PRD sections cannot share a name');
  }
}

function checkScore(score: Score): void {
  const marks = [score.overall, ...score.criteria.map((item) => item.mark), ...score.sections.map((item) => item.mark)];
  if (marks.some((mark) => !Number.isFinite(mark) || mark < LOWEST_MARK || mark > HIGHEST_MARK)) {
    refuse('invalid', `Every mark must be a number from ${LOWEST_MARK} to ${HIGHEST_MARK}`);
  }
}

/** The whole store interface, kept in memory: for tests, and for screens before a GitHub backend exists. */
export function createMemoryStore(options: MemoryStoreOptions = {}): MemoryStore {
  const seed: MemorySeed = clone({ ...DEFAULT_MEMORY_SEED, ...options.seed });
  const settings = options.settings ?? createMemorySettings();
  const now = options.now ?? (() => new Date());
  const projects = new Map<ProjectId, ProjectRecord>();
  let nextCommentId = 1;

  const me = (): Login => seed.identity.login;
  const timestamp = (): string => now().toISOString();

  function project(id: ProjectId): ProjectRecord {
    return projects.get(id) ?? refuse('not-found', `No project ${id}`);
  }

  function writable(id: ProjectId): ProjectRecord {
    const record = project(id);
    if (record.archived) {
      refuse('read-only', `Project ${id} is archived: unarchive it to change anything`);
    }
    return record;
  }

  function admin(record: ProjectRecord): ProjectRecord {
    if (record.permission !== 'admin') {
      refuse('forbidden', `Only a repository admin may do this in ${record.id}`);
    }
    return record;
  }

  function member(record: ProjectRecord, login: Login): Member {
    return record.members.find((candidate) => candidate.login === login) ?? refuse('not-found', `${login} is not a member of ${record.id}`);
  }

  function checkMember(record: ProjectRecord, login: Login): void {
    if (!record.members.some((candidate) => candidate.login === login)) {
      refuse('invalid', `${login} is not a member of ${record.id}`);
    }
  }

  function map(record: ProjectRecord): ProjectMap {
    return record.map ?? refuse('not-found', `Project ${record.id} has no map yet`);
  }

  function ticketIn(record: ProjectRecord, number: number): TicketRecord {
    return record.tickets.get(number) ?? refuse('not-found', `No ticket ${number} in ${record.id}`);
  }

  function ticket(id: TicketId, write = true): TicketRecord {
    return ticketIn(write ? writable(id.project) : project(id.project), id.number);
  }

  function toTicket(record: TicketRecord): Ticket {
    const answered = new Set(record.answers.map((answer) => answer.question));
    const merge = record.decisions.map((decision) => MERGE_POINTER.exec(decision.text)).findLast((match) => match !== null);
    return clone({
      ...record.ticket,
      duplicateOf: record.ticket.state === 'closed' && merge ? Number(merge[1]) : null,
      questions: record.questions.map(({ code, text }) => ({ code, text, answered: answered.has(code) })),
    });
  }

  function toProject(record: ProjectRecord): Project {
    const { id, name, repository, structure, members, archived } = record;
    return clone({ id, name, repository, structure, members, archived });
  }

  function mapDone(record: ProjectRecord): CloseResult {
    const openTickets = [...record.tickets.values()].some((entry) => entry.ticket.state === 'open');
    return { mapDone: !openTickets && map(record).fog.length === 0 };
  }

  function checkBlockers(record: ProjectRecord, blockers: number[], self?: number): void {
    for (const blocker of blockers) {
      if (blocker === self || !record.tickets.has(blocker)) {
        refuse('invalid', `Ticket ${blocker} cannot block this ticket`);
      }
    }
  }

  /** Only the domains an edit sets must be declared: a tag stays when the last member declaring it leaves. */
  function checkTags(record: ProjectRecord, next: TicketRecord['ticket'], setDomains: string[] = []): void {
    if (next.noDomain && next.domains.length > 0) {
      refuse('invalid', 'A ticket tagged "no domain" carries no other domain');
    }
    const declared = new Set(record.members.flatMap((entry) => entry.domains));
    const unknown = setDomains.find((domain) => !declared.has(domain));
    if (unknown !== undefined) {
      refuse('invalid', `No member declared the domain '${unknown}'`);
    }
  }

  function checkQuestion(entry: TicketRecord, code: string): void {
    if (!entry.questions.some((question) => question.code === code)) {
      refuse('invalid', `Ticket ${entry.ticket.id.number} has no question ${code}`);
    }
  }

  function header(id: TicketId, input: CommentInput) {
    return { id: `c${nextCommentId++}`, ticket: clone(id), who: me(), when: timestamp(), sources: [...input.sources], via: input.via };
  }

  function comment<T extends { id: string }>(list: T[], commentId: string): T {
    return list.find((entry) => entry.id === commentId) ?? refuse('not-found', `No comment ${commentId}`);
  }

  function remove<T extends { id: string }>(list: T[], commentId: string): void {
    list.splice(list.indexOf(comment(list, commentId)), 1);
  }

  function assign(entry: TicketRecord, login: Login | null): Ticket {
    if (entry.ticket.state === 'closed') {
      refuse('invalid', `Ticket ${entry.ticket.id.number} is closed`);
    }
    entry.ticket.assignee = login;
    return toTicket(entry);
  }

  function addDecision(record: ProjectRecord, entry: TicketRecord, decision: Decision): Decision {
    entry.decisions.push(decision);
    map(record).settled.push({ ticket: entry.ticket.id.number, gist: decision.gist });
    return clone(decision);
  }

  function newProject(repository: RepositoryRef, permission: Permission, structure: PrdStructure): ProjectRecord {
    checkStructure(structure);
    const record: ProjectRecord = {
      id: projectIdOf(repository),
      name: repository.name,
      repository: clone(repository),
      archived: false,
      permission,
      structure: clone(structure),
      members: [{ ...seed.identity, role: '', domains: [] }],
      map: null,
      tickets: new Map(),
      nextIssue: 1,
      sources: [],
      sessions: [],
      versions: [],
    };
    projects.set(record.id, record);
    return record;
  }

  function session(record: ProjectRecord, sessionId: string): GrillingSession {
    return record.sessions.find((entry) => entry.id === sessionId) ?? refuse('not-found', `No session ${sessionId}`);
  }

  function version(record: ProjectRecord, number: number): PrdVersion {
    return record.versions.find((entry) => entry.number === number) ?? refuse('not-found', `No PRD version ${number}`);
  }

  return {
    async currentMember(id) {
      const line = project(id).members.find((entry) => entry.login === me());
      return clone({ ...seed.identity, role: line?.role ?? '', domains: line?.domains ?? [] });
    },
    async viewerPermission(id) {
      return project(id).permission;
    },
    async listOrganisations() {
      return clone(seed.organisations);
    },
    async listPendingInvitations() {
      return clone(seed.invitations);
    },
    async acceptInvitation(id) {
      const index = seed.invitations.findIndex((invitation) => invitation.id === id);
      if (index < 0) {
        refuse('not-found', `No pending invitation ${id}`);
      }
      seed.invitations.splice(index, 1);
    },

    async listProjects() {
      return [...projects.values()].map(toProject);
    },
    async getProject(id) {
      return toProject(project(id));
    },
    async createProject(input) {
      const structure = input.structure ?? DEFAULT_PRD_STRUCTURE;
      if ('newRepository' in input) {
        const { organisation, name } = input.newRepository;
        if (!seed.organisations.some((entry) => entry.login === organisation)) {
          refuse('invalid', `You are not in the organisation '${organisation}'`);
        }
        if (!REPOSITORY_NAME.test(name)) {
          refuse('invalid', `'${name}' is not a repository name: letters, digits, '.', '-' and '_' only`);
        }
        const repository = { owner: organisation, name };
        const id = projectIdOf(repository);
        if (projects.has(id) || seed.repositories.some((entry) => projectIdOf(entry.repository) === id)) {
          refuse('conflict', `Repository ${id} already exists`);
        }
        return toProject(newProject(repository, 'admin', structure));
      }
      const id = projectIdOf(input.connectRepository);
      const existing = projects.get(id);
      if (existing) {
        return toProject(existing);
      }
      const found =
        seed.repositories.find((entry) => projectIdOf(entry.repository) === id) ?? refuse('not-found', `No repository ${id}`);
      if (found.permission === 'read') {
        refuse('forbidden', `Connecting ${id} needs write access; you have read access`);
      }
      if (!found.issuesEnabled) {
        refuse('invalid', `Issues are turned off in ${id}: turn them on in the repository settings`);
      }
      return toProject(newProject(found.repository, found.permission, structure));
    },
    async archiveProject(id) {
      admin(project(id)).archived = true;
    },
    async unarchiveProject(id) {
      admin(project(id)).archived = false;
    },
    async openProjectFolder(id) {
      const { repository } = project(id);
      recordRecentProject(settings, id, timestamp());
      return `${seed.folderRoot}/${repository.owner}/${repository.name}`;
    },
    async listRecentProjects() {
      return readRecentProjects(settings);
    },

    async listMembers(id) {
      return clone(project(id).members);
    },
    async getMember(id, login) {
      return clone(member(project(id), login));
    },
    async addMember(id, { login, role, domains }) {
      const record = admin(writable(id));
      if (login.trim() === '') {
        refuse('invalid', 'A member needs a GitHub login');
      }
      if (record.members.some((entry) => entry.login === login)) {
        refuse('conflict', `${login} is already a member of ${id}`);
      }
      const added: Member = { login, name: null, email: null, role, domains: [...domains] };
      record.members.push(added);
      return clone(added);
    },
    async updateMember(id, login, patch) {
      const line = member(writable(id), login);
      Object.assign(line, clone(patch));
      return clone(line);
    },
    async removeMember(id, login) {
      const record = admin(writable(id));
      record.members.splice(record.members.indexOf(member(record, login)), 1);
    },

    async createMap(id, input) {
      const record = writable(id);
      if (record.map) {
        refuse('conflict', `Project ${id} already has a map`);
      }
      const { destination, notes, fog, outOfScope } = clone(input);
      record.map = { number: record.nextIssue++, destination, notes, settled: [], fog, outOfScope };
      return clone(record.map);
    },
    async getMap(id) {
      return clone(map(project(id)));
    },
    async updateMap(id, patch) {
      const current = map(writable(id));
      Object.assign(current, clone(patch));
      return clone(current);
    },

    async createTicket(id, input) {
      const record = writable(id);
      map(record);
      checkBlockers(record, input.blockers);
      const number = record.nextIssue++;
      const entry: TicketRecord = {
        ticket: {
          id: { project: id, number },
          title: input.title,
          question: input.question,
          whyItMatters: input.whyItMatters,
          assumptions: [...input.assumptions],
          kind: input.kind,
          domains: [],
          noDomain: false,
          blockers: [...input.blockers],
          assignee: null,
          state: 'open',
        },
        questions: input.questions.map((text, index) => ({ code: `Q${number}.${index + 1}`, text })),
        nextQuestion: input.questions.length + 1,
        answers: [],
        answerSources: new Map(),
        discussions: [],
        decisions: [],
        comments: [],
      };
      record.tickets.set(number, entry);
      return toTicket(entry);
    },
    async getTicket(id) {
      return toTicket(ticket(id, false));
    },
    async listTickets(id, filter = {}) {
      const wanted = filter.domains === undefined ? null : new Set(filter.domains);
      return [...project(id).tickets.values()]
        .map(toTicket)
        .filter((entry) => filter.state === undefined || entry.state === filter.state)
        .filter(
          (entry) =>
            wanted === null ||
            entry.assignee === me() ||
            entry.noDomain ||
            entry.domains.some((domain) => wanted.has(domain)),
        )
        .sort((a, b) => Number(b.assignee === me()) - Number(a.assignee === me()) || a.id.number - b.id.number);
    },
    async updateTicket(id, patch: TicketPatch) {
      const record = writable(id.project);
      const entry = ticketIn(record, id.number);
      const next = { ...entry.ticket, ...clone(patch) };
      checkTags(record, next, patch.domains);
      checkBlockers(record, next.blockers, id.number);
      entry.ticket = next;
      return toTicket(entry);
    },
    /** Memory keeps no comments for markers: no tagging round runs against it, so only the tags change. */
    async tagTicketByHand(id, { domains, noDomain }: TicketTags) {
      const record = writable(id.project);
      const entry = ticketIn(record, id.number);
      const next = { ...entry.ticket, domains: [...domains], noDomain };
      checkTags(record, next, domains);
      entry.ticket = next;
      return toTicket(entry);
    },
    async closeTicket(id) {
      const record = writable(id.project);
      const entry = ticketIn(record, id.number);
      entry.ticket.state = 'closed';
      const latest = entry.decisions.at(-1);
      const settled = map(record).settled;
      if (latest && !settled.some((line) => line.ticket === id.number)) {
        settled.push({ ticket: id.number, gist: latest.gist });
      }
      return mapDone(record);
    },
    async mergeTicket(id, into) {
      const record = writable(id.project);
      const entry = ticketIn(record, id.number);
      const target = into.project === id.project ? record.tickets.get(into.number) : undefined;
      if (!target || target === entry || target.ticket.state === 'closed') {
        refuse('invalid', `Ticket ${id.number} can only merge into another open ticket of ${id.project}`);
      }
      const pointer = mergePointer(into.number);
      addDecision(record, entry, { ...header(id, { sources: [], via: null }), text: pointer, gist: pointer });
      entry.ticket.state = 'closed';
      return mapDone(record);
    },
    async reopenTicket(id) {
      const record = writable(id.project);
      const entry = ticketIn(record, id.number);
      entry.ticket.state = 'open';
      const current = map(record);
      current.settled = current.settled.filter((line) => line.ticket !== id.number);
      return toTicket(entry);
    },
    async claimTicket(id) {
      const entry = ticket(id);
      const holder = entry.ticket.assignee;
      if (holder !== null && holder !== me()) {
        refuse('conflict', `Ticket ${id.number} is already taken by ${holder}`);
      }
      return assign(entry, me());
    },
    async sendTicket(id, login) {
      const entry = ticket(id);
      checkMember(project(id.project), login);
      const holder = entry.ticket.assignee;
      if (holder !== null && holder !== login) {
        refuse('conflict', `Ticket ${id.number} is already taken by ${holder}`);
      }
      return assign(entry, login);
    },
    async reassignTicket(id, login) {
      const entry = ticket(id);
      checkMember(project(id.project), login);
      if (entry.answers.length > 0) {
        refuse('conflict', `Ticket ${id.number} already has answers; only an unanswered ticket is reassigned`);
      }
      return assign(entry, login);
    },
    async releaseTicket(id) {
      return assign(ticket(id), null);
    },

    async addQuestion(id, text) {
      const entry = ticket(id);
      entry.questions.push({ code: `Q${id.number}.${entry.nextQuestion++}`, text });
      return toTicket(entry);
    },
    async updateQuestion(id, code, text) {
      const entry = ticket(id);
      checkQuestion(entry, code);
      entry.questions = entry.questions.map((question) => (question.code === code ? { code, text } : question));
      return toTicket(entry);
    },
    async removeQuestion(id, code) {
      const entry = ticket(id);
      checkQuestion(entry, code);
      if (entry.answers.some((answer) => answer.question === code)) {
        refuse('conflict', `Question ${code} has an answer: delete the answer first`);
      }
      entry.questions = entry.questions.filter((question) => question.code !== code);
      return toTicket(entry);
    },

    async createAnswer(id, { question, text, fromComment, ...input }) {
      const entry = ticket(id);
      checkQuestion(entry, question);
      if (fromComment !== null) {
        const picked = [...entry.answerSources.values()];
        if (!entry.comments.some((candidate) => candidate.id === fromComment) || picked.includes(fromComment)) {
          refuse('invalid', `Comment ${fromComment} is not waiting to be turned into an answer`);
        }
      }
      const answer: Answer = { ...header(id, input), question, text };
      entry.answers.push(answer);
      if (fromComment !== null) {
        entry.answerSources.set(answer.id, fromComment);
      }
      return clone(answer);
    },
    async listAnswers(id) {
      return clone(ticket(id, false).answers);
    },
    async updateAnswer(id, answerId, text) {
      const answer = comment(ticket(id).answers, answerId);
      answer.text = text;
      return clone(answer);
    },
    async deleteAnswer(id, answerId) {
      const entry = ticket(id);
      remove(entry.answers, answerId);
      entry.answerSources.delete(answerId);
    },
    async createDiscussion(id, { question, transcript, sessionFile, ...input }) {
      const entry = ticket(id);
      checkQuestion(entry, question);
      const discussion: Discussion = { ...header(id, input), question, transcript, sessionFile };
      entry.discussions.push(discussion);
      return clone(discussion);
    },
    async listDiscussions(id) {
      return clone(ticket(id, false).discussions);
    },
    async updateDiscussion(id, discussionId, transcript) {
      const discussion = comment(ticket(id).discussions, discussionId);
      discussion.transcript = transcript;
      return clone(discussion);
    },
    async deleteDiscussion(id, discussionId) {
      remove(ticket(id).discussions, discussionId);
    },
    async createDecision(id, { text, gist, ...input }) {
      const record = writable(id.project);
      return addDecision(record, ticketIn(record, id.number), { ...header(id, input), text, gist });
    },
    async listDecisions(id) {
      return clone(ticket(id, false).decisions);
    },
    async updateDecision(id, decisionId, patch) {
      const record = writable(id.project);
      const decision = comment(ticketIn(record, id.number).decisions, decisionId);
      const line = map(record).settled.find((entry) => entry.ticket === id.number && entry.gist === decision.gist);
      Object.assign(decision, clone(patch));
      if (line) {
        line.gist = decision.gist;
      }
      return clone(decision);
    },
    async deleteDecision(id, decisionId) {
      const record = writable(id.project);
      const entry = ticketIn(record, id.number);
      const decision = comment(entry.decisions, decisionId);
      const settled = map(record).settled;
      const line = settled.findIndex((item) => item.ticket === id.number && item.gist === decision.gist);
      if (line >= 0) {
        settled.splice(line, 1);
      }
      remove(entry.decisions, decisionId);
    },
    async listPickupComments(id) {
      const entry = ticket(id, false);
      const picked = new Set(entry.answerSources.values());
      return clone(entry.comments.filter((candidate) => !picked.has(candidate.id)));
    },

    async createSession(id, { present }) {
      const record = writable(id);
      present.forEach((login) => checkMember(record, login));
      const started = now();
      const sessionId = sessionIdOf(started);
      if (record.sessions.some((entry) => entry.id === sessionId)) {
        refuse('conflict', `A session named ${sessionId} already exists`);
      }
      const created: GrillingSession = {
        id: sessionId,
        date: started.toISOString(),
        present: [...present],
        consent: null,
        transcript: '',
      };
      record.sessions.push(created);
      return clone(created);
    },
    async getSession(id, sessionId) {
      return clone(session(project(id), sessionId));
    },
    async listSessions(id) {
      return clone(project(id).sessions);
    },
    async updateSession(id, sessionId, { consent, present, transcript }) {
      const record = writable(id);
      const current = session(record, sessionId);
      if (present !== undefined) {
        present.forEach((login) => checkMember(record, login));
        current.present = [...present];
      }
      if (transcript !== undefined) {
        current.transcript = transcript;
      }
      if (consent) {
        current.consent = { by: me(), at: timestamp() };
      }
      return clone(current);
    },

    async createSource(id, input) {
      const record = writable(id);
      const source: Source = { code: `S${record.sources.length + 1}`, ...clone(input) };
      record.sources.push(source);
      return clone(source);
    },
    async getSource(id, code) {
      return clone(project(id).sources.find((entry) => entry.code === code) ?? refuse('not-found', `No source ${code}`));
    },
    async listSources(id) {
      return clone(project(id).sources);
    },

    async getStructure(id) {
      return clone(project(id).structure);
    },
    async updateStructure(id, structure) {
      const record = writable(id);
      checkStructure(structure);
      record.structure = clone(structure);
      return clone(structure);
    },

    async createPrdVersion(id, { body, appendix }) {
      const record = writable(id);
      const created: PrdVersion = { number: record.versions.length + 1, date: timestamp(), body, appendix, score: null };
      record.versions.push(created);
      return clone(created);
    },
    async getPrdVersion(id, number) {
      return clone(version(project(id), number));
    },
    async listPrdVersions(id) {
      return clone(project(id).versions);
    },

    async getScore(id, number) {
      return clone(version(project(id), number).score);
    },
    async setScore(id, number, score) {
      const target = version(writable(id), number);
      if (score !== null) {
        checkScore(score);
      }
      target.score = clone(score);
      return clone(score);
    },

    addMemberComment(id, author, text) {
      const entry = ticket(id, false);
      const added: PickupComment = { id: `c${nextCommentId++}`, ticket: clone(id), author, when: timestamp(), text };
      entry.comments.push(added);
      return clone(added);
    },
  };
}
