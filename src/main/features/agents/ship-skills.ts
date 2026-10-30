import { execFile } from 'node:child_process';
import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';

/** Only folders with this prefix are Grillo's skills; anything else in the source folder is never shipped. */
const SKILL_FOLDER_PREFIX = 'grillo-';
/** Where Claude Code looks for a project's skills, relative to the project folder. */
const PROJECT_SKILLS_PATH = '.claude/skills';
/** Grillo's own tests and their test data stay in Grillo: a test runner in the member's project would pick them up. */
const TEST_FILE_SUFFIX = '.test.ts';
const TEST_DATA_FOLDER = 'fixtures/';

function isShipped(file: string): boolean {
  return !file.endsWith(TEST_FILE_SUFFIX) && !file.startsWith(TEST_DATA_FOLDER);
}

export interface ShipSkillsOptions {
  /** The app's own skills: `resources/skills/` in the repository, beside the app once installed. */
  sourceDir: string;
  /** The project folder, a clone of the project's repository. */
  folder: string;
  warn(message: string): void;
}

function git(folder: string, args: string[]): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    execFile('git', args, { cwd: folder, encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error) {
        const reason = stderr.trim() || error.message;
        reject(new Error(`Cannot ship Grillo's skills into '${folder}': git ${args.join(' ')} failed: ${reason}`));
        return;
      }
      resolvePromise(stdout);
    });
  });
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

async function skillNames(sourceDir: string): Promise<string[]> {
  try {
    const entries = await readdir(sourceDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && entry.name.startsWith(SKILL_FOLDER_PREFIX))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if (isMissing(error)) {
      return [];
    }
    throw error;
  }
}

/** Every file under `folder`, as a path relative to it with `/` separators (git's form). */
async function filesUnder(folder: string): Promise<string[]> {
  const entries = await readdir(folder, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(folder, join(entry.parentPath, entry.name)).split(sep).join('/'));
}

async function readIfPresent(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (isMissing(error)) {
      return '';
    }
    throw error;
  }
}

/** Adds each line the file lacks, leaving the rest of the file as it was. */
async function addMissingLines(path: string, lines: string[]): Promise<void> {
  const current = await readIfPresent(path);
  const present = new Set(current.split(/\r?\n/));
  const missing = lines.filter((line) => !present.has(line));
  if (missing.length === 0) {
    return;
  }
  const separator = current === '' || current.endsWith('\n') ? '' : '\n';
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${current}${separator}${missing.join('\n')}\n`);
}

/**
 * Copies every `grillo-*` skill folder into `<folder>/.claude/skills/`, on every launch so updates reach the
 * project, leaving out Grillo's own test files and test data. A file the project's repository tracks is never overwritten: it is skipped with a warning. The shipped
 * folders are listed in the clone's `.git/info/exclude`, so they never show up as changes. No CLAUDE.md is written.
 */
export async function shipSkills({ sourceDir, folder, warn }: ShipSkillsOptions): Promise<void> {
  const names = await skillNames(sourceDir);
  if (names.length === 0) {
    return;
  }

  // Paths in git's answers and in the exclude file start at the repository's top, which the folder may sit under.
  const prefix = (await git(folder, ['rev-parse', '--show-prefix'])).trim();
  const tracked = new Set(
    (await git(folder, ['ls-files', '-z', '--', PROJECT_SKILLS_PATH])).split('\0').filter((path) => path !== ''),
  );

  for (const name of names) {
    for (const file of (await filesUnder(join(sourceDir, name))).filter(isShipped)) {
      const target = `${PROJECT_SKILLS_PATH}/${name}/${file}`;
      if (tracked.has(target)) {
        warn(`Grillo did not ship ${target}: the project's repository tracks its own copy, which is left as it is.`);
        continue;
      }
      const destination = join(folder, target);
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(join(sourceDir, name, file), destination);
    }
  }

  const excludeFile = resolve(folder, (await git(folder, ['rev-parse', '--git-path', 'info/exclude'])).trim());
  await addMissingLines(
    excludeFile,
    names.map((name) => `/${prefix}${PROJECT_SKILLS_PATH}/${name}/`),
  );
}
