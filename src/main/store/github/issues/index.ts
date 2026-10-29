import { StoreError, type CloseResult, type CommentInput, type Store, type StoreMethod, type TicketTags } from '../../store';
import type { Answer, Decision, Discussion, Login, PickupComment, ProjectMap, RepositoryRef, Ticket, TicketId, TicketKind } from '../../types';
import type { GithubDeps } from '..';
import { createGithubApi } from '../repo/github-api';
import { isLogin, projectIdOf, repositoryOf, sameLogin, sourceNumberOf } from '../repo/names';
import {
  domainLabel,
  domainOf,
  formatComment,
  formatMapBody,
  formatTagsByHand,
  formatTicketBody,
  isCommentId,
  isDomainLabel,
  isKindLabel,
  isSessionFile,
  isTagsByHand,
  kindLabel,
  MAP_LABEL,
  MAP_TITLE,
  NO_DOMAIN_LABEL,
  oneLine,
  parseComment,
  parseMapBody,
  parseQuestionCode,
  parseTicketBody,
  questionCode,
  REMOVED_QUESTION,
  TICKET_KINDS,
  type AnswerComment,
  type DecisionComment,
  type DiscussionComment,
  type IssueComment,
  type MapBody,
  type MarkedComment,
  type OmitEach,
  type PlainComment,
  type TicketBody,
} from './bodies';
import { createIssuesApi, type IssueData, type IssueState } from './issues-api';

/**
 * The store methods kept in GitHub Issues: the map, tickets, questions, answers, discussions, decisions and
 * the claim rule (docs/store-layout.md).
 */
export const ISSUES_METHODS = [
  'createMap',
  'getMap',
  'updateMap',
  'createTicket',
  'getTicket',
  'listTickets',
  'updateTicket',
  'tagTicketByHand',
  'closeTicket',
  'mergeTicket',
  'reopenTicket',
  'claimTicket',
  'sendTicket',
  'reassignTicket',
  'releaseTicket',
  'addQuestion',
  'updateQuestion',
  'removeQuestion',
  'createAnswer',
  'listAnswers',
  'updateAnswer',
  'deleteAnswer',
  'createDiscussion',
  'listDiscussions',
  'updateDiscussion',
  'deleteDiscussion',
  'createDecision',
  'listDecisions',
  'updateDecision',
  'deleteDecision',
  'listPickupComments',
] as const satisfies readonly StoreMethod[];

type IssuesStore = Pick<Store, (typeof ISSUES_METHODS)[number]>;

const MERGE_POINTER = /^Merged into #(\d+)$/;
const mergePointer = (number: number): string => `Merged into #${number}`;
const SECTION_LINE = /^### /m;
/** The domain name `domain:none` already stands for: the visible "no domain" tag. */
const NO_DOMAIN = domainOf(NO_DOMAIN_LABEL);
const VIAS = ['github', 'generic-agent'] as const;

function refuse(kind: ConstructorParameters<typeof StoreError>[0], message: string): never {
  throw new StoreError(kind, message);
}

// Checks on arguments that arrived over IPC: anything of the wrong shape is refused as `invalid`.

function fieldsOf<T extends object>(value: T | null | undefined, what: string): Partial<T> {
  if (typeof value !== 'object' || value === null) {
    refuse('invalid', `Expected ${what}`);
  }
  return value;
}

/**
 * Long text kept in an issue section: a line starting with `### ` would read as the next section. The check runs
 * on the trimmed text, which is what gets written, so leading spaces cannot turn the first line into a heading.
 */
function checkSectionText(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    refuse('invalid', `'${field}' must be text`);
  }
  const written = value.trim();
  if (SECTION_LINE.test(written)) {
    refuse('invalid', `'${field}' cannot hold a line starting with '### '`);
  }
  return written;
}

function checkText(value: unknown, field: string): string {
  return typeof value === 'string' ? value : refuse('invalid', `'${field}' must be text`);
}

/** One line of a list section; it cannot be empty, since an empty item would not read back. */
function checkItem(value: unknown, field: string): string {
  const item = oneLine(checkText(value, field));
  return item === '' ? refuse('invalid', `An item of '${field}' cannot be empty`) : item;
}

function checkItems(value: unknown, field: string): string[] {
  return Array.isArray(value) ? value.map((item) => checkItem(item, field)) : refuse('invalid', `'${field}' must be a list of text`);
}

function checkQuestionText(value: unknown): string {
  const text = checkItem(value, 'question');
  return text === REMOVED_QUESTION ? refuse('invalid', `A question cannot read '${REMOVED_QUESTION}'`) : text;
}

const isIssueNumber = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

function checkNumbers(value: unknown, field: string): number[] {
  if (!Array.isArray(value) || !value.every(isIssueNumber) || new Set(value).size !== value.length) {
    refuse('invalid', `'${field}' must be a list of distinct issue numbers`);
  }
  return [...value];
}

