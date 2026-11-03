/**
 * A made-up GitHub for tests: answers the `gh` commands the repository backend runs, and models `git` in a
 * project folder (clone, pull, add, commit, push, reset) against each repository's main branch. A command it
 * does not know fails the test, so no test can reach the real `gh`, the real `git` or the network.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { createGh, type Gh, type ProcessRunner, type RunResult } from '../../gh';

export interface FakeUser {
  login: string;
  name: string | null;
  email: string | null;
}

export interface FakeRepository {
  archived: boolean;
  hasIssues: boolean;
  defaultBranch: string;
  permission: 'admin' | 'write' | 'read';
  topics: string[];
  visibility: 'private' | 'public';
  /** The default branch's files. */
  files: Map<string, string>;
  /** Goes up on every push to the default branch. */
  version: number;
  /** A protected default branch refuses direct pushes. */
  protected: boolean;
  labels: Map<string, string>;
  collaborators: Map<string, string>;
  /** `permission` is left out of an invite to a personal repository, where GitHub takes none. */
  invitations: { id: number; invitee: string; permission: string | undefined }[];
  branches: Map<string, Map<string, string>>;
  pullRequests: { base: string; head: string; title: string }[];
  /** The numbers of the pull requests merged or closed; every other one is open. */
  settledPullRequests: Set<number>;
}

export interface FakeInvitation {
  id: number;
  repository: string;
  inviter: string;
  createdAt: string;
}

interface Commit {
  before: Map<string, string>;
  after: Map<string, string>;
  /** The branch's first commit: it has no parent. */
  root: boolean;
}

interface Clone {
  repository: string;
  head: Map<string, string>;
  /** The repository version the clone was last in step with. */
  base: number;
  commits: Commit[];
  /** Paths added to the index and not yet committed. */
  staged: Set<string>;
  /** False until the local branch has a commit: a clone of an empty repository starts without one. */
  born: boolean;
}

const ok = (stdout = ''): RunResult => ({ exitCode: 0, stdout, stderr: '' });
const failed = (stderr: string): RunResult => ({ exitCode: 1, stdout: '', stderr });
const notFound = (): RunResult => failed('gh: Not Found (HTTP 404)');
const json = (value: unknown): RunResult => ok(`${JSON.stringify(value)}\n`);

export function readTree(folder: string): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (directory: string): void => {
    for (const name of readdirSync(directory)) {
      const path = join(directory, name);
      if (name === '.git') {
        continue;
      }
      if (statSync(path).isDirectory()) {
        walk(path);
      } else {
        files.set(relative(folder, path).replace(/\\/g, '/'), readFileSync(path, 'utf8'));
      }
    }
  };
  if (existsSync(folder)) {
    walk(folder);
  }
  return files;
}

function writeTree(folder: string, path: string, content: string | undefined): void {
  const file = join(folder, path);
  if (content === undefined) {
    rmSync(file, { force: true });
  } else {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content, 'utf8');
  }
}

function changedPaths(a: Map<string, string>, b: Map<string, string>): string[] {
  return [...new Set([...a.keys(), ...b.keys()])].filter((path) => a.get(path) !== b.get(path));
}

