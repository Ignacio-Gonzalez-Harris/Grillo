/**
 * Every `gh` call the issues backend makes, each turning GitHub's answer into a typed value. Request bodies go
 * to `gh api --input -` as JSON on standard input, so no text a member types is ever read as a command flag.
 * A refusal GitHub gives (not found, gone, forbidden, invalid) becomes a `StoreError` of the matching kind;
 * every other failure, an answer of the wrong shape included, stays the `GhError` (a `backend` refusal) the gh
 * runner throws.
 */
import { GhError, type Gh } from '../../gh';
import { StoreError } from '../../store';
import type { Login, RepositoryRef } from '../../types';
import { isLogin, projectIdOf, sameLogin } from '../repo/names';
import { parseMembers, type MemberLine } from '../repo/records';
import type { RawComment } from './bodies';

/** One issue as the backend needs it. */
export interface IssueData {
  /** GitHub's global id: the sub-issue and dependency calls take it, never the number. */
  id: number;
  number: number;
  title: string;
  body: string;
  state: 'open' | 'closed';
  labels: string[];
  assignees: Login[];
  /** How many comments the issue has: none means no comment call is needed. */
  comments: number;
  pullRequest: boolean;
}

/** An `assigned` or `unassigned` event of an issue's timeline, oldest first. */
export interface AssignmentEvent {
  event: 'assigned' | 'unassigned';
  assignee: Login;
}

export interface IssueChange {
  title?: string;
  body?: string;
  labels?: string[];
  assignees?: Login[];
  state?: 'open' | 'closed';
  state_reason?: 'completed' | 'duplicate' | 'reopened';
  /** The global id of the issue a duplicate points at; GitHub reads it only with `state_reason: duplicate`. */
  duplicate_issue_id?: number;
}

export type IssueState = 'open' | 'closed' | 'all';

/** GitHub's largest page; a list of fewer items is the last page. */
const PAGE_SIZE = 100;
const MEMBERS_FILE = '.grillo/members.json';
/** GitHub's name for an account that no longer exists. */
const GHOST = 'ghost';
const HTTP_STATUS = /\(HTTP (\d{3})\)/;
const NOT_FOUND = 404;
const GONE = 410;
const FORBIDDEN = 403;
const UNPROCESSABLE = 422;

function statusOf(error: GhError): number | null {
  const match = HTTP_STATUS.exec(error.stderr);
  return match ? Number(match[1]) : null;
}

/** Turns the refusals GitHub gives into store refusals with a message the member can act on. */
async function refusing<T>(call: Promise<T>, missing: string): Promise<T> {
  try {
    return await call;
  } catch (error) {
    if (!(error instanceof GhError) || error.reason !== 'api-error') {
      throw error;
    }
    const status = statusOf(error);
    if (status === NOT_FOUND || status === GONE) {
      throw new StoreError('not-found', missing);
    }
    if (status === FORBIDDEN) {
      throw new StoreError('forbidden', `GitHub refused: ${error.stderr.trim()}`);
    }
    if (status === UNPROCESSABLE) {
      throw new StoreError('invalid', `GitHub refused: ${error.stderr.trim()}`);
    }
    throw error;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function object(value: unknown, what: string): Record<string, unknown> {
  if (!isObject(value)) {
    throw new Error(`expected ${what} as an object`);
  }
  return value;
}

function list(value: unknown, what: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`expected a list of ${what}`);
  }
  return value;
}

function positiveInteger(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`expected ${what} as a positive whole number`);
  }
  return value;
}

function login(value: unknown, what: string): Login {
  if (!isLogin(value)) {
    throw new Error(`expected ${what} to be a GitHub login`);
  }
  return value;
}

function text(value: unknown, what: string): string {
  if (typeof value !== 'string') {
    throw new Error(`expected ${what} as text`);
  }
  return value;
}

/** A label is an object with a name; GitHub also accepts plain names, so both are read. */
function labelName(value: unknown): string {
  return typeof value === 'string' ? value : text(object(value, 'a label').name, 'a label name');
}

function unique(logins: Login[]): Login[] {
  return logins.filter((entry, index) => logins.findIndex((other) => sameLogin(other, entry)) === index);
}

export function parseIssue(value: unknown): IssueData {
  const issue = object(value, 'an issue');
  const state = issue.state;
  if (state !== 'open' && state !== 'closed') {
    throw new Error("expected the issue state 'open' or 'closed'");
  }
  // A missing count must not read as none: the ticket's answers would go unseen.
  const comments = issue.comments;
  if (typeof comments !== 'number' || !Number.isSafeInteger(comments) || comments < 0) {
    throw new Error('expected the comment count as a whole number');
  }
  return {
    id: positiveInteger(issue.id, 'the issue id'),
    number: positiveInteger(issue.number, 'the issue number'),
    title: text(issue.title, 'the issue title'),
    body: issue.body === null || issue.body === undefined ? '' : text(issue.body, 'the issue body'),
    state,
    labels: [...new Set(list(issue.labels, 'labels').map(labelName))],
    assignees: unique(list(issue.assignees, 'assignees').map((entry) => login(object(entry, 'an assignee').login, 'an assignee'))),
    comments,
    pullRequest: issue.pull_request !== undefined && issue.pull_request !== null,
  };
}

