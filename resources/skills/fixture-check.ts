import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { StoreError } from '../../src/main/store/store';
import {
  type IssueComment,
  isKindLabel,
  MAP_LABEL,
  MAP_TITLE,
  type MapBody,
  NO_DOMAIN_LABEL,
  parseComment,
  parseMapBody,
  parseQuestionCode,
  parseTicketBody,
  type TicketBody,
  TICKET_KINDS,
  kindLabel,
  isDomainLabel,
  domainOf,
} from '../../src/main/store/github/issues/bodies';
import { parseMembers, parseSession, parseSource, parseStructure } from '../../src/main/store/github/repo/records';
import { isLogin, isSessionId, sameLogin, sourceNumberOf } from '../../src/main/store/github/repo/names';
import type { Source, TicketKind, TicketState } from '../../src/main/store/types';

/**
 * Checks a skill's fixture, a made-up snapshot of a Grillo project as a skill leaves it, against
 * `docs/store-layout.md` and the engine rules every Grillo skill follows. Bodies, comments and Grillo-folder files
 * are read with the store's own parsers, so a fixture passes only if the app could read it; the rules a parser does
 * not check (labels, sub-issue and blocker links, question numbering, sources, settled lines, structure coverage) are
 * checked here.
 *
 * A fixture folder holds `issues.json` (the issues: number, title, labels, state, assignee, parent, native blockers,
 * and the paths of their bodies and comments), those body and comment files, and a `.grillo/` folder.
 */

/** The one error a malformed fixture raises. */
export class FixtureError extends Error {
  constructor(message: string) {
    super(`The fixture breaks the store layout: ${message}`);
    this.name = 'FixtureError';
  }
}

export interface CheckedTicket {
  number: number;
  title: string;
  kind: TicketKind;
  state: TicketState;
  labels: string[];
  assignee: string | null;
  body: TicketBody;
  comments: IssueComment[];
}

export interface CheckedFixture {
  map: MapBody;
  tickets: CheckedTicket[];
  sources: Source[];
  /** No open ticket and no fog line: the moment the map-done rule starts the PRD writer. */
  mapDone: boolean;
}

const MANIFEST = 'issues.json';
const MEMBERS_FILE = '.grillo/members.json';
const STRUCTURE_FILE = '.grillo/structure.json';
const SOURCES_FOLDER = '.grillo/sources/';
const SOURCE_FILE = /^\.grillo\/sources\/([^/]+)\.md$/;
const SESSION_FILE = /^\.grillo\/sessions\/([^/]+)\.md$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const DESTINATION_START = 'A PRD';
const MERGE_GIST = /^Merged into #([1-9]\d*)$/;
const COMMENT_ID = /^[1-9]\d*$/;

function fail(why: string): never {
  throw new FixtureError(why);
}

const unixLines = (text: string): string => text.replace(/\r\n/g, '\n');

// The manifest, read as untrusted JSON: every shape it can take other than the expected one is refused.

interface RawCommentEntry {
  id: string;
  author: string;
  createdAt: string;
  body: string;
}

interface RawIssue {
  number: number;
  title: string;
  labels: string[];
  state: TicketState;
  assignee: string | null;
  parent: number | null;
  blockedBy: number[];
  body: string;
  comments: RawCommentEntry[];
}

function objectOf(value: unknown, what: string): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : fail(`${what} must be an object`);
}

function listOf(value: unknown, what: string): unknown[] {
  return Array.isArray(value) ? value : fail(`${what} must be a list`);
}

function textOf(value: unknown, what: string): string {
  return typeof value === 'string' ? value : fail(`${what} must be text`);
}

function issueNumberOf(value: unknown, what: string): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : fail(`${what} must be a positive whole number`);
}

/** A file path inside the fixture: relative, with `/` between folders, never stepping out with `..`. */
function pathOf(value: unknown, what: string): string {
  const path = textOf(value, what);
  if (path === '' || path.startsWith('/') || path.includes('\\') || /^[A-Za-z]:/.test(path) || path.split('/').some((part) => part === '..' || part === '')) {
    fail(`${what} '${path}' is not a path inside the fixture`);
  }
  return path;
}

