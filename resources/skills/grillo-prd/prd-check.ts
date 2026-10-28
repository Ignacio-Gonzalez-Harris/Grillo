import { parseQuestionCode, type AnswerComment, type DecisionComment } from '../../../src/main/store/github/issues/bodies';
import { sourceNumberOf } from '../../../src/main/store/github/repo/names';
import { APPENDIX_MARKER, holdsAppendixMarker, parsePrdVersion } from '../../../src/main/store/github/repo/records';
import { StoreError } from '../../../src/main/store/store';
import type { Source } from '../../../src/main/store/types';
import { type CheckedFixture, type CheckedTicket, checkProjectFixture, FixtureError } from '../fixture-check';

/**
 * Checks the PRD versions in a skill's fixture, `.grillo/prd/v<n>.md`, against `docs/store-layout.md` and the rules
 * `grillo-prd` writes by (its `references/prd-format.md`): numbered from v1 with no gap, every statement ending with
 * its codes or `[no source]`, every code naming a source and an answered question of a settled ticket as they stood
 * when the version was written, every written section resting on a decision, and an audit appendix that lists every
 * cited code word for word, and every `[no source]` statement, and nothing else. The project around the versions is
 * checked first with `checkProjectFixture`; every refusal is a `FixtureError`. Score files belong to the grader
 * (release 3) and are left alone.
 */

export interface Statement {
  text: string;
  /** The codes in the statement's tag, sources first; null for `[no source]`. */
  codes: string[] | null;
}

export interface WrittenSection {
  name: string;
  statements: Statement[];
}

export interface SourceEntry {
  code: string;
  kind: string;
  who: string;
  when: string;
  where: string;
  words: string;
}

export interface QuestionEntry {
  code: string;
  question: string;
  ticket: string;
  who: string;
  when: string;
  where: string;
  sources: string;
  words: string;
}

export interface UnsourcedEntry {
  section: string;
  text: string;
}

/** One PRD version as its file holds it, read without the project around it. */
export interface ReadPrdVersion {
  number: number;
  date: string;
  title: string;
  sections: WrittenSection[];
  sources: SourceEntry[];
  questions: QuestionEntry[];
  unsourced: UnsourcedEntry[];
}

export interface CheckedPrdFixture {
  project: CheckedFixture;
  /** Every version, v1 first. */
  versions: ReadPrdVersion[];
}

const PRD_FOLDER = '.grillo/prd/';
const VERSION_FILE = /^\.grillo\/prd\/v([1-9]\d*)\.md$/;
const SCORE_FILE = /^\.grillo\/prd\/v([1-9]\d*)\.score\.json$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const TITLE = /^# (\S.*)$/;
const SECTION = /^## (\S.*)$/;
const SUB_HEADING = /^### \S/;
/** A statement: one `- ` line ending with its tag, the last bracket pair on the line. */
const STATEMENT = /^- (\S.*?) \[([^\]]*)\]$/;
const NO_SOURCE = 'no source';
const SOURCE_CODE = 'S[1-9]\\d*';
const QUESTION_CODE = 'Q[1-9]\\d*\\.[1-9]\\d*';
/** Sources first, then questions, separated by a comma and one space. */
const CODE_TAG = new RegExp(`^(?:${SOURCE_CODE}, )*${QUESTION_CODE}(?:, ${QUESTION_CODE})*$`);
const APPENDIX_TITLE = '# Audit appendix';
const APPENDIX_PARTS = ['Sources', 'Questions', 'Unsourced'] as const;
const NONE = 'None.';
const SOURCE_FIELDS = ['Kind', 'Who', 'When', 'Where'] as const;
const QUESTION_FIELDS = ['Question', 'Ticket', 'Who', 'When', 'Where', 'Sources'] as const;
const UNSOURCED_LINE = /^- ([^:]+): (\S.*)$/;
const MERGE_GIST = /^Merged into #/;

function fail(why: string): never {
  throw new FixtureError(why);
}

