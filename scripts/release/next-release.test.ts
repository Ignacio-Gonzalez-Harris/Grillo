import { describe, expect, it } from 'vitest';
import { decideRelease, isAppFile, nextVersion, workflowOutputs } from './next-release.mjs';

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