const parseIssues = (value: unknown): IssueData[] => list(value, 'issues').map(parseIssue);

export function parseRawComment(value: unknown): RawComment {
  const comment = object(value, 'a comment');
  const user = comment.user === null || comment.user === undefined ? null : object(comment.user, 'the comment author');
  return {
    id: String(positiveInteger(comment.id, 'the comment id')),
    body: comment.body === null || comment.body === undefined ? '' : text(comment.body, 'the comment body'),
    author: user === null ? GHOST : login(user.login, 'the comment author'),
    createdAt: text(comment.created_at, 'the comment date'),
  };
}

const parseComments = (value: unknown): RawComment[] => list(value, 'comments').map(parseRawComment);

/** A comment of the repository-wide listing, with the number of the issue it is on. */
export interface RepositoryComment extends RawComment {
  issue: number;
}

const ISSUE_URL_NUMBER = /\/issues\/([1-9]\d*)$/;

function parseRepositoryComments(value: unknown): RepositoryComment[] {
  return list(value, 'comments').map((entry) => {
    const issueUrl = object(entry, 'a comment').issue_url;
    const number = typeof issueUrl === 'string' ? ISSUE_URL_NUMBER.exec(issueUrl)?.[1] : undefined;
    if (number === undefined) {
      throw new Error('expected every comment to name its issue');
    }
    return { ...parseRawComment(entry), issue: Number(number) };
  });
}

function parseAssignmentEvents(value: unknown): AssignmentEvent[] {
  return list(value, 'timeline events').flatMap((entry): AssignmentEvent[] => {
    const event = object(entry, 'a timeline event').event;
    if (event !== 'assigned' && event !== 'unassigned') {
      return [];
    }
    return [{ event, assignee: login(object(object(entry, 'a timeline event').assignee, 'the assignee').login, 'the assignee') }];
  });
}

function parseIssueRefs(value: unknown): { id: number; number: number }[] {
  return list(value, 'issues').map((entry) => {
    const issue = object(entry, 'an issue');
    return { id: positiveInteger(issue.id, 'the issue id'), number: positiveInteger(issue.number, 'the issue number') };
  });
}

function parseLogin(value: unknown): Login {
  return login(object(value, 'a user').login, 'the user');
}

function parseFileContent(value: unknown): string {
  const file = object(value, 'a file');
  if (file.encoding !== 'base64') {
    throw new Error('expected the file content in base64');
  }
  return Buffer.from(text(file.content, 'the file content'), 'base64').toString('utf8');
}

const repoPath = (ref: RepositoryRef): string => `repos/${ref.owner}/${ref.name}`;
const json = (value: unknown): { input: string } => ({ input: JSON.stringify(value) });

export type IssuesApi = ReturnType<typeof createIssuesApi>;

