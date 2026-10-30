/**
 * The project folder: the local clone of a project's repository at `<root>/<owner>/<repo>`, which every agent
 * runs in and every Grillo folder write goes through (committed, then pushed). See docs/store-layout.md:
 * "Codes: S, Q and v" for the retry rule and "Saves to a protected main" for the pull request fallback and the
 * saves still waiting in one.
 */
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, posix } from 'node:path';
import type { Gh, ProcessRunner, RunResult } from '../../gh';
import { StoreError, type PullRequestNotice } from '../../store';
import type { ProjectId, RepositoryRef } from '../../types';
import type { GithubApi } from './github-api';
import { projectIdOf } from './names';

/** One file a save writes; null content deletes it. Paths are relative to the repository, with forward slashes. */
export interface FileChange {
  path: string;
  content: string | null;
}

/** What a save does, worked out afresh from the files on every attempt. */
export interface SavePlan<T> {
  changes: FileChange[];
  /** The commit message, also the pull request title when main is protected. */
  message: string;
  result: T;
}

/** Reads files in the project folder; paths as in `FileChange`. */
export interface FolderReader {
  read(path: string): Promise<string | null>;
  /** The file names in a folder; empty when the folder does not exist. */
  list(path: string): Promise<string[]>;
}

/** A change that differs from the folder; `existed` says whether its file is on main. */
interface PendingChange extends FileChange {
  existed: boolean;
}

export type { PullRequestNotice };

/**
 * A save that went to a pull request because main is protected, while that pull request is still open: its files
 * as the pull request has them (null for a file it deletes). Reads see them over main, so the next number is free
 * and a record saved a moment ago can be read and changed again (docs/store-layout.md, "Saves to a protected main").
 */
interface WaitingSave {
  head: string;
  url: string;
  title: string;
  files: Map<string, string | null>;
}

export interface ProjectFoldersOptions {
  gh: Gh;
  api: GithubApi;
  git: ProcessRunner;
  root: string;
  now: () => Date;
  onPullRequest: (notice: PullRequestNotice) => void;
}

/** How often a save is tried again after someone else pushed first. */
const SAVE_ATTEMPTS = 3;
const GIT = 'git';
const PROTECTED = /protected branch|GH006|GH013|rule violations|\[remote rejected\]/i;
const RACED = /\[rejected\]|fetch first|non-fast-forward/i;

type PushRefusal = 'protected' | 'raced' | 'failed';

function refusalOf(stderr: string): PushRefusal {
  if (PROTECTED.test(stderr)) {
    return 'protected';
  }
  return RACED.test(stderr) ? 'raced' : 'failed';
}

const unixLines = (text: string): string => text.replace(/\r\n/g, '\n');

export type ProjectFolders = ReturnType<typeof createProjectFolders>;

