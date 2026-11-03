import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decideRelease, filesChangedSince, isAppFile, nextVersion, workflowOutputs } from './next-release.mjs';

describe('next version', () => {
  it.each([
    { latest: '0.1.0', packageVersion: '0.1.0', next: '0.1.1' },
    { latest: '0.1.9', packageVersion: '0.1.0', next: '0.1.10' },
    { latest: '0.1.4', packageVersion: '0.2.0', next: '0.2.0' },
    { latest: '0.9.2', packageVersion: '1.0.0', next: '1.0.0' },
    { latest: '0.2.0', packageVersion: '0.2.0', next: '0.2.1' },
    { latest: '0.1.4', packageVersion: '0.1.7', next: '0.1.5' },
  ])('after release $latest with package.json at $packageVersion, is $next', ({ latest, packageVersion, next }) => {
    expect(nextVersion(latest, packageVersion)).toBe(next);
  });

  it('is the package.json version when nothing has been released yet', () => {
    expect(nextVersion(null, '0.1.0')).toBe('0.1.0');
  });

  it.each(['1.0', 'v1.0.0', '1.0.0-beta.1', ''])('refuses a version that is not three numbers (%s)', (version) => {
    expect(() => nextVersion(version, '0.1.0')).toThrow('is not a version');
    expect(() => nextVersion('0.1.0', version)).toThrow('is not a version');
  });
});

describe('what counts as the app', () => {
  it.each([
    'src/main/index.ts',
    'resources/skills/grillo-wayfinder/SKILL.md',
    'build/icon.png',
    'package.json',
    'package-lock.json',
    'electron-builder.yml',
    'electron.vite.config.mts',
    '.nvmrc',
  ])('%s is the app', (file) => {
    expect(isAppFile(file)).toBe(true);
  });

  it.each([
    'docs/runbook.md',
    '.claude/skills/dev-next/SKILL.md',
    'site/index.html',
    '.github/workflows/ci.yml',
    'docs/ux/prototypes/index.html',
    'CLAUDE.md',
    'scripts/release/next-release.mts',
    'test/installer-config.test.ts',
    'srcs/file.ts',
    'electron.vite.config.test.ts',
  ])('%s is not the app', (file) => {
    expect(isAppFile(file)).toBe(false);
  });
});

describe('release decision', () => {
  it('releases the next version when a file of the app changed since the latest release', () => {
    expect(
      decideRelease({
        latestTag: 'v0.1.0',
        packageVersion: '0.1.0',
        changedFiles: ['docs/runbook.md', 'src/main/index.ts'],
      }),
    ).toEqual({ release: true, version: '0.1.1', tag: 'v0.1.1', reason: 'the app changed since v0.1.0' });
  });

  it('releases when only package.json changed (a person raised the version)', () => {
    expect(
      decideRelease({ latestTag: 'v0.1.4', packageVersion: '0.2.0', changedFiles: ['package.json'] }),
    ).toMatchObject({ release: true, version: '0.2.0', tag: 'v0.2.0' });
  });

  it.each([
    [['docs/PRDs/PRD.md']],
    [['.claude/orion/BASE_CLAUDE.md']],
    [['site/index.html', 'site/grillo-logo.png']],
    [['.github/workflows/release.yml']],
    [[]],
  ])('publishes nothing when only files outside the app changed (%j)', (changedFiles) => {
    expect(decideRelease({ latestTag: 'v0.1.0', packageVersion: '0.1.0', changedFiles })).toEqual({
      release: false,
      reason: 'no app change since v0.1.0',
    });
  });

  it('releases the package.json version when nothing has been released yet', () => {
    expect(decideRelease({ latestTag: null, packageVersion: '0.1.0', changedFiles: null })).toEqual({
      release: true,
      version: '0.1.0',
      tag: 'v0.1.0',
      reason: 'no version has been released yet',
    });
  });

  it('refuses a latest release tag that does not start with v', () => {
    expect(() => decideRelease({ latestTag: '0.1.0', packageVersion: '0.1.0', changedFiles: ['src/a.ts'] })).toThrow(
      'is not a version tag',
    );
  });
});

describe('workflow outputs', () => {
  it('hands the workflow the decision, the version and the tag as name=value lines', () => {
    expect(
      workflowOutputs({ release: true, version: '0.1.1', tag: 'v0.1.1', reason: 'the app changed since v0.1.0' }),
    ).toBe('release=true\nversion=0.1.1\ntag=v0.1.1\n');
    expect(workflowOutputs({ release: false, reason: 'no app change since v0.1.0' })).toBe('release=false\n');
  });
});

describe('files changed since the latest release, read from a real git repository', () => {
  const RELEASED_APP_FILE = 'resources/skills/README.md';
  let repository: string;

  function git(...args: string[]): string {
    return execFileSync('git', ['-c', 'user.name=Made Up', '-c', 'user.email=made.up@example.com', ...args], {
      cwd: repository,
      encoding: 'utf8',
    }).trim();
  }

  function writeFile(file: string, content: string): void {
    mkdirSync(dirname(join(repository, file)), { recursive: true });
    writeFileSync(join(repository, file), content);
  }

  function commitAll(message: string): void {
    git('add', '.');
    git('commit', '-q', '-m', message);
  }

  beforeEach(() => {
    repository = mkdtempSync(join(tmpdir(), 'grillo-next-release-'));
    git('init', '-q');
    writeFile(RELEASED_APP_FILE, 'A made-up skill folder note that is long enough for git to see a move as a rename.');
    writeFile('docs/runbook.md', 'A made-up run-book');
    commitAll('made-up first release');
    git('tag', 'v0.1.0');
  });

  afterEach(() => {
    rmSync(repository, { recursive: true, force: true });
  });

  it('counts a file moved out of the app as an app change, under both its old and its new name', () => {
    mkdirSync(join(repository, 'docs', 'moved'));
    git('mv', RELEASED_APP_FILE, 'docs/moved/README.md');
    commitAll('made-up move out of the app');

    const changedFiles = filesChangedSince('v0.1.0', 'HEAD', repository);

    expect(changedFiles.sort()).toEqual(['docs/moved/README.md', RELEASED_APP_FILE]);
    expect(decideRelease({ latestTag: 'v0.1.0', packageVersion: '0.1.0', changedFiles }).release).toBe(true);
  });

  it('counts an app file whose name is not plain ASCII, which git would otherwise print quoted', () => {
    writeFile('resources/日本語 note.txt', 'A made-up file');
    commitAll('made-up file with a non-ASCII name');

    const changedFiles = filesChangedSince('v0.1.0', 'HEAD', repository);

    expect(changedFiles).toEqual(['resources/日本語 note.txt']);
    expect(decideRelease({ latestTag: 'v0.1.0', packageVersion: '0.1.0', changedFiles }).release).toBe(true);
  });

  it('lists nothing for a commit already inside the release, and only the docs for a change to the docs', () => {
    const insideTheRelease = git('rev-parse', 'v0.1.0');
    writeFile('docs/runbook.md', 'A changed made-up run-book');
    commitAll('made-up docs change');

    expect(filesChangedSince('v0.1.0', insideTheRelease, repository)).toEqual([]);
    expect(filesChangedSince('v0.1.0', 'HEAD', repository)).toEqual(['docs/runbook.md']);
  });
});
