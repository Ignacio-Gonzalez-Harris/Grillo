/**
 * What the tickets screen reads and writes through the store (PRD sections 4.3 items 2-5, 4.4 items 1 and 5; screen 4):
 * the member's own list in its three groups, the open ticket's questions with their answers and discussions, the
 * GitHub comments waiting to be picked up, and the hand-changed domain tags.
 *
 * Store results are checked before they are drawn. Anything Grillo cannot read is refused with one `StoreError`
 * (`backend`), the only error the screen handles; it shows that error's message.
 */
import type { Store, TicketTags } from '../../../main/store/store';
import type { Answer, Discussion, Member, Source, Ticket, TicketId } from '../../../main/store/types';
import { StoreError } from '../../../shared/store';
import { readMapView, type MapView } from '../map/map-data';
import { readTicketView, type QuestionView } from '../own-time/ticket';

/** Everything the list shows: the map screen's reading, plus how many GitHub comments wait to be picked up. */
export interface TicketsView extends MapView {
  pickupComments: number;
}

/** The open ticket's questions with their latest answers, and its discussions word for word. */
export interface TicketDetail {
  ticket: TicketId;
  questions: QuestionView[];
  discussions: Discussion[];
}

/** The member's own list (PRD section 4.4 item 1): their tickets first, then their domains, then everything else. */
export interface TicketGroups {
  /** Taken by or sent to the member. */
  mine: Ticket[];
  /** In the pool, in one of the member's domains or tagged "no domain". */
  domains: Ticket[];
  /** Held by someone else, or in other domains, or not tagged yet. */
  others: Ticket[];
  closed: Ticket[];
}

/** The "no domain" choice of the tag picker, beside the declared domains. */
export const NO_DOMAIN = 'no domain';

const isText = (value: unknown): value is string => typeof value === 'string';

function unreadable(what: string): never {
  throw new StoreError('backend', `Grillo could not read ${what} from the store.`);
}

/** GitHub logins compare without regard to case. */
export const sameLogin = (a: string | null, b: string): boolean => a !== null && a.toLowerCase() === b.toLowerCase();

export const isMine = (ticket: Ticket, member: Member): boolean => sameLogin(ticket.assignee, member.login);

/** Locked: taken by or sent to another member. Nobody else can take it; everyone can still read and discuss it. */
export const lockedByOther = (ticket: Ticket, member: Member): boolean => ticket.assignee !== null && !isMine(ticket, member);

function inMyDomains(ticket: Ticket, member: Member): boolean {
  const mine = new Set(member.domains.map((domain) => domain.trim()));
  return ticket.noDomain || ticket.domains.some((domain) => mine.has(domain.trim()));
}

function matches(ticket: Ticket, search: string): boolean {
  const words = search.trim().toLowerCase();
  if (words === '') return true;
  const questions = Array.isArray(ticket.questions) ? ticket.questions.map((question) => question?.text) : [];
  return [ticket.title, ticket.question, ...questions].some((text) => isText(text) && text.toLowerCase().includes(words));
}

/** The tickets matching the search, in the list's groups, each in issue order. */
export function groupTickets(tickets: readonly Ticket[], member: Member, search = ''): TicketGroups {
  const groups: TicketGroups = { mine: [], domains: [], others: [], closed: [] };
  for (const ticket of tickets.filter((candidate) => matches(candidate, search))) {
    if (ticket.state === 'closed') groups.closed.push(ticket);
    else if (isMine(ticket, member)) groups.mine.push(ticket);
    else if (ticket.assignee === null && inMyDomains(ticket, member)) groups.domains.push(ticket);
    else groups.others.push(ticket);
  }
  return groups;
}

/** The ticket the list opens first: the first of the member's own, then their domains, then the rest. */
export function firstTicket(groups: TicketGroups): Ticket | undefined {
  return [...groups.mine, ...groups.domains, ...groups.others, ...groups.closed][0];
}

/** How many plain member comments on open tickets wait to be turned into answers: one store call for the project. */
async function pickupCount(store: Store, project: string): Promise<number> {
  const comments: unknown = await store.listProjectPickupComments(project);
  if (!Array.isArray(comments)) unreadable(`the GitHub comments on the tickets of ${project}`);
  return new Set(comments.map((comment) => (comment as { id?: unknown } | null)?.id).filter(isText)).size;
}