export function createIssuesApi(gh: Gh) {
  /** Every page of a list, `PAGE_SIZE` items at a time. */
  async function paged<T>(path: string, parse: (value: unknown) => T[]): Promise<T[]> {
    const items: T[] = [];
    for (let page = 1; ; page++) {
      const separator = path.includes('?') ? '&' : '?';
      const batch = await gh.json(['api', `${path}${separator}per_page=${PAGE_SIZE}&page=${page}`], (value) => {
        const items = list(value, 'items');
        return { items: parse(items), size: items.length };
      });
      items.push(...batch.items);
      if (batch.size < PAGE_SIZE) {
        return items;
      }
    }
  }

  const issuePath = (ref: RepositoryRef, number: number): string => `${repoPath(ref)}/issues/${number}`;
  const noIssue = (ref: RepositoryRef, number: number): string => `No issue ${number} in ${projectIdOf(ref)}`;

  const write = (method: 'POST' | 'PATCH' | 'DELETE', path: string, body: unknown, missing: string) =>
    refusing(gh.text(['api', '--method', method, path, '--input', '-'], json(body)), missing);

  const writeIssue = (method: 'POST' | 'PATCH' | 'DELETE', path: string, body: unknown, missing: string) =>
    refusing(gh.json(['api', '--method', method, path, '--input', '-'], parseIssue, json(body)), missing);

  return {
    /** The signed-in member's login. */
    viewer(): Promise<Login> {
      return gh.json(['api', 'user'], parseLogin);
    },

    /** The members file on the default branch, read straight from GitHub. */
    async memberLines(ref: RepositoryRef): Promise<MemberLine[]> {
      const content = await refusing(
        gh.json(['api', `${repoPath(ref)}/contents/${MEMBERS_FILE}`], parseFileContent),
        `${projectIdOf(ref)} holds no Grillo project`,
      );
      return parseMembers(content, MEMBERS_FILE);
    },

    /** True when GitHub would assign the login: it has access to the repository (204), false when not (404). */
    async canBeAssigned(ref: RepositoryRef, assignee: Login): Promise<boolean> {
      try {
        await refusing(gh.text(['api', `${repoPath(ref)}/assignees/${assignee}`]), `${assignee} cannot be assigned`);
        return true;
      } catch (error) {
        if (error instanceof StoreError && error.kind === 'not-found') {
          return false;
        }
        throw error;
      }
    },

    /** The issue, or null when there is no such issue (or it was deleted). */
    async issue(ref: RepositoryRef, number: number): Promise<IssueData | null> {
      try {
        return await refusing(gh.json(['api', issuePath(ref, number)], parseIssue), noIssue(ref, number));
      } catch (error) {
        if (error instanceof StoreError && error.kind === 'not-found') {
          return null;
        }
        throw error;
      }
    },

    /** Every issue carrying the label, pull requests included (GitHub lists them as issues). */
    listIssues(ref: RepositoryRef, state: IssueState, label: string): Promise<IssueData[]> {
      return paged(`${repoPath(ref)}/issues?state=${state}&labels=${encodeURIComponent(label)}`, parseIssues);
    },

    createIssue(ref: RepositoryRef, issue: { title: string; body: string; labels: string[] }): Promise<IssueData> {
      return writeIssue('POST', `${repoPath(ref)}/issues`, issue, `No repository ${projectIdOf(ref)}`);
    },

    editIssue(ref: RepositoryRef, number: number, change: IssueChange): Promise<IssueData> {
      return writeIssue('PATCH', issuePath(ref, number), change, noIssue(ref, number));
    },

    addAssignee(ref: RepositoryRef, number: number, assignee: Login): Promise<IssueData> {
      return writeIssue('POST', `${issuePath(ref, number)}/assignees`, { assignees: [assignee] }, noIssue(ref, number));
    },

    removeAssignee(ref: RepositoryRef, number: number, assignee: Login): Promise<IssueData> {
      return writeIssue('DELETE', `${issuePath(ref, number)}/assignees`, { assignees: [assignee] }, noIssue(ref, number));
    },

    /** The issue's assignment events, oldest first, as its timeline lists them. */
    assignmentEvents(ref: RepositoryRef, number: number): Promise<AssignmentEvent[]> {
      return refusing(paged(`${issuePath(ref, number)}/timeline`, parseAssignmentEvents), noIssue(ref, number));
    },

    comments(ref: RepositoryRef, number: number): Promise<RawComment[]> {
      return refusing(paged(`${issuePath(ref, number)}/comments`, parseComments), noIssue(ref, number));
    },

    /** Every comment on every issue of the repository, oldest first: one listing instead of one per issue. */
    repositoryComments(ref: RepositoryRef): Promise<RepositoryComment[]> {
      return refusing(paged(`${repoPath(ref)}/issues/comments`, parseRepositoryComments), `No repository ${projectIdOf(ref)}`);
    },

    createComment(ref: RepositoryRef, number: number, body: string): Promise<RawComment> {
      const path = `${issuePath(ref, number)}/comments`;
      return refusing(gh.json(['api', '--method', 'POST', path, '--input', '-'], parseRawComment, json({ body })), noIssue(ref, number));
    },

    editComment(ref: RepositoryRef, id: string, body: string): Promise<RawComment> {
      const path = `${repoPath(ref)}/issues/comments/${id}`;
      return refusing(gh.json(['api', '--method', 'PATCH', path, '--input', '-'], parseRawComment, json({ body })), `No comment ${id}`);
    },

    async deleteComment(ref: RepositoryRef, id: string): Promise<void> {
      await refusing(gh.text(['api', '--method', 'DELETE', `${repoPath(ref)}/issues/comments/${id}`]), `No comment ${id}`);
    },

    /** Makes the issue with global id `child` a native sub-issue of `parent`. */
    async addSubIssue(ref: RepositoryRef, parent: number, child: number): Promise<void> {
      await write('POST', `${issuePath(ref, parent)}/sub_issues`, { sub_issue_id: child }, noIssue(ref, parent));
    },

    /** GitHub's native "blocked by" relation of the issue. */
    blockers(ref: RepositoryRef, number: number): Promise<{ id: number; number: number }[]> {
      return refusing(paged(`${issuePath(ref, number)}/dependencies/blocked_by`, parseIssueRefs), noIssue(ref, number));
    },

    async addBlocker(ref: RepositoryRef, number: number, blockerId: number): Promise<void> {
      await write('POST', `${issuePath(ref, number)}/dependencies/blocked_by`, { issue_id: blockerId }, noIssue(ref, number));
    },

    async removeBlocker(ref: RepositoryRef, number: number, blockerId: number): Promise<void> {
      await refusing(gh.text(['api', '--method', 'DELETE', `${issuePath(ref, number)}/dependencies/blocked_by/${blockerId}`]), noIssue(ref, number));
    },
  };
}