const unixLines = (text: string): string => text.replace(/\r\n/g, '\n');
const isSourceCode = (code: string): boolean => sourceNumberOf(code) !== null;

function momentOf(value: string, what: string): string {
  if (!ISO_UTC.test(value) || Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) {
    fail(`${what} '${value}' is not a moment in ISO 8601 UTC (2026-10-24T09:15:00.000Z)`);
  }
  return value;
}

/** `S2` before `S10`, sources before questions, `Q2.3` before `Q10.1`. */
function codeOrder(code: string): number[] {
  const question = parseQuestionCode(code);
  return question === null ? [0, sourceNumberOf(code) as number, 0] : [1, question.ticket, question.k];
}

function compareCodes(a: string, b: string): number {
  const [x, y] = [codeOrder(a), codeOrder(b)];
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
}

// The body: a title, then `## ` sections holding `### ` sub-headings and statements.

function readStatement(line: string, file: string): Statement {
  const match = STATEMENT.exec(line) ?? fail(`${file}: '${line}' does not end with its codes or [${NO_SOURCE}]`);
  const [, text, tag] = match;
  if (tag === NO_SOURCE) {
    return { text, codes: null };
  }
  if (!CODE_TAG.test(tag)) {
    fail(`${file}: the codes [${tag}] are not S<n> and then Q<issue>.<k> codes separated by ', ', with at least one question`);
  }
  const codes = tag.split(', ');
  if (new Set(codes).size !== codes.length) {
    fail(`${file}: the codes [${tag}] name a code twice`);
  }
  return { text, codes };
}

function readBody(body: string, file: string): { title: string; sections: WrittenSection[] } {
  const lines = body.split('\n').filter((line) => line.trim() !== '');
  const title = TITLE.exec(lines[0] ?? '')?.[1] ?? fail(`${file}: the body does not start with a '# ' title`);
  const sections: WrittenSection[] = [];
  for (const line of lines.slice(1)) {
    const heading = SECTION.exec(line);
    if (heading !== null) {
      if (sections.some((section) => section.name === heading[1])) {
        fail(`${file}: the section '${heading[1]}' is written twice`);
      }
      sections.push({ name: heading[1], statements: [] });
      continue;
    }
    const section = sections.at(-1) ?? fail(`${file}: '${line}' stands outside every section`);
    if (!SUB_HEADING.test(line)) {
      section.statements.push(readStatement(line, file));
    }
  }
  for (const section of sections) {
    if (section.statements.length === 0) {
      fail(`${file}: the section '${section.name}' holds no statement`);
    }
  }
  return { title, sections };
}

// The appendix: `# Audit appendix`, then `## Sources`, `## Questions` and `## Unsourced`.

/** The lines of each `## ` part, empty lines kept; refuses parts missing, extra or out of order. */
function appendixParts(appendix: string, file: string): Record<(typeof APPENDIX_PARTS)[number], string[]> {
  const lines = appendix.split('\n');
  const start = lines.findIndex((line) => line.trim() !== '');
  if (lines[start] !== APPENDIX_TITLE) {
    fail(`${file}: the appendix does not start with '${APPENDIX_TITLE}'`);
  }
  const headings = lines.flatMap((line, index) => (SECTION.test(line) ? [index] : []));
  const names = headings.map((index) => (SECTION.exec(lines[index]) as RegExpExecArray)[1]);
  if (names.join('|') !== APPENDIX_PARTS.join('|') || lines.slice(start + 1, headings[0]).some((line) => line.trim() !== '')) {
    fail(`${file}: the appendix holds the parts [${names.join(', ')}], not exactly ${APPENDIX_PARTS.join(', ')} in that order`);
  }
  const parts = {} as Record<(typeof APPENDIX_PARTS)[number], string[]>;
  APPENDIX_PARTS.forEach((name, index) => {
    parts[name] = lines.slice(headings[index] + 1, headings[index + 1]);
  });
  return parts;
}