function momentOf(value: string, what: string): string {
  if (!ISO_UTC.test(value) || Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) {
    fail(`${what} '${value}' is not a moment in ISO 8601 UTC (2026-10-24T09:15:00.000Z)`);
  }
  return value;
}

function rawIssue(value: unknown, what: string, isMap: boolean): RawIssue {
  const entry = objectOf(value, what);
  const state = textOf(entry.state, `${what} state`);
  if (state !== 'open' && state !== 'closed') {
    fail(`${what} state '${state}' is neither 'open' nor 'closed'`);
  }
  const assignee = entry.assignee ?? null;
  return {
    number: issueNumberOf(entry.number, `${what} number`),
    title: textOf(entry.title, `${what} title`),
    labels: listOf(entry.labels, `${what} labels`).map((label) => textOf(label, `${what} labels`)),
    state,
    assignee: assignee === null ? null : textOf(assignee, `${what} assignee`),
    parent: isMap ? null : issueNumberOf(entry.parent, `${what} parent`),
    blockedBy: isMap ? [] : listOf(entry.blockedBy, `${what} blockedBy`).map((number) => issueNumberOf(number, `${what} blockedBy`)),
    body: pathOf(entry.body, `${what} body`),
    comments: isMap
      ? []
      : listOf(entry.comments, `${what} comments`).map((comment, index) => {
          const fields = objectOf(comment, `${what} comment ${index + 1}`);
          const id = textOf(fields.id, `${what} comment id`);
          if (!COMMENT_ID.test(id)) {
            fail(`${what} comment id '${id}' is not a GitHub comment id`);
          }
          const author = textOf(fields.author, `comment ${id} author`);
          if (!isLogin(author)) {
            fail(`comment ${id} author '${author}' is not a GitHub login`);
          }
          return { id, author, createdAt: momentOf(textOf(fields.createdAt, `comment ${id} createdAt`), `comment ${id} createdAt`), body: pathOf(fields.body, `comment ${id} body`) };
        }),
  };
}

function readManifest(files: Record<string, string>): { map: RawIssue; tickets: RawIssue[] } {
  const text = files[MANIFEST] ?? fail(`no ${MANIFEST}`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    fail(`${MANIFEST} is not JSON: ${(error as Error).message}`);
  }
  const manifest = objectOf(parsed, MANIFEST);
  const map = rawIssue(manifest.map, 'the map', true);
  const tickets = listOf(manifest.tickets, 'tickets').map((entry, index) => rawIssue(entry, `ticket ${index + 1}`, false));

  const numbers = new Set<number>();
  for (const issue of [map, ...tickets]) {
    if (numbers.has(issue.number)) {
      fail(`issue #${issue.number} is listed twice`);
    }
    numbers.add(issue.number);
  }
  const ids = new Set<string>();
  for (const comment of tickets.flatMap((ticket) => ticket.comments)) {
    if (ids.has(comment.id)) {
      fail(`comment ${comment.id} is listed twice`);
    }
    ids.add(comment.id);
  }
  return { map, tickets };
}

function fileOf(files: Record<string, string>, path: string): string {
  return files[path] ?? fail(`the file ${path} is missing`);
}

/** Runs a store parser; its refusal becomes a FixtureError. */
function parsing<T>(parse: () => T): T {
  try {
    return parse();
  } catch (error) {
    if (error instanceof StoreError) {
      fail(error.message);
    }
    throw error;
  }
}

// The Grillo folder.

function readSources(files: Record<string, string>): Map<string, Source> {
  const sources = new Map<string, Source>();
  for (const path of Object.keys(files).filter((name) => name.startsWith(SOURCES_FOLDER))) {
    const code = SOURCE_FILE.exec(path)?.[1] ?? '';
    if (sourceNumberOf(code) === null) {
      fail(`${path} is not named S<n>.md`);
    }
    const source = parsing(() => parseSource(files[path], code, path));
    momentOf(source.when, `${path} when`);
    sources.set(code, source);
  }
  // A source takes the next free number, so the numbers run from 1 with no gap.
  const numbers = [...sources.keys()].map((code) => sourceNumberOf(code) as number).sort((a, b) => a - b);
  numbers.forEach((number, index) => {
    if (number !== index + 1) {
      fail(`source S${index + 1} is missing: source numbers run from S1 with no gap`);
    }
  });
  return sources;
}

