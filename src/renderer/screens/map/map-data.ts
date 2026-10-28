/**
 * What the map screen reads and writes through the store (PRD sections 4.2 item 7, 4.3, 4.8; screen 3): the project,
 * its map, every ticket, every source, and the ticket and project actions the screen offers.
 *
 * Store results are checked before they are drawn. Anything Grillo cannot read is refused with one `StoreError`
 * (`backend`), the only error the screen handles; it shows that error's message.
 */
import type { Store } from '../../../main/store/store';
import type {
  Member,
  Permission,
  Project,
  ProjectId,
  ProjectMap,
  SettledLine,
  Source,
  Ticket,
  TicketId,
  TicketKind,
} from '../../../main/store/types';
import { StoreError } from '../../../shared/store';

export const TICKET_KINDS: readonly TicketKind[] = ['grilling', 'research', 'prototype', 'task'];

/** Everything the map screen shows, read fresh from the store. */
export interface MapView {
  project: Project;
  permission: Permission;
  member: Member;
  /** Null while the engine has not created the map yet. */
  map: ProjectMap | null;
  /** Every ticket, open and closed, each issue number once, in number order. */
  tickets: Ticket[];
  sources: Source[];
}

const PROJECT_ID = /^[^/\s]+\/[^/\s]+$/;

const isText = (value: unknown): value is string => typeof value === 'string';
const isTextList = (value: unknown): value is string[] => Array.isArray(value) && value.every(isText);
const isIssueNumber = (value: unknown): value is number => Number.isInteger(value) && (value as number) > 0;

function unreadable(what: string): never {
  throw new StoreError('backend', `Grillo could not read ${what} from the store.`);
}

/**
 * The project the screen shows: the `project` it was opened with (`<owner>/<repo>`), else the project opened last on
 * this laptop. Null when there is neither.
 */
export async function projectFrom(store: Store, params: Readonly<Record<string, string>>): Promise<ProjectId | null> {
  const asked = params['project'];
  if (isText(asked) && PROJECT_ID.test(asked)) return asked;
  const recent: unknown = await store.listRecentProjects();
  if (!Array.isArray(recent)) unreadable('the projects opened on this laptop');
  const last = recent.find((entry) => isText((entry as { project?: unknown } | null)?.project)) as { project: string } | undefined;
  return last?.project ?? null;
}

function checkedProject(value: unknown, id: ProjectId): Project {
  const project = value as Partial<Record<keyof Project, unknown>> | null;
  if (
    typeof project !== 'object' ||
    project === null ||
    !isText(project.name) ||
    typeof project.archived !== 'boolean' ||
    !Array.isArray(project.members)
  ) {
    unreadable(`project ${id}`);
  }
  for (const member of project.members as unknown[]) {
    const line = member as { login?: unknown; domains?: unknown } | null;
    if (!isText(line?.login) || !isTextList(line.domains)) unreadable(`the members of ${id}`);
  }
  return { ...(value as Project), id };
}

function checkedPermission(value: unknown, id: ProjectId): Permission {
  if (value !== 'admin' && value !== 'write' && value !== 'read') unreadable(`your permission on ${id}`);
  return value;
}

function checkedMember(value: unknown): Member {
  const member = value as Partial<Record<keyof Member, unknown>> | null;
  if (typeof member !== 'object' || member === null || !isText(member.login) || member.login === '' || !isTextList(member.domains)) {
    unreadable('who you are');
  }
  return value as Member;
}

function checkedSettled(value: unknown): value is SettledLine {
  const line = value as Partial<Record<keyof SettledLine, unknown>> | null;
  return isIssueNumber(line?.ticket) && isText(line.gist);
}

function checkedMap(value: unknown, id: ProjectId): ProjectMap {
  const map = value as Partial<Record<keyof ProjectMap, unknown>> | null;
  if (
    typeof map !== 'object' ||
    map === null ||
    !isText(map.destination) ||
    !Array.isArray(map.settled) ||
    !map.settled.every(checkedSettled) ||
    !isTextList(map.fog) ||
    !isTextList(map.outOfScope)
  ) {
    unreadable(`the map of ${id}`);
  }
  return value as ProjectMap;
}

