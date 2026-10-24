/**
 * The files of the Grillo folder (docs/store-layout.md, "The Grillo folder"): each record's text format, read
 * and written. A file that does not match its format is refused as a `backend` error naming the file, so a
 * hand-edited or damaged file reaches callers as the one error type they handle.
 */
import { StoreError } from '../../store';
import type { GrillingSession, PrdStructure, PrdVersion, Score, ScoreItem, Source, SourceKind } from '../../types';
import { isLogin } from './names';

/** One line of the members file; name and email come from GitHub. */
export interface MemberLine {
  login: string;
  role: string;
  domains: string[];
}

export const SOURCE_KINDS: readonly SourceKind[] = ['meeting', 'own-time-answer', 'pasted-text', 'document'];
export const APPENDIX_MARKER = '<!-- grillo:appendix -->';
const LIST_SEPARATOR = ', ';

class MalformedFile extends Error {}

function malformed(why: string): never {
  throw new MalformedFile(why);
}

/** Runs a parser; whatever it trips over becomes one `backend` refusal naming the file. */
function reading<T>(file: string, parse: () => T): T {
  try {
    return parse();
  } catch (error) {
    const why = error instanceof MalformedFile || error instanceof SyntaxError ? error.message : String(error);
    throw new StoreError('backend', `${file} is not in the format Grillo writes: ${why}`);
  }
}

const unixLines = (text: string): string => text.replace(/\r\n/g, '\n');

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown, field: string): string {
  return typeof value === 'string' ? value : malformed(`'${field}' must be text`);
}

function textList(value: unknown, field: string): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? [...value] : malformed(`'${field}' must be a list of text`);
}

function finiteNumber(value: unknown, field: string): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : malformed(`'${field}' must be a number`);
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

// Header lines: `<name>: <value>` in a fixed order, ended by the first empty line; the rest is the long text.

function headerValue(value: string): string {
  return value.replace(/\r\n|\r|\n/g, ' ');
}

function formatHeader(fields: [name: string, value: string][], body: string): string {
  const lines = fields.map(([name, value]) => (value === '' ? `${name}:` : `${name}: ${headerValue(value)}`));
  return `${lines.join('\n')}\n\n${body}`;
}

function parseHeader(content: string, names: readonly string[]): { values: Record<string, string>; body: string } {
  const lines = unixLines(content).split('\n');
  const end = lines.indexOf('');
  if (end < 0) {
    malformed('no empty line ends the header lines');
  }
  if (end !== names.length) {
    malformed(`expected the header lines ${names.join(', ')}`);
  }
  const values: Record<string, string> = {};
  names.forEach((name, index) => {
    const line = lines[index];
    const match = /^([a-z-]+):(?: (.*))?$/.exec(line);
    if (!match || match[1] !== name) {
      malformed(`header line ${index + 1} must be '${name}:'`);
    }
    values[name] = (match[2] ?? '').trim();
  });
  return { values, body: lines.slice(end + 1).join('\n') };
}

const splitList = (value: string): string[] => (value === '' ? [] : value.split(',').map((item) => item.trim()));

// members.json

export function formatMembers(lines: MemberLine[]): string {
  return json(lines.map(({ login, role, domains }) => ({ login, role, domains })));
}

export function parseMembers(content: string, file: string): MemberLine[] {
  return reading(file, () => {
    const parsed: unknown = JSON.parse(content);
    if (!Array.isArray(parsed)) {
      malformed('expected a list of members');
    }
    const lines = parsed.map((entry: unknown): MemberLine => {
      if (!isObject(entry)) {
        malformed('every member must be an object');
      }
      const login = text(entry.login, 'login');
      if (!isLogin(login)) {
        malformed(`'${login}' is not a GitHub login`);
      }
      return { login, role: text(entry.role, 'role'), domains: textList(entry.domains, 'domains') };
    });
    if (new Set(lines.map((line) => line.login.toLowerCase())).size !== lines.length) {
      malformed('a login appears twice');
    }
    return lines;
  });
}

// structure.json

export function formatStructure(structure: PrdStructure): string {
  return json({ sections: structure.sections.map(({ name, note }) => ({ name, note })) });
}