/** A section name exactly as `structure.json` spells it, a colon and a space: the PRD section a text feeds. */
function sectionNamed(text: string, sections: string[]): string | null {
  return sections.find((name) => text.startsWith(`${name}: `)) ?? null;
}

/** Whether a line names `#<number>`: not part of a longer number or word, not after another `#` or a letter. */
function namesIssue(line: string, number: number): boolean {
  return new RegExp(`(?<![\\w#])#${number}(?![\\w])`).test(line);
}

// The check.

/** Checks a fixture held as `{ path: text }`; refuses anything that breaks the layout with `FixtureError` only. */
export function checkProjectFixture(input: Record<string, string>): CheckedFixture {
  const files = Object.fromEntries(Object.entries(input).map(([path, text]) => [path, unixLines(text)]));
  const { map: rawMap, tickets: rawTickets } = readManifest(files);
  const members = parsing(() => parseMembers(fileOf(files, MEMBERS_FILE), MEMBERS_FILE));
  const sections = parsing(() => parseStructure(fileOf(files, STRUCTURE_FILE), STRUCTURE_FILE)).sections.map((section) => section.name);
  const sources = readSources(files);
  const declaredDomains = new Set(members.flatMap((member) => member.domains));
  const isMember = (login: string): boolean => members.some((member) => sameLogin(member.login, login));

  // The map issue.
  if (rawMap.title !== MAP_TITLE) {
    fail(`the map is titled '${rawMap.title}', not '${MAP_TITLE}'`);
  }
  if (rawMap.labels.length !== 1 || rawMap.labels[0] !== MAP_LABEL) {
    fail(`the map carries [${rawMap.labels.join(', ')}]; it carries exactly '${MAP_LABEL}'`);
  }
  const map = parsing(() => parseMapBody(fileOf(files, rawMap.body), 'the map'));
  if (!map.destination.startsWith(DESTINATION_START)) {
    fail(`the destination '${map.destination}' does not start with '${DESTINATION_START}': the destination is always a PRD`);
  }

  const ticketNumbers = new Set(rawTickets.map((ticket) => ticket.number));
  const tickets = rawTickets.map((raw) => checkTicket(raw));

  function checkTicket(raw: RawIssue): CheckedTicket {
    const name = `ticket #${raw.number}`;
    if (raw.title.trim() === '' || /[\r\n]/.test(raw.title)) {
      fail(`${name} needs a one-line title`);
    }
    if (new Set(raw.labels).size !== raw.labels.length) {
      fail(`${name} carries a label twice`);
    }
    const kinds = TICKET_KINDS.filter((kind) => raw.labels.includes(kindLabel(kind)));
    if (kinds.length !== 1) {
      fail(`${name} carries ${kinds.length} kind labels; a ticket has exactly one`);
    }
    for (const label of raw.labels) {
      if (isKindLabel(label) || label === NO_DOMAIN_LABEL) {
        continue;
      }
      if (!isDomainLabel(label)) {
        fail(`${name} carries '${label}', a label Grillo does not write`);
      }
      if (!declaredDomains.has(domainOf(label))) {
        fail(`${name} carries '${label}', a domain no member declared`);
      }
    }
    if (raw.labels.includes(NO_DOMAIN_LABEL) && raw.labels.some((label) => isDomainLabel(label) && label !== NO_DOMAIN_LABEL)) {
      fail(`${name} carries '${NO_DOMAIN_LABEL}' together with a domain`);
    }
    if (raw.assignee !== null && !isMember(raw.assignee)) {
      fail(`${name} is assigned to '${raw.assignee}', who is no member`);
    }
    if (raw.parent !== rawMap.number) {
      fail(`${name} is no sub-issue of the map #${rawMap.number}`);
    }

    const body = parsing(() => parseTicketBody(fileOf(files, raw.body), raw.number, name));
    body.questions.forEach((question, index) => {
      if (question.k !== index + 1) {
        fail(`${name} lists Q${raw.number}.${question.k} where Q${raw.number}.${index + 1} comes next: codes run from 1 with no gap`);
      }
    });
    const native = [...raw.blockedBy].sort((a, b) => a - b).join(', ');
    if ([...body.blockers].sort((a, b) => a - b).join(', ') !== native) {
      fail(`${name}: its Blocked by section and its native blocked-by relation (${native || 'none'}) disagree`);
    }
    for (const blocker of body.blockers) {
      if (blocker === raw.number || !ticketNumbers.has(blocker)) {
        fail(`${name} is blocked by #${blocker}, which is no other ticket`);
      }
    }
    if (sectionNamed(body.whyItMatters, sections) === null) {
      fail(`${name}: its Why it matters does not start with a structure section's name and ': ' (${sections.join(', ')})`);
    }

    const comments = raw.comments.map((entry) =>
      parsing(() => parseComment({ id: entry.id, author: entry.author, createdAt: entry.createdAt, body: fileOf(files, entry.body) })),
    );
    raw.comments.forEach((entry, index) => checkComment(raw, body, comments.slice(0, index), comments[index], entry, comments));
    return { number: raw.number, title: raw.title, kind: kinds[0], state: raw.state, labels: raw.labels, assignee: raw.assignee, body, comments };
  }

  function checkComment(raw: RawIssue, body: TicketBody, earlier: IssueComment[], comment: IssueComment, entry: RawCommentEntry, all: IssueComment[]): void {
    const name = `comment ${entry.id} (${entry.body})`;
    if (comment.kind === 'other') {
      fail(`${name} carries a marker Grillo does not write`);
    }
    if (comment.kind === 'plain') {
      return;
    }
    if (!sameLogin(comment.who, entry.author)) {
      fail(`${name}: who '${comment.who}' is not its author '${entry.author}'`);
    }
    momentOf(comment.when, `${name} when`);
    for (const code of comment.sources) {
      const source = sources.get(code) ?? fail(`${name} cites ${code}, which has no file in ${SOURCES_FOLDER}`);
      if (Date.parse(source.when) > Date.parse(comment.when)) {
        fail(`${name} was recorded before its source ${code} was written`);
      }
    }
    if (comment.kind === 'decision') {
      return;
    }

    const code = parseQuestionCode(comment.question);
    const question = code !== null && code.ticket === raw.number ? body.questions.find((line) => line.k === code.k) : undefined;
    if (question === undefined) {
      fail(`${name} answers ${comment.question}, which ticket #${raw.number} does not hold`);
    }
    if (question.text === null) {
      fail(`${name} answers ${comment.question}, a removed question`);
    }
    if (comment.kind === 'discussion') {
      if (!earlier.some((other) => other.kind === 'answer' && other.question === comment.question)) {
        fail(`${name}: a discussion of ${comment.question} with no answer before it`);
      }
      if (comment.session !== null) {
        const id = SESSION_FILE.exec(comment.session)?.[1] ?? '';
        const text = files[comment.session] ?? fail(`${name} names the session file ${comment.session}, which is missing`);
        if (!isSessionId(id)) {
          fail(`${name} names the session file ${comment.session}, which is not named <date>-<time>.md`);
        }
        parsing(() => parseSession(text, id, comment.session as string));
      }
      return;
    }
    if (comment.sources.length === 0) {
      fail(`${name}: an answer always rests on a source`);
    }
    if ((comment.via === 'github') !== (comment.from !== null)) {
      fail(`${name}: an answer via GitHub names the comment it came from in 'from:', and only such an answer does`);
    }
    if (comment.from !== null) {
      const origin = all.find((other) => other.id === comment.from);
      if (origin === undefined || origin.kind !== 'plain') {
        fail(`${name} comes from comment ${comment.from}, which is no plain comment on ticket #${raw.number}`);
      }
    }
  }

  // Settled lines, closed tickets and the structure.
  const byNumber = new Map(tickets.map((ticket) => [ticket.number, ticket]));
  const latestDecision = (ticket: CheckedTicket) => ticket.comments.filter((comment) => comment.kind === 'decision').at(-1);
  const settled = new Set<number>();
  for (const line of map.settled) {
    const ticket = byNumber.get(line.ticket) ?? fail(`the settled line #${line.ticket} names no ticket`);
    const decision = latestDecision(ticket);
    if (ticket.state !== 'closed' || decision === undefined || decision.kind !== 'decision') {
      fail(`the settled line #${line.ticket} names a ticket that is not closed with a decision`);
    }
    if (decision.gist !== line.gist) {
      fail(`the settled line #${line.ticket} reads '${line.gist}', not the gist of its latest decision '${decision.gist}'`);
    }
    if (settled.has(line.ticket)) {
      fail(`the settled list names #${line.ticket} twice`);
    }
    settled.add(line.ticket);
  }
  for (const ticket of tickets.filter((candidate) => candidate.state === 'closed')) {
    const decision = latestDecision(ticket);
    if (decision === undefined || decision.kind !== 'decision') {
      if (!map.outOfScope.some((line) => namesIssue(line, ticket.number))) {
        fail(`ticket #${ticket.number} is closed with no decision and no out-of-scope line naming #${ticket.number}`);
      }
      continue;
    }
    const merged = MERGE_GIST.exec(decision.gist);
    if (merged !== null) {
      if (Number(merged[1]) === ticket.number || !byNumber.has(Number(merged[1]))) {
        fail(`ticket #${ticket.number} is merged into #${merged[1]}, which is no other ticket`);
      }
      continue;
    }
    if (!settled.has(ticket.number)) {
      fail(`ticket #${ticket.number} is closed with a decision but has no line under Settled`);
    }
    const answered = new Set(ticket.comments.flatMap((comment) => (comment.kind === 'answer' ? [comment.question] : [])));
    for (const question of ticket.body.questions.filter((line) => line.text !== null)) {
      const code = `Q${ticket.number}.${question.k}`;
      if (!answered.has(code)) {
        fail(`ticket #${ticket.number} is closed with a decision while ${code} has no answer`);
      }
    }
  }

  // Every structure section has a settled decision, an open ticket or a fog line.
  for (const line of map.fog) {
    if (sectionNamed(line, sections) === null) {
      fail(`the fog line '${line}' does not start with a structure section's name and ': ' (${sections.join(', ')})`);
    }
  }
  for (const section of sections) {
    const feeds = (ticket: CheckedTicket): boolean => sectionNamed(ticket.body.whyItMatters, sections) === section;
    const decided = tickets.some((ticket) => feeds(ticket) && settled.has(ticket.number));
    const open = tickets.some((ticket) => feeds(ticket) && ticket.state === 'open');
    const fog = map.fog.some((line) => sectionNamed(line, sections) === section);
    if (!decided && !open && !fog) {
      fail(`the structure section '${section}' has no settled decision, no open ticket and no fog line`);
    }
  }

  return {
    map,
    tickets,
    sources: [...sources.values()].sort((a, b) => (sourceNumberOf(a.code) as number) - (sourceNumberOf(b.code) as number)),
    mapDone: map.fog.length === 0 && tickets.every((ticket) => ticket.state === 'closed'),
  };
}

/** Every file under a fixture folder, keyed by its path relative to the folder with `/` separators. */
export async function readFixtureFolder(folder: string): Promise<Record<string, string>> {
  const entries = await readdir(folder, { withFileTypes: true, recursive: true });
  const files: Record<string, string> = {};
  for (const entry of entries.filter((candidate) => candidate.isFile())) {
    const path = join(entry.parentPath, entry.name);
    files[relative(folder, path).split(sep).join('/')] = await readFile(path, 'utf8');
  }
  return files;
}