export function createProjectFolders({ gh, api, git, root, now, onPullRequest }: ProjectFoldersOptions) {
  /** One operation per project folder at a time: two git commands in one clone would trip over its lock. */
  const queues = new Map<ProjectId, Promise<unknown>>();
  /** Per project, the saves this run of Grillo sent to a pull request that is still open, oldest first. */
  const waiting = new Map<ProjectId, WaitingSave[]>();
  /** Every branch name a save used in this run, so two saves in one millisecond never share a branch. */
  const usedHeads = new Set<string>();

  const waitingIn = (ref: RepositoryRef): WaitingSave[] => waiting.get(projectIdOf(ref)) ?? [];

  /** Forgets the waiting saves whose pull request was merged or closed: main (or nothing) has the last word again. */
  async function forgetSettledSaves(ref: RepositoryRef): Promise<void> {
    const saves = waitingIn(ref);
    if (saves.length === 0) {
      return;
    }
    const open = new Set(await api.openPullRequestUrls(ref));
    waiting.set(
      projectIdOf(ref),
      saves.filter((save) => open.has(save.url)),
    );
  }

  function serially<T>(ref: RepositoryRef, work: () => Promise<T>): Promise<T> {
    const id = projectIdOf(ref);
    const run = (queues.get(id) ?? Promise.resolve()).then(work, work);
    queues.set(
      id,
      run.catch(() => undefined),
    );
    return run;
  }

  const pathOf = (ref: RepositoryRef): string => join(root, ref.owner, ref.name);

  async function runGit(ref: RepositoryRef, args: string[]): Promise<RunResult> {
    try {
      return await git(GIT, args, { cwd: pathOf(ref) });
    } catch (error) {
      const missing = (error as { code?: unknown } | null)?.code === 'ENOENT';
      throw new StoreError('backend', missing ? 'git is not installed or not on PATH' : `git could not start: ${String(error)}`);
    }
  }

  async function gitOk(ref: RepositoryRef, args: string[]): Promise<string> {
    const result = await runGit(ref, args);
    if (result.exitCode !== 0) {
      throw new StoreError('backend', `git ${args[0]} failed in ${pathOf(ref)}: ${result.stderr.trim()}`);
    }
    return result.stdout;
  }

  const isClone = (ref: RepositoryRef): boolean => existsSync(join(pathOf(ref), '.git'));

  async function clone(ref: RepositoryRef): Promise<void> {
    const folder = pathOf(ref);
    if (existsSync(folder)) {
      throw new StoreError('conflict', `${folder} exists but is not a clone of ${projectIdOf(ref)}: move it away, then try again`);
    }
    await mkdir(dirname(folder), { recursive: true });
    await api.repository(ref);
    await gh.text(['repo', 'clone', projectIdOf(ref), folder]);
  }

  const succeeds = async (ref: RepositoryRef, args: string[]): Promise<boolean> => (await runGit(ref, args)).exitCode === 0;

  /** True for a clone of a repository that has no commit yet: there is nothing to pull, and the first save makes the first commit. */
  async function isEmptyRepository(ref: RepositoryRef): Promise<boolean> {
    if (await succeeds(ref, ['rev-parse', '--verify', '-q', 'HEAD'])) {
      return false;
    }
    const heads = await runGit(ref, ['ls-remote', '--heads', 'origin']);
    return heads.exitCode === 0 && heads.stdout.trim() === '';
  }

  async function pull(ref: RepositoryRef): Promise<void> {
    const result = await runGit(ref, ['pull', '--ff-only']);
    if (result.exitCode !== 0 && !(await isEmptyRepository(ref))) {
      throw new StoreError(
        'conflict',
        `The project folder ${pathOf(ref)} could not be brought up to date with GitHub; Grillo changed nothing in it: ${result.stderr.trim()}`,
      );
    }
  }

  /**
   * Clones the repository, or pulls it: every read and every save starts from main as GitHub has it, plus the saves
   * still waiting in an open pull request.
   */
  async function update(ref: RepositoryRef): Promise<void> {
    if (isClone(ref)) {
      await pull(ref);
    } else {
      await clone(ref);
    }
    await forgetSettledSaves(ref);
  }

  /** The files on main, as the project folder has them. */
  function mainReader(ref: RepositoryRef): FolderReader {
    const folder = pathOf(ref);
    return {
      async read(path) {
        const file = join(folder, path);
        return existsSync(file) ? unixLines(await readFile(file, 'utf8')) : null;
      },
      async list(path) {
        const directory = join(folder, path);
        return existsSync(directory) ? readdir(directory) : [];
      },
    };
  }

  /** The newest waiting save that holds the file. */
  const waitingSaveOf = (ref: RepositoryRef, path: string): WaitingSave | undefined => waitingIn(ref).findLast((save) => save.files.has(path));

  /**
   * The files as the member last saved them: main, with the waiting saves over it. A file read from a waiting save
   * is noted in `used`, so a save built on it joins that save's pull request.
   */
  function reader(ref: RepositoryRef, used?: Set<WaitingSave>): FolderReader {
    const main = mainReader(ref);
    return {
      async read(path) {
        const save = waitingSaveOf(ref, path);
        if (save === undefined) {
          return main.read(path);
        }
        used?.add(save);
        return save.files.get(path) ?? null;
      },
      async list(path) {
        const names = new Set(await main.list(path));
        for (const save of waitingIn(ref)) {
          for (const [file, content] of save.files) {
            if (posix.dirname(file) === posix.normalize(path)) {
              const name = posix.basename(file);
              if (content === null) {
                names.delete(name);
              } else {
                names.add(name);
              }
            }
          }
        }
        return [...names];
      },
    };
  }

  /**
   * The changes that differ from what is there, each noting whether its file exists on main. A file the member
   * changed in the folder without saving it is never written over: the save is refused instead.
   */
  async function pendingChanges(ref: RepositoryRef, changes: FileChange[]): Promise<PendingChange[]> {
    const files = mainReader(ref);
    const changed: PendingChange[] = [];
    for (const change of changes) {
      const current = await files.read(change.path);
      if (current !== (change.content === null ? null : unixLines(change.content))) {
        changed.push({ ...change, existed: current !== null });
      }
    }
    const paths = changed.map((change) => change.path);
    const unsaved = paths.length === 0 ? '' : (await gitOk(ref, ['status', '--porcelain', '--', ...paths])).trim();
    if (unsaved !== '') {
      throw new StoreError(
        'conflict',
        `The project folder ${pathOf(ref)} has changes to these files that are not on GitHub; save or discard them first:\n${unsaved}`,
      );
    }
    return changed;
  }

  async function write(ref: RepositoryRef, changes: PendingChange[]): Promise<void> {
    for (const { path, content } of changes) {
      const file = join(pathOf(ref), path);
      if (content === null) {
        await rm(file);
      } else {
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, content, 'utf8');
      }
    }
  }

  /** Unstages a save that never became a commit and puts its files back as main has them; other changes stay. */
  async function discard(ref: RepositoryRef, changes: PendingChange[]): Promise<void> {
    await gitOk(ref, ['reset', '-q', '--', ...changes.map((change) => change.path)]);
    const onMain = changes.filter((change) => change.existed).map((change) => change.path);
    if (onMain.length > 0) {
      await gitOk(ref, ['checkout', '-q', 'HEAD', '--', ...onMain]);
    }
    for (const change of changes.filter((entry) => !entry.existed)) {
      await rm(join(pathOf(ref), change.path), { force: true });
    }
  }

  /** Writes and commits the changes; when that fails, the folder is left as main has it. */
  async function commit(ref: RepositoryRef, changes: PendingChange[], message: string): Promise<void> {
    const paths = changes.map((change) => change.path);
    try {
      await write(ref, changes);
      await gitOk(ref, ['add', '--', ...paths]);
      await gitOk(ref, ['commit', '-m', message, '--', ...paths]);
    } catch (error) {
      await discard(ref, changes).catch(() => undefined);
      throw error;
    }
  }

  /**
   * Takes the save's commit back out and puts its files back as main has them; other changes stay. The first
   * commit of an empty repository has no parent to go back to: the branch becomes empty again and its files go.
   */
  async function undoCommit(ref: RepositoryRef, changes: PendingChange[]): Promise<void> {
    if (await succeeds(ref, ['rev-parse', '--verify', '-q', 'HEAD~1'])) {
      await gitOk(ref, ['reset', '--keep', 'HEAD~1']);
      return;
    }
    const paths = changes.map((change) => change.path);
    await gitOk(ref, ['update-ref', '-d', 'HEAD']);
    await gitOk(ref, ['rm', '--cached', '-q', '--', ...paths]);
    for (const path of paths) {
      await rm(join(pathOf(ref), path), { force: true });
    }
  }

  /** A branch name no save of this run has used: the save's moment, plus a count when two share a millisecond. */
  function newHead(): string {
    const base = `grillo/save-${now().getTime()}`;
    let head = base;
    for (let count = 2; usedHeads.has(head); count++) {
      head = `${base}-${count}`;
    }
    usedHeads.add(head);
    return head;
  }

  /** Pushes the commit to `head` and takes it back out of main in the folder, whatever the push did. */
  async function pushToBranch(ref: RepositoryRef, changes: PendingChange[], head: string, replace: boolean): Promise<void> {
    try {
      await gitOk(ref, ['push', 'origin', `${replace ? '+' : ''}HEAD:refs/heads/${head}`]);
    } finally {
      await undoCommit(ref, changes);
    }
  }

  const filesOf = (changes: FileChange[]): Map<string, string | null> => new Map(changes.map((change) => [change.path, change.content]));

  /** The commit goes to a branch of its own, and a pull request asks to bring it into main. */
  async function proposeChange(ref: RepositoryRef, base: string, changes: PendingChange[], message: string): Promise<void> {
    const head = newHead();
    await pushToBranch(ref, changes, head, false);
    const body = `Grillo could not save this change straight to \`${base}\`, which is protected. Merge this pull request to keep it.`;
    const url = await api.openPullRequest(ref, { base, head, title: message, body });
    waiting.set(projectIdOf(ref), [...waitingIn(ref), { head, url, title: message, files: filesOf(changes) }]);
    onPullRequest({ project: projectIdOf(ref), url, title: message });
  }

  /**
   * A save built on a waiting save joins its pull request: the branch is replaced by one commit holding both, so
   * the pull request never conflicts with itself. Only Grillo writes to its save branches.
   */
  async function joinWaitingSave<T>(ref: RepositoryRef, save: WaitingSave, plan: SavePlan<T>): Promise<T> {
    const files = new Map([...save.files, ...filesOf(plan.changes)]);
    const unchanged = [...files].every(([path, content]) => save.files.has(path) && save.files.get(path) === content);
    if (unchanged) {
      return plan.result;
    }
    const pending = await pendingChanges(ref, [...files].map(([path, content]) => ({ path, content })));
    if (pending.length === 0) {
      return plan.result;
    }
    await commit(ref, pending, save.title);
    await pushToBranch(ref, pending, save.head, true);
    save.files = files;
    onPullRequest({ project: projectIdOf(ref), url: save.url, title: save.title });
    return plan.result;
  }

  /** The one waiting save a plan builds on, by the files it read or writes; none when it touches main alone. */
  function waitingSaveUsed(ref: RepositoryRef, used: Set<WaitingSave>, changes: FileChange[]): WaitingSave | undefined {
    for (const change of changes) {
      const save = waitingSaveOf(ref, change.path);
      if (save !== undefined) {
        used.add(save);
      }
    }
    if (used.size > 1) {
      const urls = [...used].map((save) => save.url).join(', ');
      throw new StoreError('conflict', `This change builds on several saves still waiting as pull requests (${urls}); merge them first, then try again`);
    }
    return [...used][0];
  }

  async function save<T>(ref: RepositoryRef, branch: string, plan: (files: FolderReader) => Promise<SavePlan<T>>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      await update(ref);
      const used = new Set<WaitingSave>();
      const planned = await plan(reader(ref, used));
      const { changes, message, result } = planned;
      const joined = waitingSaveUsed(ref, used, changes);
      if (joined !== undefined) {
        return joinWaitingSave(ref, joined, planned);
      }
      const pending = await pendingChanges(ref, changes);
      if (pending.length === 0) {
        return result;
      }
      await commit(ref, pending, message);
      const push = await runGit(ref, ['push', 'origin', `HEAD:${branch}`]);
      if (push.exitCode === 0) {
        return result;
      }
      const refusal = refusalOf(push.stderr);
      if (refusal === 'protected') {
        await proposeChange(ref, branch, pending, message);
        return result;
      }
      await undoCommit(ref, pending);
      if (refusal === 'failed') {
        throw new StoreError('backend', `Saving to ${projectIdOf(ref)} failed: ${push.stderr.trim()}`);
      }
      if (attempt === SAVE_ATTEMPTS) {
        throw new StoreError('conflict', `Others kept saving to ${projectIdOf(ref)} first; try again`);
      }
    }
  }

  return {
    pathOf,

    /** Reads from the project folder once it matches main on GitHub. */
    reading<T>(ref: RepositoryRef, work: (files: FolderReader) => Promise<T>): Promise<T> {
      return serially(ref, async () => {
        await update(ref);
        return work(reader(ref));
      });
    },

    /**
     * Saves to `branch` through the project folder: pull, plan, write, commit, push. When someone pushed
     * first, the commit is taken back and the plan runs again on their work, so a number taken from the
     * files (S<n>, v<n>) is the next free one. A protected branch gets a pull request instead.
     */
    saving<T>(ref: RepositoryRef, branch: string, plan: (files: FolderReader) => Promise<SavePlan<T>>): Promise<T> {
      return serially(ref, () => save(ref, branch, plan));
    },

    /** Clones or pulls for the member; a folder with changes not yet saved is reported, never reset. */
    open(ref: RepositoryRef): Promise<string> {
      return serially(ref, async () => {
        if (isClone(ref)) {
          const changes = (await gitOk(ref, ['status', '--porcelain'])).trim();
          if (changes !== '') {
            throw new StoreError(
              'conflict',
              `The project folder ${pathOf(ref)} has changes that are not on GitHub; Grillo left them untouched. ` +
                `Save or discard them, then open the project again:\n${changes}`,
            );
          }
          await pull(ref);
        } else {
          await clone(ref);
        }
        return pathOf(ref);
      });
    },
  };
}
