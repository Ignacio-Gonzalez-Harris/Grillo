/**
 * The map screen's building blocks, with the prototype's class names (styled by map.css): notes, the map cards, domain
 * tags, the ticket and source tables, the source panel and the form fields of its dialogs.
 */
import type { Source, SourceKind, Ticket, TicketKind } from '../../../main/store/types';
import { badge } from '../../theme/components';
import { TICKET_KINDS } from './map-data';

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

/** A message in a tinted band, as the prototype's `.note`. */
export function note(children: Content[] | string, tone: NoteTone = 'info'): HTMLElement {
  const element = el('div', tone === 'info' ? 'note' : `note ${tone}`, typeof children === 'string' ? [children] : children);
  if (tone === 'err') element.setAttribute('role', 'alert');
  return element;
}

/** The text of any refusal, to show the member. */
export function messageOf(error: unknown): string {
  return error instanceof Error && error.message !== '' ? error.message : String(error);
}

/** One of the four map cards: a heading, then its lines or a muted line saying there are none. */
export function mapCard(heading: string, lines: readonly string[] | string, empty: string): HTMLElement {
  if (typeof lines === 'string') return el('div', 'card', [el('h4', '', [heading]), el('p', '', [lines])]);
  const body =
    lines.length === 0
      ? el('p', 'muted small', [empty])
      : el(
          'ul',
          'small',
          lines.map((line) => el('li', '', [line])),
        );
  return el('div', 'card', [el('h4', '', [heading]), body]);
}

const TAG_COLOURS = 4;

/**
 * The domain tags of a ticket. Each declared domain gets the tag colour of its place in the declared order, cycled
 * over the four (tokens.css, Domain tag chips); a domain nobody declares takes the next places after them.
 */
export function domainTags(ticket: Ticket, declared: readonly string[]): HTMLElement[] {
  if (ticket.noDomain) return [el('span', 'tag none', ['no domain'])];
  if (ticket.domains.length === 0) return [el('span', 'muted small', ['untagged'])];
  const order = [...declared];
  return ticket.domains.map((domain) => {
    if (!order.includes(domain)) order.push(domain);
    return el('span', `tag d${(order.indexOf(domain) % TAG_COLOURS) + 1}`, [domain]);
  });
}

/** What a member does about a ticket the store could not read (prototype state `damaged-ticket`). */
export const DAMAGED_TICKET_HINT = 'Fix the issue on GitHub; the other tickets work as usual.';

export function kindBadge(kind: TicketKind): HTMLElement {
  return badge(kind);
}

/** A table with a header row, inside the prototype's horizontally scrolling wrapper. */
export function table(headings: readonly string[], rows: readonly Content[][], className = ''): HTMLElement {
  const head = el(
    'tr',
    '',
    headings.map((heading) => el('th', '', [heading])),
  );
  const body = rows.map((cells) =>
    el(
      'tr',
      '',
      cells.map((cell) => el('td', '', [cell])),
    ),
  );
  return el('div', 'table-wrap', [el('table', className, [el('tbody', '', [head, ...body])])]);
}

export const SOURCE_KIND_LABELS: Readonly<Record<SourceKind, string>> = {
  document: 'Document',
  meeting: 'Meeting',
  'own-time-answer': 'Own-time answer',
  'pasted-text': 'Email or pasted text',
};

export const sourceKindLabel = (kind: string): string => SOURCE_KIND_LABELS[kind as SourceKind] ?? kind;

export const codeChip = (code: string): HTMLElement => el('span', 'code-chip', [code]);

/** `2026-10-21`: the day of an ISO moment, in UTC as the store keeps it. */
export const dayOf = (when: string): string => when.slice(0, 10);

/** `2026-10-21, 10:00 UTC`, or the text as stored when it is no ISO moment. */
function momentOf(when: string): string {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(when) ? `${when.slice(0, 10)}, ${when.slice(11, 16)} UTC` : when;
}

/** A source opened to read its full text, as the prototype's raised glass dialog. */
export function sourcePanel(source: Source, close: HTMLElement): HTMLElement {
  const details = el('table', 'small', [
    el('tbody', '', [
      ['Kind', sourceKindLabel(source.kind)],
      ['Who', source.who],
      ['When', momentOf(source.when)],
      ['Where', source.where],
    ].map(([name, value]) => el('tr', '', [el('th', '', [name]), el('td', '', [value])]))),
  ]);
  const lines = source.text.replace(/\r\n?/g, '\n').split('\n');
  const panel = el('div', 'card glass-strong stack source-panel', [
    el('div', 'row', [codeChip(source.code), el('h3', 'm0', [source.where]), el('span', 'spacer'), close]),
    details,
    el('h4', '', ['Full text']),
    el(
      'div',
      'transcript',
      lines.map((line) => el('p', '', [line])),
    ),
  ]);
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', `Source ${source.code}`);
  return panel;
}

/** A labelled one-line text field. */
export function textField(label: string, value = ''): { root: HTMLLabelElement; input: HTMLInputElement } {
  const input = el('input', '');
  input.type = 'text';
  input.value = value;
  return { root: el('label', 'field', [label, input]), input };
}

/** A labelled multi-line text field. */
export function textArea(label: string, value = ''): { root: HTMLLabelElement; input: HTMLTextAreaElement } {
  const input = el('textarea', '');
  input.value = value;
  return { root: el('label', 'field', [label, input]), input };
}

/** A labelled choice from a list of `[value, label]` options. */
export function choice(
  label: string,
  options: ReadonlyArray<readonly [string, string]>,
  value?: string,
): { root: HTMLLabelElement; input: HTMLSelectElement } {
  const input = el(
    'select',
    '',
    options.map(([optionValue, optionLabel]) => {
      const option = el('option', '', [optionLabel]);
      option.value = optionValue;
      return option;
    }),
  );
  if (value !== undefined) input.value = value;
  return { root: el('label', 'field', [label, input]), input };
}

export function kindChoice(value?: TicketKind): { root: HTMLLabelElement; input: HTMLSelectElement } {
  return choice(
    'Kind',
    TICKET_KINDS.map((kind) => [kind, kind] as const),
    value,
  );
}