export function createFakeGithub(me: FakeUser = { login: 'ada-example', name: 'Ada Example', email: 'ada@example.com' }) {
  const repositories = new Map<string, FakeRepository>();
  const users = new Map<string, FakeUser>([[me.login, me]]);
  const organisations: string[] = ['example-org'];
  const invitations: FakeInvitation[] = [];
  const clones = new Map<string, Clone>();
  const calls: string[] = [];
  /** Runs once, just before the next push to a default branch: someone else saving first. */
  let beforePush: (() => void) | null = null;
  /** The next `git add` or `git commit` fails with this message, as git does without an identity. */
  let failing: { step: 'add' | 'commit'; stderr: string } | null = null;
  /** GitHub logins ignore case: `users/BEN-example` answers with the account `ben-example`. */
  const account = (login: string): FakeUser | undefined => [...users.values()].find((user) => user.login.toLowerCase() === login.toLowerCase());

  function addRepository(id: string, options: Partial<Omit<FakeRepository, 'files'>> & { files?: Record<string, string> } = {}): FakeRepository {
    const repository: FakeRepository = {
      archived: false,
      hasIssues: true,
      defaultBranch: 'main',
      permission: 'admin',
      topics: [],
      visibility: 'private',
      version: 1,
      protected: false,
      labels: new Map(),
      collaborators: new Map(),
      invitations: [],
      branches: new Map(),
      pullRequests: [],
      settledPullRequests: new Set(),
      ...options,
      files: new Map(Object.entries(options.files ?? { 'README.md': '# Readme\n' })),
    };
    repositories.set(id, repository);
    return repository;
  }

  /** Someone else pushes a change to the default branch. */
  function pushFromElsewhere(id: string, path: string, content: string): void {
    const repository = repositories.get(id)!;
    repository.files.set(path, content);
    repository.version++;
  }

  /** Someone merges (the branch's files become main) or closes a pull request on GitHub. */
  function settlePullRequest(id: string, number: number, how: 'merge' | 'close'): void {
    const repository = repositories.get(id)!;
    const pull = repository.pullRequests[number - 1];
    if (how === 'merge') {
      repository.files = new Map(repository.branches.get(pull.head));
      repository.version++;
    }
    repository.settledPullRequests.add(number);
  }

  function repositoryJson(id: string, repository: FakeRepository) {
    const { permission } = repository;
    const [owner, name] = id.split('/');
    return {
      name,
      owner: { login: owner, type: organisations.includes(owner) ? 'Organization' : 'User' },
      private: repository.visibility !== 'public',
      visibility: repository.visibility,
      archived: repository.archived,
      has_issues: repository.hasIssues,
      default_branch: repository.defaultBranch,
      topics: repository.topics,
      permissions: { admin: permission === 'admin', push: permission !== 'read', pull: true },
    };
  }

  function api(args: string[]): RunResult {
    const methodAt = args.indexOf('--method');
    const method = methodAt >= 0 ? args[methodAt + 1] : 'GET';
    const path = args.find((arg, index) => !arg.startsWith('-') && !args[index - 1]?.startsWith('-'))!;
    const field = (flag: string): string | undefined => {
      const at = args.indexOf(flag);
      return at >= 0 ? args[at + 1].split('=')[1] : undefined;
    };
    const route = `${method} ${path}`;
    let match: RegExpExecArray | null;
    if (route === 'GET user') return json(me);
    if (route === 'GET user/emails') return json(me.email ? [{ email: me.email, primary: true }] : []);
    if (route === 'GET user/orgs?per_page=100') return json(organisations.map((login) => ({ login })));
    if ((match = /^GET user\/repos\?per_page=(\d+)&page=(\d+)$/.exec(route))) {
      const [size, page] = [Number(match[1]), Number(match[2])];
      const all = [...repositories.entries()].map(([id, repository]) => repositoryJson(id, repository));
      return json(all.slice((page - 1) * size, page * size));
    }
    if (route === 'GET user/repository_invitations?per_page=100') {
      return json(
        invitations.map((invitation) => {
          const [owner, name] = invitation.repository.split('/');
          return { id: invitation.id, repository: { name, owner: { login: owner } }, inviter: { login: invitation.inviter }, created_at: invitation.createdAt };
        }),
      );
    }
    if ((match = /^PATCH user\/repository_invitations\/(\d+)$/.exec(route))) {
      const index = invitations.findIndex((invitation) => invitation.id === Number(match![1]));
      if (index < 0) return notFound();
      invitations.splice(index, 1);
      return ok();
    }
    if ((match = /^GET users\/(.+)$/.exec(route))) {
      const user = account(match[1]);
      return user ? json(user) : notFound();
    }
    if ((match = /^(\w+) repos\/([^/]+\/[^/?]+)(.*)$/.exec(route))) {
      const [, verb, id, rest] = match;
      const repository = repositories.get(id);
      if (!repository) return notFound();
      if (rest === '' && verb === 'GET') return json(repositoryJson(id, repository));
      if (rest === '' && verb === 'PATCH') {
        repository.archived = field('-F') === 'true';
        return ok();
      }
      if ((match = /^\/collaborators\/(.+)$/.exec(rest))) {
        const login = match[1];
        if (verb === 'PUT') {
          const invitee = account(login);
          if (!invitee) return notFound();
          repository.invitations.push({ id: repository.invitations.length + 100, invitee: invitee.login, permission: field('-f') });
          return ok();
        }
        return repository.collaborators.delete(login) ? ok() : notFound();
      }
      if (rest === '/invitations?per_page=100') {
        return json(repository.invitations.map(({ id: invitationId, invitee }) => ({ id: invitationId, invitee: { login: invitee } })));
      }
      if ((match = /^\/invitations\/(\d+)$/.exec(rest)) && verb === 'DELETE') {
        repository.invitations = repository.invitations.filter((invitation) => invitation.id !== Number(match![1]));
        return ok();
      }
    }
    throw new Error(`The fake GitHub has no answer for 'gh ${args.join(' ')}'`);
  }

  function ghCommand(args: string[]): RunResult {
    const [group, action, target] = args;
    if (group === 'api') return api(args.slice(1));
    if (group === 'repo' && action === 'create') {
      if (repositories.has(target)) return failed('GraphQL: Name already exists on this account (createRepository)');
      if (!organisations.includes(target.split('/')[0]) && account(target.split('/')[0])?.login !== me.login) {
        return failed('GraphQL: Could not resolve to a Repository owner (HTTP 404)');
      }
      const chosen = (['private', 'public'] as const).filter((choice) => args.includes(`--${choice}`));
      if (chosen.length !== 1) return failed('--public, --private, or --internal required when not running interactively');
      addRepository(target, { visibility: chosen[0] });
      return ok(`https://github.com/${target}\n`);
    }
    if (group === 'repo' && action === 'edit') {
      repositories.get(target)!.topics.push(args[args.indexOf('--add-topic') + 1]);
      return ok();
    }
    if (group === 'label' && action === 'create') {
      const repository = repositories.get(args[args.indexOf('--repo') + 1])!;
      repository.labels.set(target, args[args.indexOf('--description') + 1]);
      return ok();
    }
    if (group === 'repo' && action === 'clone') {
      const repository = repositories.get(target);
      if (!repository) return failed('GraphQL: Could not resolve to a Repository with the name.');
      const folder = args[3];
      mkdirSync(join(folder, '.git'), { recursive: true });
      repository.files.forEach((content, path) => writeTree(folder, path, content));
      clones.set(folder, { repository: target, head: new Map(repository.files), base: repository.version, commits: [], staged: new Set(), born: repository.version > 0 });
      return ok();
    }
    if (group === 'pr' && action === 'create') {
      const id = args[args.indexOf('--repo') + 1];
      const repository = repositories.get(id)!;
      const pull = { base: args[args.indexOf('--base') + 1], head: args[args.indexOf('--head') + 1], title: args[args.indexOf('--title') + 1] };
      repository.pullRequests.push(pull);
      return ok(`https://github.com/${id}/pull/${repository.pullRequests.length}\n`);
    }
    if (group === 'pr' && action === 'list' && args.join(' ').endsWith('--state open --json url --limit 500')) {
      const id = args[args.indexOf('--repo') + 1];
      const repository = repositories.get(id)!;
      const open = repository.pullRequests.map((_pull, index) => index + 1).filter((number) => !repository.settledPullRequests.has(number));
      return json(open.map((number) => ({ url: `https://github.com/${id}/pull/${number}` })));
    }
    throw new Error(`The fake GitHub has no answer for 'gh ${args.join(' ')}'`);
  }

  function gitCommand(folder: string, args: string[]): RunResult {
    const clone = clones.get(folder);
    if (!clone) throw new Error(`git ran outside a clone: ${folder}`);
    const repository = repositories.get(clone.repository)!;
    const working = readTree(folder);
    const line = args.join(' ');
    const paths = args.slice(args.indexOf('--') + 1);
    if (args[0] === 'status') {
      const wanted = args.includes('--') ? paths : null;
      const changed = new Set([...changedPaths(clone.head, working), ...clone.staged]);
      const dirty = [...changed].filter((path) => wanted === null || wanted.includes(path));
      return ok(dirty.map((path) => ` M ${path}\n`).join(''));
    }
    if (line === 'pull --ff-only') {
      if (repository.version === 0) {
        return failed(`Your configuration specifies to merge with the ref 'refs/heads/${repository.defaultBranch}'\nfrom the remote, but no such ref was fetched.`);
      }
      if (repository.version === clone.base) return ok('Already up to date.\n');
      if (clone.commits.length > 0) return failed('fatal: Not possible to fast-forward, aborting.');
      const incoming = changedPaths(clone.head, repository.files);
      const dirty = changedPaths(clone.head, working);
      if (incoming.some((path) => dirty.includes(path))) return failed('error: Your local changes would be overwritten by merge');
      incoming.forEach((path) => writeTree(folder, path, repository.files.get(path)));
      clone.head = new Map(repository.files);
      clone.base = repository.version;
      return ok();
    }
    if (failing?.step === args[0]) {
      const { stderr } = failing;
      failing = null;
      if (args[0] === 'add') paths.slice(0, 1).forEach((path) => clone.staged.add(path));
      return failed(stderr);
    }
    if (line === 'rev-parse --verify -q HEAD') {
      return clone.born ? ok('0123abcd\n') : failed('');
    }
    if (line === 'rev-parse --verify -q HEAD~1') {
      const last = clone.commits.at(-1);
      return last !== undefined && !last.root ? ok('0123abcd\n') : failed('');
    }
    if (line === 'ls-remote --heads origin') {
      return ok(repository.version > 0 ? `0123abcd\trefs/heads/${repository.defaultBranch}\n` : '');
    }
    if (line === 'update-ref -d HEAD') {
      const commit = clone.commits.pop()!;
      clone.head = commit.before;
      clone.born = false;
      commit.after.forEach((_content, path) => clone.staged.add(path));
      return ok();
    }
    if (line.startsWith('rm --cached -q -- ')) {
      paths.forEach((path) => clone.staged.delete(path));
      return ok();
    }
    if (line.startsWith('reset -q -- ')) {
      paths.forEach((path) => clone.staged.delete(path));
      return ok();
    }
    if (line.startsWith('checkout -q HEAD -- ')) {
      const unknown = paths.find((path) => !clone.head.has(path));
      if (unknown) return failed(`error: pathspec '${unknown}' did not match any file(s) known to git`);
      paths.forEach((path) => writeTree(folder, path, clone.head.get(path)));
      return ok();
    }
    if (args[0] === 'add') {
      const unknown = paths.find((path) => !working.has(path) && !clone.head.has(path));
      if (unknown) return failed(`fatal: pathspec '${unknown}' did not match any files`);
      paths.forEach((path) => clone.staged.add(path));
      return ok();
    }
    if (args[0] === 'commit') {
      const after = new Map(clone.head);
      paths.forEach((path) => (working.has(path) ? after.set(path, working.get(path)!) : after.delete(path)));
      paths.forEach((path) => clone.staged.delete(path));
      clone.commits.push({ before: clone.head, after, root: !clone.born });
      clone.born = true;
      clone.head = after;
      return ok();
    }
    if (args[0] === 'push') {
      const destination = args[2].split(':')[1];
      if (destination.startsWith('refs/heads/')) {
        repository.branches.set(destination.slice('refs/heads/'.length), new Map(clone.head));
        return ok();
      }
      const hook = beforePush;
      beforePush = null;
      hook?.();
      if (repository.protected) {
        return failed(` ! [remote rejected] ${destination} -> ${destination} (protected branch hook declined)\nremote: error: GH006: Protected branch update failed`);
      }
      if (repository.version !== clone.base) return failed(` ! [rejected]        ${destination} -> ${destination} (fetch first)`);
      repository.files = new Map(clone.head);
      repository.version++;
      clone.base = repository.version;
      clone.commits = [];
      return ok();
    }
    if (line === 'reset --keep HEAD~1') {
      if (clone.commits.at(-1)?.root) return failed("fatal: ambiguous argument 'HEAD~1': unknown revision");
      const commit = clone.commits.pop()!;
      changedPaths(commit.before, commit.after).forEach((path) => writeTree(folder, path, commit.before.get(path)));
      clone.head = commit.before;
      return ok();
    }
    throw new Error(`The fake git has no answer for 'git ${line}'`);
  }

  const ghRunner: ProcessRunner = async (command, args) => {
    calls.push([command, ...args].join(' '));
    return ghCommand([...args]);
  };

  const git: ProcessRunner = async (command, args, options) => {
    calls.push([command, ...args].join(' '));
    return gitCommand(options!.cwd!, [...args]);
  };

  return {
    gh: createGh(ghRunner) as Gh,
    git,
    calls,
    me,
    users,
    organisations,
    invitations,
    repositories,
    addRepository,
    pushFromElsewhere,
    settlePullRequest,
    failNext(step: 'add' | 'commit', stderr: string) {
      failing = { step, stderr };
    },
    onNextPush(hook: () => void) {
      beforePush = hook;
    },
  };
}

export type FakeGithub = ReturnType<typeof createFakeGithub>;
