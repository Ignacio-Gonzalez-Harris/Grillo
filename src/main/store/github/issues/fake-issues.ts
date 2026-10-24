/**
 * A made-up GitHub for the issues backend's tests: answers the `gh api` calls it makes (the repository, the
 * members file, issues, labels, assignees, the timeline, comments, sub-issues and blocked-by dependencies),
 * modelling what GitHub does that the backend relies on: an assignee who is no collaborator is silently
 * dropped, every assignment lands in the timeline, a deleted issue answers 410. A command it does not know
 * fails the test, so no test can reach the real `gh` or the network.
 */
import { createGh, type Gh, type ProcessRunner, type RunResult } from '../../gh';

export interface FakeIssue {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: 'open' | 'closed';
  stateReason: string | null;
  duplicateIssueId: number | null;
  labels: string[];
  assignees: string[];
  pullRequest: boolean;
  deleted: boolean;
  /** Global ids of the native sub-issues. */
  subIssues: number[];
  /** Global ids of the issues blocking this one (GitHub's native relation). */
  blockedBy: number[];
  events: { event: 'assigned' | 'unassigned'; assignee: string }[];
}

export interface FakeComment {
  id: number;
  issue: number;
  body: string;
  author: string | null;
  createdAt: string;
}

export interface FakeIssuesRepository {
  archived: boolean;
  /** Only collaborators can be assigned. */
  collaborators: Set<string>;
  files: Map<string, string>;
  issues: Map<number, FakeIssue>;
  comments: FakeComment[];
}

const ok = (stdout = ''): RunResult => ({ exitCode: 0, stdout, stderr: '' });
const failed = (stderr: string): RunResult => ({ exitCode: 1, stdout: '', stderr });
const notFound = (): RunResult => failed('gh: Not Found (HTTP 404)');
const gone = (): RunResult => failed('gh: This issue was deleted (HTTP 410)');
const json = (value: unknown): RunResult => ok(`${JSON.stringify(value)}\n`);
const ISSUE_ID_OFFSET = 9000;
const COMMENT_ID_START = 2412345600;
const START = Date.parse('2026-10-24T09:15:00.000Z');

const sameLogin = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