function checkKind(value: unknown): TicketKind {
  return TICKET_KINDS.find((kind) => kind === value) ?? refuse('invalid', `'${String(value)}' is not a ticket kind`);
}

function checkDomains(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((domain) => typeof domain !== 'string' || domain.trim() === '' || domain.trim() === NO_DOMAIN)) {
    refuse('invalid', `Domains must be a list of names; '${NO_DOMAIN}' is the "no domain" tag, set with noDomain`);
  }
  return [...new Set(value.map((domain: string) => domain.trim()))];
}

function checkNoDomainAlone(noDomain: boolean, domains: string[]): void {
  if (noDomain && domains.length > 0) {
    refuse('invalid', 'A ticket tagged "no domain" carries no other domain');
  }
}

/** The domain labels that carry a ticket's tags: `domain:none` for "no domain", none at all when not tagged yet. */
const tagLabels = ({ domains, noDomain }: TicketTags): string[] => (noDomain ? [NO_DOMAIN_LABEL] : domains.map(domainLabel));

/** A list filter only reads: any declared name passes, as the members file allows any text ('none' and blank ones too). */
function checkFilterDomains(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((domain) => typeof domain !== 'string')) {
    refuse('invalid', 'The domain filter must be a list of text');
  }
  return [...value];
}

function checkComment(input: CommentInput | null | undefined) {
  const { sources, via } = fieldsOf(input, 'a new record');
  if (!Array.isArray(sources) || sources.some((code) => sourceNumberOf(code) === null)) {
    refuse('invalid', 'Sources must be a list of S<n> codes');
  }
  if (via !== null && !VIAS.includes(via as (typeof VIAS)[number])) {
    refuse('invalid', `'${String(via)}' is not a way a record arrives: github, generic-agent or none`);
  }
  return { sources: [...sources], via: via ?? null };
}

function ticketRef(id: TicketId | null | undefined, what = 'a ticket'): { ref: RepositoryRef; number: number } {
  const { project, number } = fieldsOf(id, what);
  if (!isIssueNumber(number)) {
    refuse('invalid', `'${String(number)}' is not a ticket number`);
  }
  return { ref: repositoryOf(project), number };
}

// Reading issues as records.

/** The kind a ticket's labels give; null for an issue that is no ticket. */
function kindOf(issue: IssueData): TicketKind | null {
  const kinds = TICKET_KINDS.filter((kind) => issue.labels.includes(kindLabel(kind)));
  if (kinds.length > 1) {
    refuse('backend', `Issue #${issue.number} carries ${kinds.length} kind labels; a ticket has exactly one`);
  }
  return kinds[0] ?? null;
}

const isTicketIssue = (issue: IssueData): boolean => !issue.pullRequest && !issue.labels.includes(MAP_LABEL) && kindOf(issue) !== null;

function tagsOf(issue: IssueData): Pick<Ticket, 'domains' | 'noDomain'> {
  const domains = issue.labels.filter((label) => isDomainLabel(label) && label !== NO_DOMAIN_LABEL).map(domainOf);
  const noDomain = issue.labels.includes(NO_DOMAIN_LABEL);
  if (noDomain && domains.length > 0) {
    refuse('backend', `Issue #${issue.number} carries '${NO_DOMAIN_LABEL}' together with a domain label`);
  }
  return { domains, noDomain };
}

const answersIn = (comments: IssueComment[]): AnswerComment[] => comments.filter((entry): entry is AnswerComment => entry.kind === 'answer');
const discussionsIn = (comments: IssueComment[]): DiscussionComment[] =>
  comments.filter((entry): entry is DiscussionComment => entry.kind === 'discussion');
const decisionsIn = (comments: IssueComment[]): DecisionComment[] => comments.filter((entry): entry is DecisionComment => entry.kind === 'decision');

const bodyOf = (issue: IssueData): TicketBody => parseTicketBody(issue.body, issue.number, `Issue #${issue.number}`);

function toTicket(ref: RepositoryRef, issue: IssueData, comments: IssueComment[]): Ticket {
  const body = bodyOf(issue);
  const answered = new Set(answersIn(comments).map((answer) => answer.question));
  const merge = decisionsIn(comments)
    .map((decision) => MERGE_POINTER.exec(decision.text))
    .findLast((match) => match !== null);
  return {
    id: { project: projectIdOf(ref), number: issue.number },
    title: issue.title,
    question: body.question,
    whyItMatters: body.whyItMatters,
    assumptions: body.assumptions,
    kind: kindOf(issue) ?? refuse('not-found', `Issue #${issue.number} is not a ticket`),
    ...tagsOf(issue),
    blockers: body.blockers,
    assignee: issue.assignees[0] ?? null,
    state: issue.state,
    duplicateOf: issue.state === 'closed' && merge ? Number(merge[1]) : null,
    questions: body.questions
      .filter((line) => line.text !== null)
      .map(({ k, text }) => {
        const code = questionCode(issue.number, k);
        return { code, text: text ?? '', answered: answered.has(code) };
      }),
  };
}

