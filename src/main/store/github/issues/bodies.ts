/**
 * The bodies of Grillo's issues and comments (docs/store-layout.md: "The map issue", "Ticket issues" and
 * "Comment markers"), read and written. A body that does not match its format is refused as a `backend`
 * error naming the issue or comment, so a hand-edited body reaches callers as the one error type they handle.
 */
import { StoreError } from '../../store';
import type { IsoDateTime, Login, QuestionCode, SettledLine, SourceCode, TicketKind, Via } from '../../types';
import { formatHeader, parseHeader, splitList } from '../repo/records';
import { isLogin, isSessionId, sameLogin, sourceNumberOf } from '../repo/names';

export const MAP_TITLE = 'Map';
export const MAP_LABEL = 'wayfinder:map';
export const TICKET_KINDS: readonly TicketKind[] = ['grilling', 'research', 'prototype', 'task'];
export const NO_DOMAIN_LABEL = 'domain:none';
const KIND_PREFIX = 'wayfinder:';
const DOMAIN_PREFIX = 'domain:';
/** The text a removed question keeps, so its code is never reused. */
export const REMOVED_QUESTION = '(removed)';
const SECTION_START = '### ';
const ITEM_START = '- ';

export const kindLabel = (kind: TicketKind): string => `${KIND_PREFIX}${kind}`;
export const domainLabel = (domain: string): string => `${DOMAIN_PREFIX}${domain}`;
export const isKindLabel = (label: string): boolean => TICKET_KINDS.some((kind) => kindLabel(kind) === label);
export const isDomainLabel = (label: string): boolean => label.startsWith(DOMAIN_PREFIX);
export const domainOf = (label: string): string => label.slice(DOMAIN_PREFIX.length);
export const questionCode = (ticket: number, k: number): QuestionCode => `Q${ticket}.${k}`;

const QUESTION_CODE = /^Q([1-9]\d*)\.([1-9]\d*)$/;
const COMMENT_ID = /^[1-9]\d*$/;
const SESSION_FILE = /^\.grillo\/sessions\/([^/]+)\.md$/;

/** The ticket number and question number of a `Q<n>.<k>` code; null for anything else. */
export function parseQuestionCode(code: unknown): { ticket: number; k: number } | null {
  const match = typeof code === 'string' ? QUESTION_CODE.exec(code) : null;
  return match ? { ticket: Number(match[1]), k: Number(match[2]) } : null;
}

export const isCommentId = (value: unknown): value is string => typeof value === 'string' && COMMENT_ID.test(value);

export function isSessionFile(value: unknown): value is string {
  const match = typeof value === 'string' ? SESSION_FILE.exec(value) : null;
  return match !== null && isSessionId(match[1]);
}

class Malformed extends Error {}

function malformed(why: string): never {
  throw new Malformed(why);
}

/** Runs a parser; whatever it trips over becomes one `backend` refusal naming the issue or comment. */
function reading<T>(what: string, parse: () => T): T {
  try {
    return parse();
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    throw new StoreError('backend', `${what} is not in the format Grillo writes: ${why}`);
  }
}

const unixLines = (text: string): string => text.replace(/\r\n/g, '\n');

/** One line, as a list item or a header value must be: a line break inside it becomes a space. */
export const oneLine = (text: string): string => text.replace(/\r\n|\r|\n/g, ' ').trim();

// Sections: `### <heading>` lines in a fixed order, each followed by its content.

function formatSections(sections: [heading: string, content: string][]): string {
  return sections.map(([heading, content]) => `${SECTION_START}${heading}\n${content === '' ? '' : `${content}\n`}`).join('\n');
}

function parseSections(body: string, headings: readonly string[]): string[][] {
  const contents: string[][] = [];
  for (const line of unixLines(body).split('\n')) {
    if (line.startsWith(SECTION_START)) {
      const expected = headings[contents.length];
      if (line.slice(SECTION_START.length).trim() !== expected) {
        malformed(expected === undefined ? `unknown section '${line}'` : `expected the section '${SECTION_START}${expected}', found '${line}'`);
      }
      contents.push([]);
    } else if (contents.length === 0) {
      if (line.trim() !== '') {
        malformed(`text before the section '${SECTION_START}${headings[0]}'`);
      }
    } else {
      contents[contents.length - 1].push(line);
    }
  }
  if (contents.length !== headings.length) {
    malformed(`missing the section '${SECTION_START}${headings[contents.length]}'`);
  }
  return contents;
}