export function createFakeIssues(me = 'ada-example') {
  const repositories = new Map<string, FakeIssuesRepository>();
  const calls: string[] = [];
  /** Runs once, just before the next call whose `<METHOD> <path>` starts with the key. */
  const hooks = new Map<string, () => void>();
  /** Answers the next call whose `<METHOD> <path>` starts with the key with this result instead. */
  const answers = new Map<string, RunResult>();
  let nextCommentId = COMMENT_ID_START;
  let clock = START;
  const moment = (): string => new Date((clock += 1000)).toISOString();

  function addRepository(id: string, members: { login: string; role?: string; domains?: string[] }[] = [{ login: me, domains: [] }]): FakeIssuesRepository {
    const lines = members.map(({ login, role = '', domains = [] }) => ({ login, role, domains }));
    const repository: FakeIssuesRepository = {
      archived: false,
      collaborators: new Set(members.map((member) => member.login.toLowerCase())),
      files: new Map([['.grillo/members.json', JSON.stringify(lines)]]),
      issues: new Map(),
      comments: [],
    };
    repositories.set(id, repository);
    return repository;
  }

  function addIssue(id: string, issue: Partial<FakeIssue> & { title: string }): FakeIssue {
    const repository = repositories.get(id)!;
    const number = repository.issues.size + 1;
    const created: FakeIssue = {
      id: ISSUE_ID_OFFSET + number,
      number,
      body: null,
      state: 'open',
      stateReason: null,
      duplicateIssueId: null,
      labels: [],
      assignees: [],
      pullRequest: false,
      deleted: false,
      subIssues: [],
      blockedBy: [],
      events: [],
      ...issue,
    };
    repository.issues.set(number, created);
    return created;
  }

  /** A member writing a comment in GitHub's own web or phone app. */
  function addComment(id: string, issue: number, author: string | null, body: string): FakeComment {
    const comment: FakeComment = { id: nextCommentId++, issue, body, author, createdAt: moment() };
    repositories.get(id)!.comments.push(comment);
    return comment;
  }

  /** Someone else assigning a login on GitHub, as another laptop would. */
  function assignFromElsewhere(id: string, number: number, login: string): void {
    const issue = repositories.get(id)!.issues.get(number)!;
    issue.assignees.push(login);
    issue.events.push({ event: 'assigned', assignee: login });
  }

  function issueJson(repository: FakeIssuesRepository, issue: FakeIssue) {
    return {
      id: issue.id,
      number: issue.number,
      title: issue.title,
      body: issue.body,
      state: issue.state,
      state_reason: issue.stateReason,
      labels: issue.labels.map((name) => ({ name })),
      assignees: issue.assignees.map((login) => ({ login })),
      comments: repository.comments.filter((comment) => comment.issue === issue.number).length,
      ...(issue.pullRequest ? { pull_request: { url: 'https://example.invalid/pull' } } : {}),
    };
  }

  const commentJson = (comment: FakeComment) => ({
    id: comment.id,
    body: comment.body,
    user: comment.author === null ? null : { login: comment.author },
    created_at: comment.createdAt,
  });

  function page<T>(items: T[], query: URLSearchParams): T[] {
    const size = Number(query.get('per_page') ?? 30);
    const at = Number(query.get('page') ?? 1);
    return items.slice((at - 1) * size, at * size);
  }

  function setAssignees(issue: FakeIssue, repository: FakeIssuesRepository, wanted: string[]): void {
    const kept = wanted.filter((login) => repository.collaborators.has(login.toLowerCase()));
    for (const login of issue.assignees.filter((current) => !kept.some((entry) => sameLogin(entry, current)))) {
      issue.events.push({ event: 'unassigned', assignee: login });
    }
    for (const login of kept.filter((entry) => !issue.assignees.some((current) => sameLogin(entry, current)))) {
      issue.events.push({ event: 'assigned', assignee: login });
    }
    issue.assignees = kept;
  }

  function issueRoute(repository: FakeIssuesRepository, verb: string, rest: string, query: URLSearchParams, input: Record<string, unknown>): RunResult {
    let match: RegExpExecArray | null;
    if (rest === '/issues' && verb === 'GET') {
      const state = query.get('state') ?? 'open';
      const labels = (query.get('labels') ?? '').split(',').filter((label) => label !== '');
      const found = [...repository.issues.values()]
        .filter((issue) => !issue.deleted && (state === 'all' || issue.state === state))
        .filter((issue) => labels.every((label) => issue.labels.includes(label)))
        .sort((a, b) => b.number - a.number);
      return json(page(found, query).map((issue) => issueJson(repository, issue)));
    }
    if (rest === '/issues' && verb === 'POST') {
      const issue = addIssue([...repositories.entries()].find(([, entry]) => entry === repository)![0], {
        title: String(input.title),
        body: (input.body as string | undefined) ?? null,
        labels: (input.labels as string[] | undefined) ?? [],
      });
      return json(issueJson(repository, issue));
    }
    if ((match = /^\/issues\/comments\/(\d+)$/.exec(rest))) {
      const comment = repository.comments.find((entry) => entry.id === Number(match![1]));
      if (!comment) return notFound();
      if (verb === 'PATCH') {
        comment.body = String(input.body);
        return json(commentJson(comment));
      }
      if (verb === 'DELETE') {
        repository.comments.splice(repository.comments.indexOf(comment), 1);
        return ok();
      }
    }
    if (!(match = /^\/issues\/(\d+)(\/.*)?$/.exec(rest))) return notFound();
    const issue = repository.issues.get(Number(match[1]));
    const tail = match[2] ?? '';
    if (!issue) return notFound();
    if (issue.deleted) return gone();
    if (tail === '' && verb === 'GET') return json(issueJson(repository, issue));
    if (tail === '' && verb === 'PATCH') {
      if (typeof input.title === 'string') issue.title = input.title;
      if (typeof input.body === 'string') issue.body = input.body;
      if (Array.isArray(input.labels)) issue.labels = [...(input.labels as string[])];
      if (Array.isArray(input.assignees)) setAssignees(issue, repository, input.assignees as string[]);
      if (input.state === 'open' || input.state === 'closed') {
        issue.state = input.state;
        issue.stateReason = (input.state_reason as string | undefined) ?? null;
        issue.duplicateIssueId = input.state_reason === 'duplicate' ? ((input.duplicate_issue_id as number | undefined) ?? null) : null;
      }
      return json(issueJson(repository, issue));
    }
    if (tail === '/assignees') {
      const logins = input.assignees as string[];
      if (verb === 'POST') setAssignees(issue, repository, [...issue.assignees, ...logins]);
      if (verb === 'DELETE') setAssignees(issue, repository, issue.assignees.filter((login) => !logins.some((entry) => sameLogin(entry, login))));
      return json(issueJson(repository, issue));
    }
    if (tail === '/timeline' && verb === 'GET') {
      return json(page([{ event: 'labeled', label: { name: 'x' } }, ...issue.events.map((event) => ({ ...event, assignee: { login: event.assignee } }))], query));
    }
    if (tail === '/comments' && verb === 'GET') {
      return json(page(repository.comments.filter((comment) => comment.issue === issue.number).map(commentJson), query));
    }
    if (tail === '/comments' && verb === 'POST') {
      const comment = addComment([...repositories.entries()].find(([, entry]) => entry === repository)![0], issue.number, me, String(input.body));
      return json(commentJson(comment));
    }
    if (tail === '/sub_issues' && verb === 'POST') {
      issue.subIssues.push(input.sub_issue_id as number);
      return json(issueJson(repository, issue));
    }
    if (tail === '/dependencies/blocked_by' && verb === 'GET') {
      const blockers = [...repository.issues.values()].filter((entry) => issue.blockedBy.includes(entry.id));
      return json(page(blockers.map((entry) => issueJson(repository, entry)), query));
    }
    if (tail === '/dependencies/blocked_by' && verb === 'POST') {
      issue.blockedBy.push(input.issue_id as number);
      return json(issueJson(repository, issue));
    }
    if ((match = /^\/dependencies\/blocked_by\/(\d+)$/.exec(tail)) && verb === 'DELETE') {
      issue.blockedBy = issue.blockedBy.filter((blocker) => blocker !== Number(match![1]));
      return json(issueJson(repository, issue));
    }
    return failed(`The fake GitHub has no route '${verb} ${rest}'`);
  }

  function api(args: string[], input: Record<string, unknown>): RunResult {
    const methodAt = args.indexOf('--method');
    const method = methodAt >= 0 ? args[methodAt + 1] : 'GET';
    const target = args.find((arg, index) => !arg.startsWith('-') && !args[index - 1]?.startsWith('-') && arg !== method)!;
    const [path, search = ''] = target.split('?');
    const route = `${method} ${path}`;
    for (const [prefix, hook] of hooks) {
      if (route.startsWith(prefix)) {
        hooks.delete(prefix);
        hook();
      }
    }
    for (const [prefix, answer] of answers) {
      if (route.startsWith(prefix)) {
        answers.delete(prefix);
        return answer;
      }
    }
    if (route === 'GET user') return json({ login: me, name: null, email: null });
    const match = /^(\w+) repos\/([^/]+\/[^/]+)(.*)$/.exec(route);
    if (!match) throw new Error(`The fake GitHub has no answer for 'gh api ${args.join(' ')}'`);
    const [, verb, id, rest] = match;
    const repository = repositories.get(id);
    if (!repository) return notFound();
    if (rest === '' && verb === 'GET') {
      return json({ archived: repository.archived, has_issues: true, default_branch: 'main', topics: [], permissions: { admin: true, push: true, pull: true } });
    }
    const file = /^\/contents\/(.+)$/.exec(rest);
    if (file && verb === 'GET') {
      const content = repository.files.get(file[1]);
      return content === undefined ? notFound() : json({ encoding: 'base64', content: Buffer.from(content, 'utf8').toString('base64') });
    }
    if (repository.archived && verb !== 'GET') return failed('gh: Repository was archived so is read-only. (HTTP 403)');
    const result = issueRoute(repository, verb, rest, new URLSearchParams(search), input);
    if (result.stderr.startsWith('The fake GitHub has no route')) {
      throw new Error(`The fake GitHub has no answer for 'gh api ${args.join(' ')}'`);
    }
    return result;
  }

  const runner: ProcessRunner = async (command, args, options) => {
    calls.push([command, ...args].join(' '));
    if (args[0] !== 'api') throw new Error(`The fake GitHub has no answer for 'gh ${args.join(' ')}'`);
    const input = args.includes('--input') ? (JSON.parse(options?.input ?? 'null') as Record<string, unknown>) : {};
    return api([...args.slice(1)], input);
  };

  return {
    gh: createGh(runner) as Gh,
    calls,
    me,
    repositories,
    addRepository,
    addIssue,
    addComment,
    assignFromElsewhere,
    /** Runs `hook` just before the next call to `<METHOD> <path prefix>`, such as another laptop acting first. */
    before(prefix: string, hook: () => void) {
      hooks.set(prefix, hook);
    },
    /** Answers the next call to `<METHOD> <path prefix>` with standard output `stdout`, as a damaged answer would. */
    answerNext(prefix: string, stdout: string) {
      answers.set(prefix, ok(stdout));
    },
  };
}

export type FakeIssues = ReturnType<typeof createFakeIssues>;