const headerOf = (ticket: TicketId, { id, who, when, sources, via }: MarkedComment) => ({ id, ticket, who, when, sources, via });

const toAnswer = (ticket: TicketId, comment: AnswerComment): Answer => ({ ...headerOf(ticket, comment), question: comment.question, text: comment.text });
const toDiscussion = (ticket: TicketId, comment: DiscussionComment): Discussion => ({
  ...headerOf(ticket, comment),
  question: comment.question,
  transcript: comment.transcript,
  sessionFile: comment.session,
});
const toDecision = (ticket: TicketId, comment: DecisionComment): Decision => ({ ...headerOf(ticket, comment), text: comment.text, gist: comment.gist });

export function createIssuesStore(deps: GithubDeps): IssuesStore {
  const now = deps.now ?? (() => new Date());
  const repositories = createGithubApi(deps.gh);
  const api = createIssuesApi(deps.gh);
  const timestamp = (): string => now().toISOString();

  async function writable(ref: RepositoryRef): Promise<void> {
    if ((await repositories.repository(ref)).archived) {
      refuse('read-only', `Project ${projectIdOf(ref)} is closed (its repository is archived): unarchive it to change anything`);
    }
  }

  // The map.

  async function findMap(ref: RepositoryRef): Promise<IssueData | null> {
    const maps = (await api.listIssues(ref, 'all', MAP_LABEL)).filter((issue) => !issue.pullRequest && issue.labels.includes(MAP_LABEL));
    if (maps.length > 1) {
      refuse('backend', `${projectIdOf(ref)} has ${maps.length} issues labelled ${MAP_LABEL}; a project has one map`);
    }
    return maps[0] ?? null;
  }

  async function mapIssue(ref: RepositoryRef): Promise<IssueData> {
    return (await findMap(ref)) ?? refuse('not-found', `Project ${projectIdOf(ref)} has no map yet`);
  }

  const mapBodyOf = (issue: IssueData): MapBody => parseMapBody(issue.body, `The map, issue #${issue.number}`);
  const mapOf = (issue: IssueData): ProjectMap => ({ number: issue.number, ...mapBodyOf(issue) });

  /** Reads the map afresh, changes it and writes its body back. */
  async function changeMap(ref: RepositoryRef, change: (map: MapBody) => MapBody): Promise<ProjectMap> {
    const issue = await mapIssue(ref);
    return mapOf(await api.editIssue(ref, issue.number, { body: formatMapBody(change(mapBodyOf(issue))) }));
  }

  // Tickets.

  async function commentsOf(ref: RepositoryRef, issue: IssueData): Promise<IssueComment[]> {
    return issue.comments === 0 ? [] : (await api.comments(ref, issue.number)).map(parseComment);
  }

  /** The ticket's issue; one that does not exist or is no ticket is refused as `not-found`. */
  async function ticketIssue(ref: RepositoryRef, number: number): Promise<IssueData> {
    const issue = await api.issue(ref, number);
    if (issue === null || !isTicketIssue(issue)) {
      refuse('not-found', `No ticket ${number} in ${projectIdOf(ref)}`);
    }
    return issue;
  }

  async function readTicket(id: TicketId, write: boolean) {
    const { ref, number } = ticketRef(id);
    if (write) {
      await writable(ref);
    }
    const issue = await ticketIssue(ref, number);
    const comments = await commentsOf(ref, issue);
    return { ref, number, issue, comments, ticket: toTicket(ref, issue, comments) };
  }

  async function openTicket(id: TicketId) {
    const read = await readTicket(id, true);
    if (read.issue.state === 'closed') {
      refuse('invalid', `Ticket ${read.number} is closed`);
    }
    return read;
  }

  async function listTicketIssues(ref: RepositoryRef, state: IssueState): Promise<IssueData[]> {
    const found = new Map<number, IssueData>();
    for (const kind of TICKET_KINDS) {
      for (const issue of await api.listIssues(ref, state, kindLabel(kind))) {
        found.set(issue.number, issue);
      }
    }
    return [...found.values()].filter(isTicketIssue).sort((a, b) => a.number - b.number);
  }

  /** The map is done when no ticket is open and no fog is left; `closed` is the ticket just closed. */
  async function mapDone(ref: RepositoryRef, closed: number): Promise<CloseResult> {
    const open = (await listTicketIssues(ref, 'open')).filter((issue) => issue.number !== closed);
    return { mapDone: open.length === 0 && mapOf(await mapIssue(ref)).fog.length === 0 };
  }

  /** The blockers as tickets of the same project, each with its global id for the native relation. */
  async function blockerIssues(ref: RepositoryRef, blockers: number[], self?: number): Promise<IssueData[]> {
    const issues: IssueData[] = [];
    for (const blocker of blockers) {
      const issue = blocker === self ? null : await api.issue(ref, blocker);
      if (issue === null || !isTicketIssue(issue)) {
        refuse('invalid', `Ticket ${blocker} cannot block this ticket`);
      }
      issues.push(issue);
    }
    return issues;
  }

  /** Makes GitHub's native "blocked by" relation agree with the body's section. */
  async function syncBlockers(ref: RepositoryRef, number: number, wanted: IssueData[]): Promise<void> {
    const native = await api.blockers(ref, number);
    for (const blocker of wanted.filter((issue) => !native.some((entry) => entry.number === issue.number))) {
      await api.addBlocker(ref, number, blocker.id);
    }
    for (const blocker of native.filter((entry) => !wanted.some((issue) => issue.number === entry.number))) {
      await api.removeBlocker(ref, number, blocker.id);
    }
  }

  async function declaredDomains(ref: RepositoryRef): Promise<Set<string>> {
    return new Set((await api.memberLines(ref)).flatMap((line) => line.domains));
  }

  /** Only the domains an edit sets must be declared: a tag stays when the last member declaring it leaves. */
  async function checkDeclared(ref: RepositoryRef, setDomains: string[]): Promise<void> {
    if (setDomains.length === 0) {
      return;
    }
    const declared = await declaredDomains(ref);
    const unknown = setDomains.find((domain) => !declared.has(domain));
    if (unknown !== undefined) {
      refuse('invalid', `No member declared the domain '${unknown}'`);
    }
  }

  /** The login as the members file spells it; a login of no member is refused. */
  async function memberLogin(ref: RepositoryRef, login: unknown): Promise<Login> {
    const lines = isLogin(login) ? await api.memberLines(ref) : [];
    const line = lines.find((entry) => sameLogin(entry.login, login as string));
    return line?.login ?? refuse('invalid', `${String(login)} is not a member of ${projectIdOf(ref)}`);
  }

  async function editBody(ref: RepositoryRef, issue: IssueData, comments: IssueComment[], change: (body: TicketBody) => TicketBody): Promise<Ticket> {
    const body = formatTicketBody(change(bodyOf(issue)), issue.number);
    return toTicket(ref, await api.editIssue(ref, issue.number, { body }), comments);
  }

  /**
   * The claim rule (docs/store-layout.md): assign, re-read the assignees, and when another login is also
   * assigned the earlier `assigned` event wins and the later login is unassigned again.
   */
  async function take(id: TicketId, login: Login): Promise<Ticket> {
    const { ref, number, issue, comments } = await openTicket(id);
    const holder = issue.assignees.find((assignee) => !sameLogin(assignee, login));
    if (holder !== undefined) {
      refuse('conflict', `Ticket ${number} is already taken by ${holder}`);
    }
    if (issue.assignees.length > 0) {
      return toTicket(ref, issue, comments);
    }
    await api.addAssignee(ref, number, login);
    const reread = (await api.issue(ref, number)) ?? refuse('not-found', `No ticket ${number} in ${projectIdOf(ref)}`);
    const mine = reread.assignees.find((assignee) => sameLogin(assignee, login));
    if (mine === undefined) {
      refuse('invalid', `GitHub did not assign ${login}: only people with access to ${projectIdOf(ref)} can take a ticket`);
    }
    const others = reread.assignees.filter((assignee) => assignee !== mine);
    if (others.length > 0) {
      const events = await api.assignmentEvents(ref, number);
      const assignedAt = (who: Login): number => {
        const index = events.findLastIndex((event) => event.event === 'assigned' && sameLogin(event.assignee, who));
        return index < 0 ? Number.POSITIVE_INFINITY : index;
      };
      const first = Math.min(...others.map(assignedAt));
      if (!(assignedAt(mine) < first)) {
        await api.removeAssignee(ref, number, mine);
        const winner = others.find((other) => assignedAt(other) === first) ?? others[0];
        refuse('conflict', `Ticket ${number} was taken by ${winner} first`);
      }
    }
    return toTicket(ref, { ...reread, assignees: [mine] }, comments);
  }

  /** Replaces the assignees, once GitHub confirms it would assign each of them, so a refusal changes nothing. */
  async function setAssignees(id: TicketId, assignees: Login[], check: (comments: IssueComment[]) => void): Promise<Ticket> {
    const { ref, number, comments } = await openTicket(id);
    check(comments);
    for (const login of assignees) {
      if (!(await api.canBeAssigned(ref, login))) {
        refuse('invalid', `GitHub cannot assign ${login}: only people with access to ${projectIdOf(ref)} can hold a ticket`);
      }
    }
    const issue = await api.editIssue(ref, number, { assignees });
    if (assignees.some((login) => !issue.assignees.some((assignee) => sameLogin(assignee, login)))) {
      refuse('invalid', `GitHub did not assign ${assignees.join(', ')}: only people with access to ${projectIdOf(ref)} can hold a ticket`);
    }
    return toTicket(ref, issue, comments);
  }

  function checkQuestion(ticket: Ticket, code: unknown): string {
    const question = ticket.questions.find((entry) => entry.code === code);
    return question?.code ?? refuse('invalid', `Ticket ${ticket.id.number} has no question ${String(code)}`);
  }

  // Comments.

  async function addComment(ref: RepositoryRef, number: number, record: OmitEach<MarkedComment, 'id' | 'who' | 'when'>): Promise<MarkedComment> {
    const who = await api.viewer();
    const created = parseComment(await api.createComment(ref, number, formatComment({ ...record, who, when: timestamp() })));
    return created.kind === record.kind ? (created as MarkedComment) : refuse('backend', `Comment ${created.id} did not read back as ${record.kind}`);
  }

  function find<T extends MarkedComment>(comments: IssueComment[], kind: T['kind'], commentId: unknown): T {
    const found = isCommentId(commentId) ? comments.find((entry) => entry.id === commentId && entry.kind === kind) : undefined;
    return (found as T | undefined) ?? refuse('not-found', `No ${kind} ${String(commentId)}`);
  }

  async function rewrite<T extends MarkedComment>(ref: RepositoryRef, comment: T, change: Partial<T>): Promise<T> {
    const { id, ...record } = { ...comment, ...change };
    const edited = parseComment(await api.editComment(ref, id, formatComment(record as OmitEach<MarkedComment, 'id'>)));
    return edited.kind === comment.kind ? (edited as T) : refuse('backend', `Comment ${id} did not read back as ${comment.kind}`);
  }

  async function writeDecision(ref: RepositoryRef, number: number, decision: Omit<DecisionComment, 'id' | 'who' | 'when'>): Promise<DecisionComment> {
    const created = (await addComment(ref, number, decision)) as DecisionComment;
    await changeMap(ref, (map) => ({ ...map, settled: [...map.settled, { ticket: number, gist: created.gist }] }));
    return created;
  }

  /** Removes the first settled line of the ticket that shows the gist. */
  function withoutLine(map: MapBody, number: number, gist: string): MapBody {
    const index = map.settled.findIndex((line) => line.ticket === number && line.gist === gist);
    return index < 0 ? map : { ...map, settled: map.settled.filter((_line, at) => at !== index) };
  }

  return {
    async createMap(project, input) {
      const ref = repositoryOf(project);
      const fields = fieldsOf(input, 'a new map');
      const body: MapBody = {
        destination: checkSectionText(fields.destination, 'destination'),
        notes: checkSectionText(fields.notes, 'notes'),
        settled: [],
        fog: checkItems(fields.fog, 'fog'),
        outOfScope: checkItems(fields.outOfScope, 'outOfScope'),
      };
      await writable(ref);
      if ((await findMap(ref)) !== null) {
        refuse('conflict', `Project ${project} already has a map`);
      }
      return mapOf(await api.createIssue(ref, { title: MAP_TITLE, body: formatMapBody(body), labels: [MAP_LABEL] }));
    },
    async getMap(project) {
      return mapOf(await mapIssue(repositoryOf(project)));
    },
    async updateMap(project, patch) {
      const ref = repositoryOf(project);
      const { destination, notes, fog, outOfScope } = fieldsOf(patch, 'the map fields to change');
      const changed: Partial<MapBody> = {
        ...(destination === undefined ? {} : { destination: checkSectionText(destination, 'destination') }),
        ...(notes === undefined ? {} : { notes: checkSectionText(notes, 'notes') }),
        ...(fog === undefined ? {} : { fog: checkItems(fog, 'fog') }),
        ...(outOfScope === undefined ? {} : { outOfScope: checkItems(outOfScope, 'outOfScope') }),
      };
      await writable(ref);
      return changeMap(ref, (map) => ({ ...map, ...changed }));
    },

    async createTicket(project, input) {
      const ref = repositoryOf(project);
      const fields = fieldsOf(input, 'a new ticket');
      const title = oneLine(checkText(fields.title, 'title'));
      if (title === '') {
        refuse('invalid', 'A ticket needs a title');
      }
      const kind = checkKind(fields.kind);
      const questions = Array.isArray(fields.questions) ? fields.questions.map(checkQuestionText) : refuse('invalid', "'questions' must be a list of text");
      const body: TicketBody = {
        question: checkSectionText(fields.question, 'question'),
        whyItMatters: checkSectionText(fields.whyItMatters, 'whyItMatters'),
        assumptions: checkItems(fields.assumptions, 'assumptions'),
        questions: [],
        blockers: checkNumbers(fields.blockers, 'blockers'),
      };
      await writable(ref);
      const map = await mapIssue(ref);
      const blockers = await blockerIssues(ref, body.blockers);
      let issue = await api.createIssue(ref, { title, body: formatTicketBody(body, 0), labels: [kindLabel(kind)] });
      if (questions.length > 0) {
        // The codes carry the issue number, known only now (docs/store-layout.md, "Ticket issues").
        const numbered = { ...body, questions: questions.map((text, index) => ({ k: index + 1, text })) };
        issue = await api.editIssue(ref, issue.number, { body: formatTicketBody(numbered, issue.number) });
      }
      await api.addSubIssue(ref, map.number, issue.id);
      for (const blocker of blockers) {
        await api.addBlocker(ref, issue.number, blocker.id);
      }
      return toTicket(ref, issue, []);
    },
    async getTicket(id) {
      return (await readTicket(id, false)).ticket;
    },
    async listTickets(project, filter = {}) {
      const ref = repositoryOf(project);
      const { state, domains } = fieldsOf(filter, 'a ticket filter');
      if (state !== undefined && state !== 'open' && state !== 'closed') {
        refuse('invalid', `'${String(state)}' is not a ticket state`);
      }
      const wanted = domains === undefined ? null : new Set(checkFilterDomains(domains));
      const me = await api.viewer();
      const issues = await listTicketIssues(ref, state ?? 'all');
      const tickets = await Promise.all(issues.map(async (issue) => toTicket(ref, issue, await commentsOf(ref, issue))));
      const mine = (ticket: Ticket): boolean => ticket.assignee !== null && sameLogin(ticket.assignee, me);
      return tickets
        .filter((ticket) => wanted === null || mine(ticket) || ticket.noDomain || ticket.domains.some((domain) => wanted.has(domain)))
        .sort((a, b) => Number(mine(b)) - Number(mine(a)) || a.id.number - b.id.number);
    },
    async updateTicket(id, patch: Parameters<Store['updateTicket']>[1]) {
      const fields = fieldsOf(patch, 'the ticket fields to change');
      const title = fields.title === undefined ? undefined : oneLine(checkText(fields.title, 'title'));
      if (title === '') {
        refuse('invalid', 'A ticket needs a title');
      }
      const kind = fields.kind === undefined ? undefined : checkKind(fields.kind);
      const setDomains = fields.domains === undefined ? undefined : checkDomains(fields.domains);
      if (fields.noDomain !== undefined && typeof fields.noDomain !== 'boolean') {
        refuse('invalid', "'noDomain' must be true or false");
      }
      const changes: Partial<TicketBody> = {
        ...(fields.question === undefined ? {} : { question: checkSectionText(fields.question, 'question') }),
        ...(fields.whyItMatters === undefined ? {} : { whyItMatters: checkSectionText(fields.whyItMatters, 'whyItMatters') }),
        ...(fields.assumptions === undefined ? {} : { assumptions: checkItems(fields.assumptions, 'assumptions') }),
        ...(fields.blockers === undefined ? {} : { blockers: checkNumbers(fields.blockers, 'blockers') }),
      };
      const { ref, number, issue, comments, ticket } = await readTicket(id, true);
      const domains = setDomains ?? ticket.domains;
      const noDomain = fields.noDomain ?? ticket.noDomain;
      checkNoDomainAlone(noDomain, domains);
      await checkDeclared(ref, setDomains ?? []);
      const blockers = changes.blockers === undefined ? null : await blockerIssues(ref, changes.blockers, number);
      const labels = [
        ...issue.labels.filter((label) => !isKindLabel(label) && !isDomainLabel(label)),
        kindLabel(kind ?? ticket.kind),
        ...tagLabels({ domains, noDomain }),
      ];
      const body = formatTicketBody({ ...bodyOf(issue), ...changes }, number);
      const edited = await api.editIssue(ref, number, { ...(title === undefined ? {} : { title }), body, labels });
      if (blockers !== null) {
        await syncBlockers(ref, number, blockers);
      }
      return toTicket(ref, edited, comments);
    },
    async tagTicketByHand(id, tags: TicketTags) {
      const fields = fieldsOf(tags, 'the tags to set');
      const domains = checkDomains(fields.domains);
      const noDomain = typeof fields.noDomain === 'boolean' ? fields.noDomain : refuse('invalid', "'noDomain' must be true or false");
      checkNoDomainAlone(noDomain, domains);
      const { ref, number, issue, comments } = await readTicket(id, true);
      await checkDeclared(ref, domains);
      // Every read comes before the first write, so a failed read leaves the ticket as it was.
      const handBack = !noDomain && domains.length === 0;
      const who = handBack ? null : await api.viewer();
      const markers = handBack ? (await api.comments(ref, number)).filter((comment) => isTagsByHand(comment.body)) : [];
      const edited = await api.editIssue(ref, number, { labels: [...issue.labels.filter((label) => !isDomainLabel(label)), ...tagLabels({ domains, noDomain })] });
      if (who !== null) {
        await api.createComment(ref, number, formatTagsByHand({ who, when: timestamp(), domains, noDomain }));
      }
      for (const marker of markers) {
        await api.deleteComment(ref, marker.id);
      }
      return toTicket(ref, edited, comments);
    },
    async closeTicket(id) {
      const { ref, number, comments } = await readTicket(id, true);
      await api.editIssue(ref, number, { state: 'closed', state_reason: 'completed' });
      const latest = decisionsIn(comments).at(-1);
      if (latest !== undefined) {
        await changeMap(ref, (map) =>
          map.settled.some((line) => line.ticket === number) ? map : { ...map, settled: [...map.settled, { ticket: number, gist: latest.gist }] },
        );
      }
      return mapDone(ref, number);
    },
    async mergeTicket(id, into) {
      const { ref, number } = await readTicket(id, true);
      const target = fieldsOf(into, 'the ticket to merge into');
      const sameProject = typeof target.project === 'string' && target.project.toLowerCase() === projectIdOf(ref).toLowerCase();
      const other = sameProject && isIssueNumber(target.number) && target.number !== number ? await api.issue(ref, target.number) : null;
      if (other === null || !isTicketIssue(other) || other.state === 'closed') {
        refuse('invalid', `Ticket ${number} can only merge into another open ticket of ${projectIdOf(ref)}`);
      }
      const pointer = mergePointer(other.number);
      await writeDecision(ref, number, { kind: 'decision', sources: [], via: null, gist: pointer, text: pointer });
      await api.editIssue(ref, number, { state: 'closed', state_reason: 'duplicate', duplicate_issue_id: other.id });
      return mapDone(ref, number);
    },
    async reopenTicket(id) {
      const { ref, number, comments } = await readTicket(id, true);
      const issue = await api.editIssue(ref, number, { state: 'open', state_reason: 'reopened' });
      await changeMap(ref, (map) => ({ ...map, settled: map.settled.filter((line) => line.ticket !== number) }));
      return toTicket(ref, issue, comments);
    },
    async claimTicket(id) {
      ticketRef(id);
      return take(id, await api.viewer());
    },
    async sendTicket(id, login) {
      const { ref } = ticketRef(id);
      return take(id, await memberLogin(ref, login));
    },
    async reassignTicket(id, login) {
      const { ref, number } = ticketRef(id);
      const member = await memberLogin(ref, login);
      return setAssignees(id, [member], (comments) => {
        if (answersIn(comments).length > 0) {
          refuse('conflict', `Ticket ${number} already has answers; only an unanswered ticket is reassigned`);
        }
      });
    },
    async releaseTicket(id) {
      return setAssignees(id, [], () => undefined);
    },

    async addQuestion(id, text) {
      const question = checkQuestionText(text);
      const { ref, issue, comments } = await readTicket(id, true);
      return editBody(ref, issue, comments, (body) => {
        const k = Math.max(0, ...body.questions.map((line) => line.k)) + 1;
        return { ...body, questions: [...body.questions, { k, text: question }] };
      });
    },
    async updateQuestion(id, code, text) {
      const question = checkQuestionText(text);
      const { ref, issue, comments, ticket } = await readTicket(id, true);
      const k = parseQuestionCode(checkQuestion(ticket, code))!.k;
      return editBody(ref, issue, comments, (body) => ({
        ...body,
        questions: body.questions.map((line) => (line.k === k ? { k, text: question } : line)),
      }));
    },
    async removeQuestion(id, code) {
      const { ref, issue, comments, ticket } = await readTicket(id, true);
      const found = checkQuestion(ticket, code);
      if (answersIn(comments).some((answer) => answer.question === found)) {
        refuse('conflict', `Question ${found} has an answer: delete the answer first`);
      }
      const k = parseQuestionCode(found)!.k;
      return editBody(ref, issue, comments, (body) => ({
        ...body,
        questions: body.questions.map((line) => (line.k === k ? { k, text: null } : line)),
      }));
    },

    async createAnswer(id, input) {
      const fields = fieldsOf(input, 'a new answer');
      const header = checkComment(input);
      const text = checkText(fields.text, 'text');
      const fromComment = fields.fromComment ?? null;
      const { ref, number, comments, ticket } = await readTicket(id, true);
      const question = checkQuestion(ticket, fields.question);
      if (fromComment !== null) {
        const waiting = comments.some((entry) => entry.kind === 'plain' && entry.id === fromComment);
        if (!waiting || answersIn(comments).some((answer) => answer.from === fromComment)) {
          refuse('invalid', `Comment ${String(fromComment)} is not waiting to be turned into an answer`);
        }
      }
      const created = await addComment(ref, number, { kind: 'answer', ...header, question, from: fromComment, text });
      return toAnswer(ticket.id, created as AnswerComment);
    },
    async listAnswers(id) {
      const { comments, ticket } = await readTicket(id, false);
      return answersIn(comments).map((comment) => toAnswer(ticket.id, comment));
    },
    async updateAnswer(id, answerId, text) {
      const content = checkText(text, 'text');
      const { ref, comments, ticket } = await readTicket(id, true);
      return toAnswer(ticket.id, await rewrite(ref, find<AnswerComment>(comments, 'answer', answerId), { text: content }));
    },
    async deleteAnswer(id, answerId) {
      const { ref, comments } = await readTicket(id, true);
      await api.deleteComment(ref, find<AnswerComment>(comments, 'answer', answerId).id);
    },
    async createDiscussion(id, input) {
      const fields = fieldsOf(input, 'a new discussion');
      const header = checkComment(input);
      const transcript = checkText(fields.transcript, 'transcript');
      const session = fields.sessionFile ?? null;
      if (session !== null && !isSessionFile(session)) {
        refuse('invalid', `'${String(session)}' is not a session file such as .grillo/sessions/2026-10-24-091500.md`);
      }
      const { ref, number, ticket } = await readTicket(id, true);
      const question = checkQuestion(ticket, fields.question);
      const created = await addComment(ref, number, { kind: 'discussion', ...header, question, session, transcript });
      return toDiscussion(ticket.id, created as DiscussionComment);
    },
    async listDiscussions(id) {
      const { comments, ticket } = await readTicket(id, false);
      return discussionsIn(comments).map((comment) => toDiscussion(ticket.id, comment));
    },
    async updateDiscussion(id, discussionId, transcript) {
      const content = checkText(transcript, 'transcript');
      const { ref, comments, ticket } = await readTicket(id, true);
      return toDiscussion(ticket.id, await rewrite(ref, find<DiscussionComment>(comments, 'discussion', discussionId), { transcript: content }));
    },
    async deleteDiscussion(id, discussionId) {
      const { ref, comments } = await readTicket(id, true);
      await api.deleteComment(ref, find<DiscussionComment>(comments, 'discussion', discussionId).id);
    },
    async createDecision(id, input) {
      const fields = fieldsOf(input, 'a new decision');
      const header = checkComment(input);
      const text = checkText(fields.text, 'text');
      const gist = oneLine(checkText(fields.gist, 'gist'));
      const { ref, number, ticket } = await readTicket(id, true);
      await mapIssue(ref);
      return toDecision(ticket.id, await writeDecision(ref, number, { kind: 'decision', ...header, gist, text }));
    },
    async listDecisions(id) {
      const { comments, ticket } = await readTicket(id, false);
      return decisionsIn(comments).map((comment) => toDecision(ticket.id, comment));
    },
    async updateDecision(id, decisionId, patch) {
      const fields = fieldsOf(patch, 'the decision fields to change');
      const change: Partial<DecisionComment> = {
        ...(fields.text === undefined ? {} : { text: checkText(fields.text, 'text') }),
        ...(fields.gist === undefined ? {} : { gist: oneLine(checkText(fields.gist, 'gist')) }),
      };
      const { ref, number, comments, ticket } = await readTicket(id, true);
      const decision = find<DecisionComment>(comments, 'decision', decisionId);
      const updated = await rewrite(ref, decision, change);
      if (updated.gist !== decision.gist) {
        await changeMap(ref, (map) => {
          const index = map.settled.findIndex((line) => line.ticket === number && line.gist === decision.gist);
          return index < 0 ? map : { ...map, settled: map.settled.map((line, at) => (at === index ? { ticket: number, gist: updated.gist } : line)) };
        });
      }
      return toDecision(ticket.id, updated);
    },
    async deleteDecision(id, decisionId) {
      const { ref, number, comments } = await readTicket(id, true);
      const decision = find<DecisionComment>(comments, 'decision', decisionId);
      await changeMap(ref, (map) => withoutLine(map, number, decision.gist));
      await api.deleteComment(ref, decision.id);
    },
    async listPickupComments(id) {
      const { comments, ticket } = await readTicket(id, false);
      const turned = new Set(answersIn(comments).map((answer) => answer.from));
      return comments
        .filter((entry): entry is PlainComment => entry.kind === 'plain' && !turned.has(entry.id))
        .map(({ id: commentId, author, when, text }): PickupComment => ({ id: commentId, ticket: ticket.id, author, when, text }));
    },
  };
}