function checkedTicket(value: unknown, id: ProjectId): Ticket {
  const ticket = value as Partial<Record<keyof Ticket, unknown>> | null;
  const number = (ticket?.id as { number?: unknown } | undefined)?.number;
  if (
    typeof ticket !== 'object' ||
    ticket === null ||
    !isIssueNumber(number) ||
    !isText(ticket.title) ||
    !TICKET_KINDS.includes(ticket.kind as TicketKind) ||
    (ticket.state !== 'open' && ticket.state !== 'closed') ||
    !(ticket.assignee === null || isText(ticket.assignee)) ||
    !isTextList(ticket.domains) ||
    typeof ticket.noDomain !== 'boolean' ||
    !Array.isArray(ticket.blockers) ||
    !ticket.blockers.every(isIssueNumber)
  ) {
    unreadable(`the tickets of ${id}`);
  }
  return { ...(value as Ticket), id: { project: id, number } };
}

/** Each issue number once (the first wins), in number order. */
function checkedTickets(value: unknown, id: ProjectId): Ticket[] {
  if (!Array.isArray(value)) unreadable(`the tickets of ${id}`);
  const seen = new Set<number>();
  return value
    .map((entry) => checkedTicket(entry, id))
    .filter(({ id: { number } }) => !seen.has(number) && Boolean(seen.add(number)))
    .sort((a, b) => a.id.number - b.id.number);
}

function checkedSources(value: unknown, id: ProjectId): Source[] {
  if (!Array.isArray(value)) unreadable(`the sources of ${id}`);
  for (const entry of value) {
    const source = entry as Partial<Record<keyof Source, unknown>> | null;
    if (
      !isText(source?.code) ||
      source.code === '' ||
      !isText(source.kind) ||
      !isText(source.who) ||
      !isText(source.when) ||
      !isText(source.where) ||
      !isText(source.text)
    ) {
      unreadable(`the sources of ${id}`);
    }
  }
  const seen = new Set<string>();
  return (value as Source[]).filter(({ code }) => !seen.has(code) && Boolean(seen.add(code)));
}

/** The map, or null while the engine has not created it (`not-found`). */
async function mapOrNull(store: Store, id: ProjectId): Promise<ProjectMap | null> {
  try {
    return checkedMap(await store.getMap(id), id);
  } catch (error) {
    if (error instanceof StoreError && error.kind === 'not-found') return null;
    throw error;
  }
}

/** Reads the project, its map, every ticket and every source, fresh from the store. */
export async function readMapView(store: Store, id: ProjectId): Promise<MapView> {
  const [project, permission, member, map, tickets, sources] = await Promise.all([
    store.getProject(id),
    store.viewerPermission(id),
    store.currentMember(id),
    mapOrNull(store, id),
    store.listTickets(id),
    store.listSources(id),
  ]);
  return {
    project: checkedProject(project, id),
    permission: checkedPermission(permission, id),
    member: checkedMember(member),
    map,
    tickets: checkedTickets(tickets, id),
    sources: checkedSources(sources, id),
  };
}

/** The domains the members declared, each once, in the order the members file lists them. */
export function declaredDomains(view: MapView): string[] {
  const names = view.project.members.flatMap(({ domains }) => domains.map((domain) => domain.trim()));
  return [...new Set(names.filter((name) => name !== ''))];
}

export const isTagged = (ticket: Ticket): boolean => ticket.noDomain || ticket.domains.length > 0;

/** Destination, settled, fog and out of scope with no open ticket and no fog: the PRD writer's moment. */
export function mapIsDone(view: MapView): boolean {
  return view.map !== null && view.tickets.length > 0 && view.tickets.every(({ state }) => state === 'closed') && view.map.fog.length === 0;
}

/** The engine is still turning the idea into the map and its first tickets. */
export function engineBuilding(view: MapView): boolean {
  return view.map === null || view.tickets.length === 0;
}