export function parseStructure(content: string, file: string): PrdStructure {
  return reading(file, () => {
    const parsed: unknown = JSON.parse(content);
    if (!isObject(parsed) || !Array.isArray(parsed.sections)) {
      malformed("expected an object with a 'sections' list");
    }
    return {
      sections: parsed.sections.map((section: unknown) => {
        if (!isObject(section)) {
          malformed('every section must be an object');
        }
        return { name: text(section.name, 'name'), note: text(section.note, 'note') };
      }),
    };
  });
}

// sources/S<n>.md

const SOURCE_HEADER = ['kind', 'who', 'when', 'where'] as const;

export function formatSource({ kind, who, when, where, text: body }: Source): string {
  return formatHeader([['kind', kind], ['who', who], ['when', when], ['where', where]], body);
}

export function parseSource(content: string, code: string, file: string): Source {
  return reading(file, () => {
    const { values, body } = parseHeader(content, SOURCE_HEADER);
    const kind = SOURCE_KINDS.find((candidate) => candidate === values.kind) ?? malformed(`'${values.kind}' is not a source kind`);
    return { code, kind, who: values.who, when: values.when, where: values.where, text: body };
  });
}

// sessions/<date>-<time>.md

const SESSION_HEADER = ['date', 'present', 'consent-by', 'consent-at'] as const;

export function formatSession({ date, present, consent, transcript }: GrillingSession): string {
  return formatHeader(
    [['date', date], ['present', present.join(LIST_SEPARATOR)], ['consent-by', consent?.by ?? ''], ['consent-at', consent?.at ?? '']],
    transcript,
  );
}

export function parseSession(content: string, id: string, file: string): GrillingSession {
  return reading(file, () => {
    const { values, body } = parseHeader(content, SESSION_HEADER);
    const by = values['consent-by'];
    const at = values['consent-at'];
    if ((by === '') !== (at === '')) {
      malformed("'consent-by' and 'consent-at' are set together or not at all");
    }
    return { id, date: values.date, present: splitList(values.present), consent: by === '' ? null : { by, at }, transcript: body };
  });
}

// prd/v<n>.md

const VERSION_HEADER = ['version', 'date'] as const;

export function formatPrdVersion({ number, date, body, appendix }: Pick<PrdVersion, 'number' | 'date' | 'body' | 'appendix'>): string {
  return formatHeader([['version', String(number)], ['date', date]], `${body}\n${APPENDIX_MARKER}\n${appendix}`);
}

/** True when the text holds a line that would be read as the start of the appendix. */
export function holdsAppendixMarker(text: string): boolean {
  return unixLines(text).split('\n').includes(APPENDIX_MARKER);
}

export function parsePrdVersion(content: string, file: string): PrdVersion {
  return reading(file, () => {
    const { values, body: text } = parseHeader(content, VERSION_HEADER);
    const number = /^[1-9]\d*$/.test(values.version) ? Number(values.version) : malformed("'version' must be a whole number");
    const lines = text.split('\n');
    const marker = lines.indexOf(APPENDIX_MARKER);
    const body = marker < 0 ? text : lines.slice(0, marker).join('\n');
    const appendix = marker < 0 ? '' : lines.slice(marker + 1).join('\n');
    return { number, date: values.date, body, appendix, score: null };
  });
}

// prd/v<n>.score.json

function scoreItems(value: unknown, field: string): ScoreItem[] {
  if (!Array.isArray(value)) {
    malformed(`'${field}' must be a list`);
  }
  return value.map((item: unknown) => {
    if (!isObject(item)) {
      malformed(`every entry of '${field}' must be an object`);
    }
    return { name: text(item.name, 'name'), mark: finiteNumber(item.mark, 'mark'), comment: text(item.comment, 'comment') };
  });
}

export function formatScore(score: Score): string {
  return json({ overall: score.overall, criteria: score.criteria, sections: score.sections });
}

export function parseScore(content: string, file: string): Score {
  return reading(file, () => {
    const parsed: unknown = JSON.parse(content);
    if (!isObject(parsed)) {
      malformed('expected a score object');
    }
    return {
      overall: finiteNumber(parsed.overall, 'overall'),
      criteria: scoreItems(parsed.criteria, 'criteria'),
      sections: scoreItems(parsed.sections, 'sections'),
    };
  });
}