const textOf = (lines: string[]): string => lines.join('\n').trim();

function itemsOf(lines: string[], section: string): string[] {
  return lines
    .filter((line) => line.trim() !== '')
    .map((line) => (line.startsWith(ITEM_START) ? line.slice(ITEM_START.length).trim() : malformed(`every line of '${section}' must start with '- '`)));
}

const formatItems = (items: string[]): string => items.map((item) => `${ITEM_START}${item}`).join('\n');

// The map issue.

const MAP_SECTIONS = ['Destination', 'Notes', 'Settled', 'Fog', 'Out of scope'] as const;
const SETTLED_LINE = /^#([1-9]\d*)(?: (.*))?$/;

export interface MapBody {
  destination: string;
  notes: string;
  settled: SettledLine[];
  fog: string[];
  outOfScope: string[];
}

export function formatMapBody({ destination, notes, settled, fog, outOfScope }: MapBody): string {
  return formatSections([
    ['Destination', destination],
    ['Notes', notes],
    ['Settled', formatItems(settled.map(({ ticket, gist }) => (gist === '' ? `#${ticket}` : `#${ticket} ${gist}`)))],
    ['Fog', formatItems(fog)],
    ['Out of scope', formatItems(outOfScope)],
  ]);
}

export function parseMapBody(body: string, what: string): MapBody {
  return reading(what, () => {
    const [destination, notes, settled, fog, outOfScope] = parseSections(body, MAP_SECTIONS);
    return {
      destination: textOf(destination),
      notes: textOf(notes),
      settled: itemsOf(settled, 'Settled').map((item) => {
        const match = SETTLED_LINE.exec(item) ?? malformed(`'${item}' is not a settled line '- #<ticket> <gist>'`);
        return { ticket: Number(match[1]), gist: (match[2] ?? '').trim() };
      }),
      fog: itemsOf(fog, 'Fog'),
      outOfScope: itemsOf(outOfScope, 'Out of scope'),
    };
  });
}

// Ticket issues.

const TICKET_SECTIONS = ['Question', 'Why it matters', 'Assumptions', 'Questions', 'Blocked by'] as const;
const QUESTION_LINE = /^Q([1-9]\d*)\.([1-9]\d*)(?: (.*))?$/;
const BLOCKER_LINE = /^#([1-9]\d*)$/;

/** One line of a ticket's questions section; `text` is null for a removed question. */
export interface QuestionLine {
  k: number;
  text: string | null;
}

export interface TicketBody {
  question: string;
  whyItMatters: string;
  assumptions: string[];
  questions: QuestionLine[];
  blockers: number[];
}

export function formatTicketBody({ question, whyItMatters, assumptions, questions, blockers }: TicketBody, ticket: number): string {
  return formatSections([
    ['Question', question],
    ['Why it matters', whyItMatters],
    ['Assumptions', formatItems(assumptions)],
    ['Questions', formatItems(questions.map(({ k, text }) => `${questionCode(ticket, k)} ${text ?? REMOVED_QUESTION}`))],
    ['Blocked by', formatItems(blockers.map((blocker) => `#${blocker}`))],
  ]);
}

export function parseTicketBody(body: string, ticket: number, what: string): TicketBody {
  return reading(what, () => {
    const [question, whyItMatters, assumptions, questions, blockers] = parseSections(body, TICKET_SECTIONS);
    const lines = itemsOf(questions, 'Questions').map((item): QuestionLine => {
      const match = QUESTION_LINE.exec(item) ?? malformed(`'${item}' is not a question line '- Q${ticket}.<k> <text>'`);
      if (Number(match[1]) !== ticket) {
        malformed(`question ${match[1]}.${match[2]} belongs to another ticket`);
      }
      const text = (match[3] ?? '').trim();
      return { k: Number(match[2]), text: text === REMOVED_QUESTION ? null : text };
    });
    if (new Set(lines.map((line) => line.k)).size !== lines.length) {
      malformed('a question code appears twice');
    }
    return {
      question: textOf(question),
      whyItMatters: textOf(whyItMatters),
      assumptions: itemsOf(assumptions, 'Assumptions'),
      questions: lines,
      blockers: itemsOf(blockers, 'Blocked by').map((item) => Number((BLOCKER_LINE.exec(item) ?? malformed(`'${item}' is not a blocker line '- #<issue number>'`))[1])),
    };
  });
}