const trimEmpty = (lines: string[]): string[] => {
  const first = lines.findIndex((line) => line.trim() !== '');
  if (first === -1) {
    return [];
  }
  const last = lines.length - 1 - [...lines].reverse().findIndex((line) => line.trim() !== '');
  return lines.slice(first, last + 1);
};

/** A part holding only `None.` is empty; otherwise its `### <code>` entries, in code order, each code once. */
function entriesOf(lines: string[], part: string, file: string, isCode: (code: string) => boolean): { code: string; lines: string[] }[] {
  const content = trimEmpty(lines);
  if (content.length === 1 && content[0] === NONE) {
    return [];
  }
  const entries: { code: string; lines: string[] }[] = [];
  for (const line of content) {
    const heading = /^### (.*)$/.exec(line);
    if (heading !== null) {
      if (!isCode(heading[1])) {
        fail(`${file}: '${line}' under ${part} names no ${part === 'Sources' ? 'source' : 'question'} code`);
      }
      entries.push({ code: heading[1], lines: [] });
      continue;
    }
    (entries.at(-1) ?? fail(`${file}: '${line}' under ${part} stands before any '### ' entry; an empty part reads '${NONE}'`)).lines.push(line);
  }
  if (entries.length === 0) {
    fail(`${file}: the part ${part} is empty; an empty part reads '${NONE}'`);
  }
  entries.forEach((entry, index) => {
    if (index > 0 && compareCodes(entries[index - 1].code, entry.code) >= 0) {
      fail(`${file}: under ${part}, ${entry.code} comes after ${entries[index - 1].code}: entries are in code order, each once`);
    }
  });
  return entries;
}

/** An entry: its `- <Field>: <value>` lines in order, one empty line, then the exact words as `> ` quote lines. */
function entryFields<F extends string>(entry: { code: string; lines: string[] }, fields: readonly F[], file: string): Record<F, string> & { words: string } {
  const lines = trimEmpty(entry.lines);
  const values = {} as Record<F, string>;
  fields.forEach((field, index) => {
    const match = new RegExp(`^- ${field}:(?: (.*))?$`).exec(lines[index] ?? '');
    if (match === null) {
      fail(`${file}: entry ${entry.code}, line ${index + 1} must be '- ${field}: ...'`);
    }
    values[field] = (match[1] ?? '').trim();
  });
  const quote = lines.slice(fields.length + 1);
  if (lines[fields.length] !== '' || quote.length === 0 || quote.some((line) => line !== '>' && !line.startsWith('> '))) {
    fail(`${file}: entry ${entry.code} must end with an empty line and its exact words as '> ' quote lines`);
  }
  return { ...values, words: quote.map((line) => line.slice(2)).join('\n') };
}

/** Reads one version file; refuses anything not in the shape `grillo-prd` writes. */
export function readPrdVersion(content: string, file: string): ReadPrdVersion {
  const text = unixLines(content);
  let version;
  try {
    version = parsePrdVersion(text, file);
  } catch (error) {
    if (error instanceof StoreError) {
      fail(error.message);
    }
    throw error;
  }
  if (!holdsAppendixMarker(text)) {
    fail(`${file}: no line reads '${APPENDIX_MARKER}', so the version has no audit appendix`);
  }
  if (holdsAppendixMarker(version.appendix)) {
    fail(`${file}: the line '${APPENDIX_MARKER}' appears twice`);
  }
  momentOf(version.date, `${file} date`);
  const { title, sections } = readBody(version.body, file);
  const parts = appendixParts(version.appendix, file);
  const sources = entriesOf(parts.Sources, 'Sources', file, isSourceCode).map((entry) => {
    const fields = entryFields(entry, SOURCE_FIELDS, file);
    return { code: entry.code, kind: fields.Kind, who: fields.Who, when: fields.When, where: fields.Where, words: fields.words };
  });
  const questions = entriesOf(parts.Questions, 'Questions', file, (code) => parseQuestionCode(code) !== null).map((entry) => {
    const fields = entryFields(entry, QUESTION_FIELDS, file);
    return {
      code: entry.code,
      question: fields.Question,
      ticket: fields.Ticket,
      who: fields.Who,
      when: fields.When,
      where: fields.Where,
      sources: fields.Sources,
      words: fields.words,
    };
  });
  const unsourcedLines = trimEmpty(parts.Unsourced);
  const unsourced =
    unsourcedLines.length === 1 && unsourcedLines[0] === NONE
      ? []
      : unsourcedLines.map((line) => {
          const match = UNSOURCED_LINE.exec(line) ?? fail(`${file}: '${line}' under Unsourced is not '- <section>: <statement>'; an empty part reads '${NONE}'`);
          return { section: match[1], text: match[2] };
        });
  return { number: version.number, date: version.date, title, sections, sources, questions, unsourced };
}