/** Whether the ticket belongs on the member's list first: theirs, in one of their domains, or open to anyone. */
export function inMyDomains(ticket: Ticket, member: Member): boolean {
  const mine = new Set(member.domains.map((domain) => domain.trim()));
  return (
    ticket.assignee?.toLowerCase() === member.login.toLowerCase() ||
    ticket.noDomain ||
    ticket.domains.some((domain) => mine.has(domain.trim()))
  );
}

export interface TicketDraft {
  title: string;
  kind: TicketKind;
  question: string;
  whyItMatters: string;
  /** One question per line; blank lines are dropped. */
  questions: string;
}

function checkedDraft(draft: TicketDraft): { title: string; question: string; whyItMatters: string } {
  const title = draft.title.trim();
  const question = draft.question.trim();
  if (title === '' || question === '') throw new StoreError('invalid', 'Give the ticket a title and a question.');
  if (!TICKET_KINDS.includes(draft.kind)) throw new StoreError('invalid', `'${draft.kind}' is not a ticket kind.`);
  return { title, question, whyItMatters: draft.whyItMatters.trim() };
}

/** Adds a ticket by hand (PRD section 4.2 item 7). With no questions listed, the ticket's question is its one question. */
export async function addTicket(store: Store, project: ProjectId, draft: TicketDraft): Promise<Ticket> {
  const { title, question, whyItMatters } = checkedDraft(draft);
  const lines = draft.questions
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
  return store.createTicket(project, {
    title,
    question,
    whyItMatters,
    assumptions: [],
    kind: draft.kind,
    blockers: [],
    questions: lines.length > 0 ? lines : [question],
  });
}

/** Changes a ticket's title, kind, question and why it matters. */
export async function editTicket(store: Store, id: TicketId, draft: Omit<TicketDraft, 'questions'>): Promise<Ticket> {
  const { title, question, whyItMatters } = checkedDraft({ ...draft, questions: '' });
  return store.updateTicket(id, { title, kind: draft.kind, question, whyItMatters });
}

export interface CloseOutcome {
  mapDone: boolean;
}

function checkedClose(value: unknown, id: TicketId): CloseOutcome {
  const result = value as { mapDone?: unknown } | null;
  if (typeof result?.mapDone !== 'boolean') unreadable(`whether the map is done after closing ticket ${id.number}`);
  return { mapDone: result.mapDone };
}

/** Closes `id` as a duplicate of `into`; the store writes the decision pointing at it. */
export async function mergeTicket(store: Store, id: TicketId, into: number): Promise<CloseOutcome> {
  return checkedClose(await store.mergeTicket(id, { project: id.project, number: into }), id);
}

/** The map's out-of-scope line for a ticket: `<title>: <why> (#<number>)`, as docs/store-layout.md shows it. */
export function outOfScopeLine(ticket: Ticket, why: string): string {
  const reason = why.trim();
  return reason === '' ? `${ticket.title} (#${ticket.id.number})` : `${ticket.title}: ${reason} (#${ticket.id.number})`;
}

const namesTicket = (line: string, number: number): boolean => line.endsWith(`(#${number})`);

/**
 * Closes a ticket as out of scope, as the engine does (resources/skills/grillo-wayfinder/SKILL.md): a line naming it
 * under Out of scope, then the close, with no decision. The line goes first, so a failed close leaves the ticket open;
 * a retry finds the line already there and does not write it twice.
 */
export async function closeAsOutOfScope(store: Store, ticket: Ticket, why: string): Promise<CloseOutcome> {
  const { id } = ticket;
  const map = checkedMap(await store.getMap(id.project), id.project);
  if (!map.outOfScope.some((line) => namesTicket(line, id.number))) {
    await store.updateMap(id.project, { outOfScope: [...map.outOfScope, outOfScopeLine(ticket, why)] });
  }
  return checkedClose(await store.closeTicket(id), id);
}

/** The project's folder on this laptop, where an agent starts. */
export async function projectFolder(store: Store, project: ProjectId): Promise<string> {
  const folder: unknown = await store.openProjectFolder(project);
  if (!isText(folder) || folder === '') unreadable(`the folder of ${project}`);
  return folder;
}
