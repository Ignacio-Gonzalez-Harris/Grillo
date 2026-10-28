/**
 * What the own-time screen reads and writes through the store (PRD section 4.4): the ticket with its questions and
 * their saved answers, a form answer recorded with its own-time source, and Done (close or release).
 *
 * Store results are checked before they are drawn. Anything Grillo cannot read is refused with one `StoreError`
 * (`backend`), the only error the screen handles; it shows that error's message.
 */
import type { Answer, Member, ProjectId, Ticket, TicketId } from '../../../main/store/types';
import type { Store } from '../../../main/store/store';
import { StoreError } from '../../../shared/store';

/** One question as the screen shows it: its saved answer, when it has one. */
export interface QuestionView {
  code: string;
  text: string;
  answered: boolean;
  /** The latest answer recorded for this question; null while it is open or when no answer could be read. */
  answer: Answer | null;
}

export interface TicketView {
  ticket: Ticket;
  questions: QuestionView[];
  member: Member;
}

const PROJECT_ID = /^[^/\s]+\/[^/\s]+$/;
const ISSUE_NUMBER = /^[1-9][0-9]*$/;

/** The ticket a screen was opened with: `{ project: '<owner>/<repo>', ticket: '<issue number>' }`. */
export function ticketIdFrom(params: Readonly<Record<string, string>>): TicketId | null {
  const project = params['project'];
  const ticket = params['ticket'];
  if (typeof project !== 'string' || !PROJECT_ID.test(project)) return null;
  if (typeof ticket !== 'string' || !ISSUE_NUMBER.test(ticket)) return null;
  return { project, number: Number(ticket) };
}

function unreadable(what: string): never {
  throw new StoreError('backend', `Grillo could not read ${what} from the store.`);
}

const isText = (value: unknown): value is string => typeof value === 'string';

function checkedTicket(value: unknown, id: TicketId): Ticket {
  const ticket = value as Partial<Record<keyof Ticket, unknown>> | null;
  if (
    typeof ticket !== 'object' ||
    ticket === null ||
    !isText(ticket.title) ||
    (ticket.state !== 'open' && ticket.state !== 'closed') ||
    !(ticket.assignee === null || isText(ticket.assignee)) ||
    !Array.isArray(ticket.questions) ||
    !Array.isArray(ticket.domains) ||
    !ticket.domains.every(isText)
  ) {
    unreadable(`ticket ${id.number}`);
  }
  for (const question of ticket.questions as unknown[]) {
    const candidate = question as { code?: unknown; text?: unknown; answered?: unknown } | null;
    if (!isText(candidate?.code) || candidate.code === '' || !isText(candidate.text) || typeof candidate.answered !== 'boolean') {
      unreadable(`the questions of ticket ${id.number}`);
    }
  }
  return value as Ticket;
}

function isAnswer(value: unknown): value is Answer {
  const answer = value as Partial<Record<keyof Answer, unknown>> | null;
  return (
    typeof answer === 'object' &&
    answer !== null &&
    isText(answer.id) &&
    isText(answer.question) &&
    isText(answer.text) &&
    isText(answer.when)
  );
}

/** The questions in order, each code once (the first wins), with the latest readable answer to each. */
function questionViews(ticket: Ticket, answers: unknown): QuestionView[] {
  if (!Array.isArray(answers)) unreadable(`the answers of ticket ${ticket.id.number}`);
  const latest = new Map<string, Answer>();
  for (const answer of answers.filter(isAnswer)) {
    const earlier = latest.get(answer.question);
    if (!earlier || earlier.when <= answer.when) latest.set(answer.question, answer);
  }
  const seen = new Set<string>();
  const firstOfEachCode = ticket.questions.filter(({ code }) => {
    if (seen.has(code)) return false;
    seen.add(code);
    return true;
  });
  return firstOfEachCode.map(({ code, text, answered }) => ({ code, text, answered, answer: answered ? (latest.get(code) ?? null) : null }));
}