// The versions against the project they were written from.

const atOrBefore = (moment: string, date: string): boolean => Date.parse(moment) <= Date.parse(date);

function answersBefore(ticket: CheckedTicket, code: string, date: string): AnswerComment[] {
  return ticket.comments.filter((comment): comment is AnswerComment => comment.kind === 'answer' && comment.question === code && atOrBefore(comment.when, date));
}

function settledBefore(ticket: CheckedTicket, date: string): boolean {
  return ticket.comments.some((comment): comment is DecisionComment => comment.kind === 'decision' && !MERGE_GIST.test(comment.gist) && atOrBefore(comment.when, date));
}

const quoted = (text: string): string => unixLines(text).trim();

function checkVersion(version: ReadPrdVersion, project: CheckedFixture, file: string): void {
  const tickets = new Map(project.tickets.map((ticket) => [ticket.number, ticket]));
  const sources = new Map<string, Source>(project.sources.map((source) => [source.code, source]));

  /** The answers a cited question rests on: a live question of a ticket settled when the version was written. */
  function answersFor(code: string): { ticket: CheckedTicket; question: string; answers: AnswerComment[] } {
    const parsed = parseQuestionCode(code) as { ticket: number; k: number };
    const ticket = tickets.get(parsed.ticket) ?? fail(`${file} cites ${code}, but #${parsed.ticket} is no ticket`);
    const question = ticket.body.questions.find((line) => line.k === parsed.k)?.text ?? fail(`${file} cites ${code}, which ticket #${ticket.number} does not hold or removed`);
    if (!settledBefore(ticket, version.date)) {
      fail(`${file} cites ${code}, but ticket #${ticket.number} had no decision when the version was written`);
    }
    const answers = answersBefore(ticket, code, version.date);
    if (answers.length === 0) {
      fail(`${file} cites ${code}, which had no answer when the version was written`);
    }
    return { ticket, question, answers };
  }

  const cited = new Set<string>();
  for (const section of version.sections) {
    let restsOnDecision = false;
    for (const statement of section.statements.filter((candidate) => candidate.codes !== null)) {
      const codes = statement.codes as string[];
      const tagSources = codes.filter(isSourceCode);
      const questions = codes.filter((code) => !isSourceCode(code)).map((code) => ({ code, ...answersFor(code) }));
      for (const code of tagSources) {
        const source = sources.get(code) ?? fail(`${file} cites ${code}, which has no source file`);
        if (!atOrBefore(source.when, version.date)) {
          fail(`${file} cites ${code}, which was written after the version`);
        }
        if (!questions.some(({ answers }) => answers.some((answer) => answer.sources.includes(code)))) {
          fail(`${file}: '${statement.text}' cites ${code}, which no answer to its questions rests on`);
        }
      }
      for (const { code, answers } of questions) {
        if (!answers.some((answer) => answer.sources.some((source) => tagSources.includes(source)))) {
          fail(`${file}: '${statement.text}' cites ${code} without the source its answer rests on`);
        }
      }
      restsOnDecision ||= questions.some(({ ticket }) => ticket.body.whyItMatters.startsWith(`${section.name}: `));
      codes.forEach((code) => cited.add(code));
    }
    if (!restsOnDecision) {
      fail(`${file}: the section '${section.name}' is written, but none of its statements cites a decided question of a ticket feeding '${section.name}'`);
    }
  }

  // The appendix lists every cited code, word for word, and nothing else.
  const listed = [...version.sources.map((entry) => entry.code), ...version.questions.map((entry) => entry.code)];
  const missing = [...cited].filter((code) => !listed.includes(code)).sort(compareCodes);
  const extra = listed.filter((code) => !cited.has(code));
  if (missing.length > 0 || extra.length > 0) {
    fail(`${file}: the appendix misses [${missing.join(', ')}] and lists uncited [${extra.join(', ')}]`);
  }
  for (const entry of version.sources) {
    const source = sources.get(entry.code) as Source;
    const expected = { kind: source.kind, who: source.who, when: source.when, where: source.where, words: quoted(source.text) };
    const actual = { kind: entry.kind, who: entry.who, when: entry.when, where: entry.where, words: quoted(entry.words) };
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      fail(`${file}: the appendix entry ${entry.code} is not the source file's who, when, where and exact words`);
    }
  }
  for (const entry of version.questions) {
    const { ticket, question, answers } = answersFor(entry.code);
    const ticketLine = `#${ticket.number} ${ticket.title}`;
    const matches = answers.some(
      (answer) =>
        entry.who === answer.who &&
        entry.when === answer.when &&
        entry.where === `comment ${answer.id} on ticket #${ticket.number}` &&
        entry.sources === answer.sources.join(', ') &&
        quoted(entry.words) === quoted(answer.text),
    );
    if (entry.question !== question || entry.ticket !== ticketLine || !matches) {
      fail(`${file}: the appendix entry ${entry.code} is not its question, its ticket and one of its answers word for word`);
    }
  }

  const unsourced = version.sections.flatMap((section) => section.statements.filter((statement) => statement.codes === null).map((statement) => ({ section: section.name, text: statement.text })));
  if (JSON.stringify(version.unsourced) !== JSON.stringify(unsourced)) {
    fail(`${file}: the Unsourced part does not list every [${NO_SOURCE}] statement, in order, as '- <section>: <statement>'`);
  }
}

