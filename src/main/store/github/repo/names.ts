/**
 * Names that end up in a `gh api` path or a file path: each is checked before use, so a crafted value can
 * neither reach another API endpoint nor a file outside the project folder.
 */
import { StoreError } from '../../store';
import type { ProjectId, RepositoryRef } from '../../types';

/** GitHub logins: letters, digits and single hyphens, never at either end. */
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9]))*$/;
/** GitHub repository names: letters, digits, '.', '-' and '_'. */
const REPOSITORY_NAME = /^[A-Za-z0-9._-]+$/;
const SOURCE_CODE = /^S([1-9]\d*)$/;
const SESSION_ID = /^\d{4}-\d{2}-\d{2}-\d{6}$/;

export function isLogin(value: unknown): value is string {
  return typeof value === 'string' && LOGIN.test(value);
}

/** GitHub logins ignore case: `Ben-Example` and `ben-example` are one account. */
export function sameLogin(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

export function isRepositoryName(value: unknown): value is string {
  return typeof value === 'string' && REPOSITORY_NAME.test(value) && value !== '.' && value !== '..';
}

export function projectIdOf({ owner, name }: RepositoryRef): ProjectId {
  return `${owner}/${name}`;
}

/** `<owner>/<repo>` as a repository; anything else is refused as `invalid`. */
export function repositoryOf(project: unknown): RepositoryRef {
  const [owner, name, ...rest] = typeof project === 'string' ? project.split('/') : [];
  if (!isLogin(owner) || !isRepositoryName(name) || rest.length > 0) {
    throw new StoreError('invalid', `'${String(project)}' is not a project: expected <owner>/<repo>`);
  }
  return { owner, name };
}

export function sourceNumberOf(code: unknown): number | null {
  const match = typeof code === 'string' ? SOURCE_CODE.exec(code) : null;
  return match ? Number(match[1]) : null;
}

export function isSessionId(value: unknown): value is string {
  return typeof value === 'string' && SESSION_ID.test(value);
}

export function isVersionNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

/** `YYYY-MM-DD-HHMMSS` in UTC: a session's file name (docs/store-layout.md). */
export function sessionIdOf(date: Date): string {
  const iso = date.toISOString();
  return `${iso.slice(0, 10)}-${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}`;
}

/** The Grillo folder's files (docs/store-layout.md), relative to the repository root, with forward slashes. */
export const GRILLO_FILES = {
  members: '.grillo/members.json',
  structure: '.grillo/structure.json',
  sources: '.grillo/sources',
  sessions: '.grillo/sessions',
  prd: '.grillo/prd',
  source: (number: number) => `.grillo/sources/S${number}.md`,
  session: (id: string) => `.grillo/sessions/${id}.md`,
  version: (number: number) => `.grillo/prd/v${number}.md`,
  score: (number: number) => `.grillo/prd/v${number}.score.json`,
} as const;

/** The numbers taken by files named `<prefix><n><suffix>` in a folder listing, such as `S3.md`. */
export function numbersIn(names: string[], prefix: string, suffix: string): number[] {
  const pattern = new RegExp(`^${prefix}([1-9]\\d*)${suffix.replace(/\./g, '\\.')}$`);
  return names
    .map((name) => pattern.exec(name))
    .filter((match) => match !== null)
    .map((match) => Number(match[1]))
    .sort((a, b) => a - b);
}