function checkedMember(value: unknown): Member {
  const member = value as Partial<Record<keyof Member, unknown>> | null;
  if (typeof member !== 'object' || member === null || !isText(member.login) || member.login === '') {
    unreadable('who you are');
  }
  return value as Member;
}

/** Reads the ticket, its answers and the signed-in member, fresh from the store. */
export async function readTicketView(store: Store, id: TicketId): Promise<TicketView> {
  const ticket = checkedTicket(await store.getTicket(id), id);
  const [answers, member] = await Promise.all([store.listAnswers(id), store.currentMember(id.project)]);
  return { ticket: { ...ticket, id }, questions: questionViews(ticket, answers), member: checkedMember(member) };
}

/** Takes a ticket in the pool for the member; one already theirs is left as it is. */
export async function takeTicket(store: Store, view: TicketView): Promise<TicketView> {
  if (view.ticket.assignee !== null) return view;
  await store.claimTicket(view.ticket.id);
  return readTicketView(store, view.ticket.id);
}

/** Who said it, as an own-time source names them: "Ada Example, developer". */
function speaker(member: Member): string {
  const name = member.name?.trim() || member.login;
  return member.role.trim() === '' ? name : `${name}, ${member.role.trim()}`;
}

export interface SaveAnswerOptions {
  now?: () => Date;
}

/**
 * Records a typed answer the way every answer is recorded: its words saved word for word as an own-time source, then
 * an answer comment (`<!-- grillo:answer -->`) on the ticket citing that source. Saving over an answer records the new
 * one first and only then deletes the old one, so a failure never leaves the question unanswered.
 */
export async function saveAnswer(
  store: Store,
  view: TicketView,
  code: string,
  text: string,
  { now = () => new Date() }: SaveAnswerOptions = {},
): Promise<void> {
  const words = text.trim();
  const question = view.questions.find((candidate) => candidate.code === code);
  if (!question) throw new StoreError('invalid', `Ticket ${view.ticket.id.number} has no question ${code}.`);
  if (words === '') throw new StoreError('invalid', 'Write an answer before saving it.');

  const { id } = view.ticket;
  const source = await store.createSource(id.project, {
    kind: 'own-time-answer',
    who: speaker(view.member),
    when: now().toISOString(),
    where: `Grillo, own-time form on ticket #${id.number}`,
    text: words,
  });
  await store.createAnswer(id, { question: code, text: words, sources: [source.code], via: null, fromComment: null });
  if (question.answer) await store.deleteAnswer(id, question.answer.id);
}

export type DoneResult =
  | { outcome: 'closed'; mapDone: boolean; decisionOnMap: boolean; view: TicketView }
  | { outcome: 'released'; view: TicketView };

/**
 * Done in the form, where no agent is involved (`resources/skills/README.md`, the map-done rule): read the ticket
 * fresh; every question answered closes it, otherwise it goes back to the pool, unlocked. Everything is read before
 * the one write, so an error never hides a close or release that already happened.
 */
export async function finishTicket(store: Store, id: TicketId): Promise<DoneResult> {
  const view = await readTicketView(store, id);
  if (!view.questions.every((question) => question.answered)) {
    await store.releaseTicket(id);
    return { outcome: 'released', view };
  }
  const decisions: unknown = await store.listDecisions(id);
  if (!Array.isArray(decisions)) unreadable(`the decisions of ticket ${id.number}`);
  const result = (await store.closeTicket(id)) as { mapDone?: unknown } | null;
  if (typeof result?.mapDone !== 'boolean') unreadable(`whether the map is done after closing ticket ${id.number}`);
  // closeTicket puts the latest decision's gist line on the map.
  return { outcome: 'closed', mapDone: result.mapDone, decisionOnMap: decisions.length > 0, view };
}

/** The project's folder on this laptop, where an agent starts. */
export async function projectFolder(store: Store, project: ProjectId): Promise<string> {
  const folder: unknown = await store.openProjectFolder(project);
  if (!isText(folder) || folder === '') unreadable(`the folder of ${project}`);
  return folder;
}