// Comment markers.

const MARKER = /^<!-- grillo:([a-z-]+) -->$/;
const marker = (kind: string): string => `<!-- grillo:${kind} -->`;
const VIAS: readonly Via[] = ['github', 'generic-agent'];
const LIST_SEPARATOR = ', ';

interface MarkedHeader {
  id: string;
  who: Login;
  when: IsoDateTime;
  sources: SourceCode[];
  via: Via | null;
}

export interface AnswerComment extends MarkedHeader {
  kind: 'answer';
  question: QuestionCode;
  /** The plain member comment it was turned from; null when typed. */
  from: string | null;
  text: string;
}

export interface DiscussionComment extends MarkedHeader {
  kind: 'discussion';
  question: QuestionCode;
  session: string | null;
  transcript: string;
}

export interface DecisionComment extends MarkedHeader {
  kind: 'decision';
  gist: string;
  text: string;
}

/** A comment with no marker: written by a member in GitHub's own app. */
export interface PlainComment {
  kind: 'plain';
  id: string;
  author: Login;
  when: IsoDateTime;
  text: string;
}

/** A comment carrying a Grillo marker this version does not know: never shown, never turned into an answer. */
export interface OtherComment {
  kind: 'other';
  id: string;
}

export type MarkedComment = AnswerComment | DiscussionComment | DecisionComment;

/** `Omit` taken over each member of a union, so the members stay apart. */
export type OmitEach<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type IssueComment = MarkedComment | PlainComment | OtherComment;

/** A comment as GitHub hands it over. */
export interface RawComment {
  id: string;
  body: string;
  author: Login;
  createdAt: IsoDateTime;
  /** GitHub's `author_association`, the author's standing in the repository; absent when GitHub does not say. */
  association?: string | null;
}

const HEADERS = {
  answer: ['who', 'when', 'sources', 'via', 'question', 'from'],
  discussion: ['who', 'when', 'sources', 'via', 'question', 'session'],
  decision: ['who', 'when', 'sources', 'via', 'gist'],
} as const;

export function formatComment(record: OmitEach<MarkedComment, 'id'>): string {
  const common: [string, string][] = [
    ['who', record.who],
    ['when', record.when],
    ['sources', record.sources.join(LIST_SEPARATOR)],
    ['via', record.via ?? ''],
  ];
  switch (record.kind) {
    case 'answer':
      return `${marker('answer')}\n${formatHeader([...common, ['question', record.question], ['from', record.from ?? '']], record.text)}`;
    case 'discussion':
      return `${marker('discussion')}\n${formatHeader([...common, ['question', record.question], ['session', record.session ?? '']], record.transcript)}`;
    case 'decision':
      return `${marker('decision')}\n${formatHeader([...common, ['gist', record.gist]], record.text)}`;
  }
}

function checked<T extends string>(value: string, valid: (value: string) => boolean, field: string): T {
  return valid(value) ? (value as T) : malformed(`'${value}' is not a valid '${field}'`);
}

const orNull = (value: string): string | null => (value === '' ? null : value);