/** Checks a fixture's project and every PRD version in it; refuses anything that breaks the rules with `FixtureError` only. */
export function checkPrdFixture(input: Record<string, string>): CheckedPrdFixture {
  const project = checkProjectFixture(input);
  const files = Object.fromEntries(Object.entries(input).map(([path, text]) => [path, unixLines(text)]));
  const versionFiles = new Map<number, string>();
  for (const path of Object.keys(files).filter((name) => name.startsWith(PRD_FOLDER) && !SCORE_FILE.test(name))) {
    const number = VERSION_FILE.exec(path)?.[1] ?? fail(`${path} is neither v<n>.md nor v<n>.score.json`);
    versionFiles.set(Number(number), path);
  }

  const versions = [...versionFiles.keys()]
    .sort((a, b) => a - b)
    .map((number, index) => {
      const file = versionFiles.get(number) as string;
      if (number !== index + 1) {
        fail(`PRD version v${index + 1} is missing: version numbers run from v1 with no gap`);
      }
      const version = readPrdVersion(files[file], file);
      if (version.number !== number) {
        fail(`${file} says 'version: ${version.number}'`);
      }
      return version;
    });
  versions.forEach((version, index) => {
    if (index > 0 && Date.parse(version.date) <= Date.parse(versions[index - 1].date)) {
      fail(`v${version.number} is dated ${version.date}, not after v${index}: a new version is always the latest`);
    }
    checkVersion(version, project, versionFiles.get(version.number) as string);
  });
  return { project, versions };
}
