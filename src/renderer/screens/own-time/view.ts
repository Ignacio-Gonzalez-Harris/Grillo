/**
 * The parts the own-time screen and the agent tab's own-time panel share, with the prototype's class names
 * (styled by own-time.css): the ticket's heading row, the question rows, the notes and the Done outcomes.
 */
import { badge, list } from '../../theme/components';
import type { Ticket } from '../../../main/store/types';
import type { QuestionView, TicketView } from './ticket';

export type Content = Node | string;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  children: Content[] = [],
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.append(...children);
  return element;
}

export type NoteTone = 'info' | 'ok' | 'warn' | 'err';

/** A one-line message in a tinted band, as the prototype's `.note`. */
export function note(text: string, tone: NoteTone = 'info'): HTMLParagraphElement {
  const element = el('p', tone === 'info' ? 'note' : `note ${tone}`, [text]);
  if (tone === 'err') element.setAttribute('role', 'alert');
  return element;
}

/** The text of any refusal, to show the member. */
export function messageOf(error: unknown): string {
  return error instanceof Error && error.message !== '' ? error.message : String(error);
}

const TAG_COLOURS = 4;

/** The same domain always gets the same of the four tag colours. */
function tagColour(domain: string): string {
  let hash = 0;
  for (const char of domain) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % TAG_COLOURS;
  return `d${hash + 1}`;
}

function domainTags(ticket: Ticket): HTMLElement[] {
  if (ticket.noDomain) return [el('span', 'tag none', ['no domain'])];
  return ticket.domains.map((domain) => el('span', `tag ${tagColour(domain)}`, [domain]));
}

export type AnswerWith = 'agent' | 'form';

/** "With a grilling agent" or "In a form"; pressing the other one calls `onChoose`. */
function answerWith(current: AnswerWith, onChoose: (choice: AnswerWith) => void): HTMLElement {
  const group = el('div', 'seg');
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Answer with');
  const choices: Array<[AnswerWith, string]> = [
    ['agent', 'With a grilling agent'],
    ['form', 'In a form'],
  ];
  for (const [choice, label] of choices) {
    const option = el('button', '', [label]);
    option.type = 'button';
    option.setAttribute('aria-pressed', String(choice === current));
    option.addEventListener('click', () => {
      if (choice !== current) onChoose(choice);
    });
    group.append(option);
  }
  return group;
}

/** The ticket's title, its domains, "Taken by you" and the choice of how to answer. */
export function headingRow(view: TicketView, current: AnswerWith, onChoose: (choice: AnswerWith) => void): HTMLElement {
  return el('div', 'row', [
    el('h3', 'm0', [view.ticket.title]),
    ...domainTags(view.ticket),
    badge('Taken by you', 'warn'),
    el('span', 'spacer'),
    answerWith(current, onChoose),
  ]);
}

export function answeredBadge(question: QuestionView): HTMLElement {
  return question.answered ? badge('Answered', 'ok') : badge('Open');
}

/** One row per question: its code and text, and whether it is answered. */
export function questionRows(questions: readonly QuestionView[]): HTMLUListElement {
  const rows = list(
    questions.map((question) => {
      const row = document.createDocumentFragment();
      row.append(el('span', '', [`${question.code} ${question.text}`]), answeredBadge(question));
      return row;
    }),
  );
  rows.classList.add('small');
  return rows;
}

function openCount(questions: readonly QuestionView[]): number {
  return questions.filter((question) => !question.answered).length;
}

/** Done with open questions: the ticket is back in the pool, its open questions visible to everyone. */
export function releasedOutcome(view: TicketView): HTMLElement[] {
  const open = openCount(view.questions);
  const still = open === 1 ? '1 question is still open' : `${open} questions are still open`;
  const rows = questionRows(view.questions);
  rows.classList.add('card');
  return [note(`${view.ticket.title} is back in the pool, unlocked. ${still} and visible to everyone.`, 'warn'), rows];
}

/** Done, all answered: the ticket is closed. */
export function closedOutcome(view: TicketView, decisionOnMap: boolean): HTMLElement {
  const where = decisionOnMap ? ', and its decision is on the map' : '';
  return note(`All questions answered. ${view.ticket.title} is closed${where}.`, 'ok');
}