/** Reads the project, every ticket and source, and the waiting GitHub comments, fresh from the store. */
export async function readTicketsView(store: Store, project: string): Promise<TicketsView> {
  const [view, pickupComments] = await Promise.all([readMapView(store, project), pickupCount(store, project)]);
  return { ...view, pickupComments };
}

function isDiscussion(value: unknown): value is Discussion {
  const discussion = value as Partial<Record<keyof Discussion, unknown>> | null;
  return (
    typeof discussion === 'object' &&
    discussion !== null &&
    isText(discussion.id) &&
    isText(discussion.question) &&
    isText(discussion.transcript) &&
    isText(discussion.who) &&
    isText(discussion.when)
  );
}

/** Reads one ticket's questions with their answers, and its discussions (unreadable ones left out). */
export async function readTicketDetail(store: Store, id: TicketId): Promise<TicketDetail> {
  const [view, discussions] = await Promise.all([readTicketView(store, id), store.listDiscussions(id)]);
  if (!Array.isArray(discussions)) unreadable(`the discussions of ticket ${id.number}`);
  const seen = new Set<string>();
  return {
    ticket: id,
    questions: view.questions,
    discussions: discussions.filter(isDiscussion).filter(({ id: entry }) => !seen.has(entry) && Boolean(seen.add(entry))),
  };
}

/** An answer as the question row tells it: what was said, where it came from, and who recorded it. */
export interface AnswerLine {
  text: string;
  /** Turned from a member's comment in GitHub's own app. */
  viaGithub: boolean;
  /** For a GitHub answer: who wrote the comment and the day, as its source records them. */
  origin: string | null;
  recordedBy: string;
  day: string;
  sources: string[];
}

const dayOf = (when: string): string => when.slice(0, 10);

/** Reads what the row shows from an answer and the project's sources, whatever fields the store left out. */
export function answerLine(answer: Answer, sources: readonly Source[]): AnswerLine {
  const codes = Array.isArray(answer.sources) ? [...new Set(answer.sources.filter(isText))] : [];
  const viaGithub = answer.via === 'github';
  const source = sources.find((candidate) => codes.includes(candidate.code));
  const when = isText(answer.when) ? answer.when : '';
  return {
    text: isText(answer.text) ? answer.text : '',
    viaGithub,
    origin: viaGithub ? `${source?.who.trim() || 'a member'}, via GitHub, ${dayOf(source?.when ?? when)}` : null,
    recordedBy: isText(answer.who) && answer.who !== '' ? answer.who : 'an unknown member',
    day: dayOf(when),
    sources: codes,
  };
}

/** The domains the tag picker offers: every declared domain the ticket lacks, then "no domain" unless it has it. */
export function tagChoices(ticket: Ticket, declared: readonly string[]): string[] {
  const choices = declared.filter((domain) => !ticket.domains.includes(domain));
  return ticket.noDomain ? choices : [...choices, NO_DOMAIN];
}

/** Adds a domain by hand (PRD section 4.3 item 2); "no domain" replaces every domain, and a domain replaces it. */
export function withTag(ticket: Ticket, tag: string): TicketTags {
  if (tag === NO_DOMAIN) return { domains: [], noDomain: true };
  const domain = tag.trim();
  if (domain === '') throw new StoreError('invalid', 'Pick a domain to add.');
  return { domains: ticket.domains.includes(domain) ? [...ticket.domains] : [...ticket.domains, domain], noDomain: false };
}

/**
 * Removes a domain by hand; removing the last one leaves "no domain", the tag the hand-set marker can name. Removing
 * "no domain" leaves the ticket untagged, which hands it back to the tagging round.
 */
export function withoutTag(ticket: Ticket, tag: string): TicketTags {
  if (tag === NO_DOMAIN) return { domains: [...ticket.domains], noDomain: false };
  const domains = ticket.domains.filter((domain) => domain !== tag);
  return { domains, noDomain: domains.length === 0 };
}