export function parseComment(raw: RawComment): IssueComment {
  const lines = unixLines(raw.body).split('\n');
  const kind = MARKER.exec(lines[0])?.[1];
  if (kind === undefined) {
    return { kind: 'plain', id: raw.id, author: raw.author, when: raw.createdAt, text: raw.body };
  }
  if (kind !== 'answer' && kind !== 'discussion' && kind !== 'decision') {
    return { kind: 'other', id: raw.id };
  }
  return reading(`comment ${raw.id}`, (): MarkedComment => {
    const { values, body } = parseHeader(lines.slice(1).join('\n'), HEADERS[kind]);
    const header: MarkedHeader = {
      id: raw.id,
      who: checked(values.who, isLogin, 'who'),
      when: values.when,
      sources: splitList(values.sources).map((code) => checked(code, (value) => sourceNumberOf(value) !== null, 'sources')),
      via: values.via === '' ? null : checked<Via>(values.via, (value) => VIAS.includes(value as Via), 'via'),
    };
    if (kind === 'decision') {
      return { kind, ...header, gist: values.gist, text: body };
    }
    const question = checked(values.question, (value) => parseQuestionCode(value) !== null, 'question');
    if (kind === 'answer') {
      return { kind, ...header, question, from: orNull(checked(values.from, (value) => value === '' || isCommentId(value), 'from')), text: body };
    }
    return { kind, ...header, question, session: orNull(checked(values.session, (value) => value === '' || isSessionFile(value), 'session')), transcript: body };
  });
}

// The tags-by-hand marker: the domain tags a member set by hand, which a tagging round never changes.

export const TAGS_BY_HAND_MARKER = marker('tags-by-hand');
const TAGS_BY_HAND_HEADERS = ['who', 'when', 'domains'] as const;
/** The `domains:` value that stands for the "no domain" tag. */
const NO_DOMAIN_VALUE = domainOf(NO_DOMAIN_LABEL);

export interface TagsByHand {
  who: Login;
  when: IsoDateTime;
  /** The domains the member set; empty when they set the "no domain" tag. */
  domains: string[];
  /** The member set the "no domain" tag (`domain:none`). */
  noDomain: boolean;
}

// Who may be read in a public repository, where anyone can comment and a marker line and a `who:` line prove nothing.

/** GitHub's `author_association` of someone the repository itself gives a place: every other value, or none, is an outsider. */
export const REPOSITORY_ASSOCIATIONS: readonly unknown[] = ['OWNER', 'COLLABORATOR'];
/** Any member of the organisation that owns the repository, with a place in this project or not, so it proves nothing alone. */
export const ORGANISATION_ASSOCIATION = 'MEMBER';

/** Whether a comment in a public repository counts: an organisation member must also be in the project's members file. */
export const isFromCollaborator = ({ association, author }: RawComment, members: readonly Login[]): boolean =>
  REPOSITORY_ASSOCIATIONS.includes(association) ||
  (association === ORGANISATION_ASSOCIATION && members.some((member) => sameLogin(member, author)));

/** Whether a comment body is a tags-by-hand marker: its first line is the marker. */
export const isTagsByHand = (body: string): boolean => unixLines(body).split('\n')[0] === TAGS_BY_HAND_MARKER;

export function formatTagsByHand({ who, when, domains, noDomain }: TagsByHand): string {
  return `${TAGS_BY_HAND_MARKER}\n${formatHeader([['who', who], ['when', when], ['domains', noDomain ? NO_DOMAIN_VALUE : domains.join(LIST_SEPARATOR)]], '')}`;
}

export function parseTagsByHand(body: string, what: string): TagsByHand {
  return reading(what, () => {
    if (!isTagsByHand(body)) {
      malformed(`the first line is not '${TAGS_BY_HAND_MARKER}'`);
    }
    const { values } = parseHeader(unixLines(body).split('\n').slice(1).join('\n'), TAGS_BY_HAND_HEADERS);
    const domains = values.domains === '' ? [] : values.domains.split(',').map((domain) => domain.trim());
    if (domains.length === 0) {
      malformed(`'domains' names no domain; '${NO_DOMAIN_VALUE}' is the "no domain" tag`);
    }
    if (domains.some((domain) => domain === '' || isDomainLabel(domain)) || new Set(domains).size !== domains.length) {
      malformed(`'${values.domains}' is not a list of domain names, each once`);
    }
    const noDomain = domains.includes(NO_DOMAIN_VALUE);
    if (noDomain && domains.length > 1) {
      malformed(`'${NO_DOMAIN_VALUE}' is the "no domain" tag and never comes with a domain`);
    }
    return { who: checked(values.who, isLogin, 'who'), when: values.when, domains: noDomain ? [] : domains, noDomain };
  });
}
