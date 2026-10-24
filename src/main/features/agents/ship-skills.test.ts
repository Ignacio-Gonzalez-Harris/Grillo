import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { shipSkills } from './ship-skills';

let root: string;
let skills: string;
let project: string;

function writeFile(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

function git(...args: string[]): string {
  return execFileSync('git', ['-c', 'user.name=Ada Example', '-c', 'user.email=ada@example.invalid', ...args], {
    cwd: project,
    encoding: 'utf8',
  });
}

function read(relativePath: string): string {
  return readFileSync(join(project, relativePath), 'utf8');
}

function excludeLines(): string[] {
  return read('.git/info/exclude').split('\n');
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'grillo-ship-skills-'));
  skills = join(root, 'resources', 'skills');
  project = join(root, 'demo-project');
  writeFile(join(skills, 'grillo-wayfinder', 'SKILL.md'), 'wayfinder v2');
  writeFile(join(skills, 'grillo-wayfinder', 'references', 'check.md'), 'contradiction check v2');
  writeFile(join(skills, 'grillo-tagging', 'SKILL.md'), 'tagging v2');
  writeFile(join(skills, 'not-grillo', 'SKILL.md'), 'never shipped');

  mkdirSync(project);
  git('init', '-q');
  writeFile(join(project, 'README.md'), 'A made-up project');
  writeFile(join(project, '.claude', 'skills', 'grillo-tagging', 'SKILL.md'), 'the project tracks its own copy');
  git('add', '.');
  git('commit', '-q', '-m', 'made-up start');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('shipSkills', () => {
  it('copies every grillo-* skill into the project, skips and warns on a file git tracks, and writes no CLAUDE.md', async () => {
    const warnings: string[] = [];

    await shipSkills({ sourceDir: skills, folder: project, warn: (message) => warnings.push(message) });

    expect(read('.claude/skills/grillo-wayfinder/SKILL.md')).toBe('wayfinder v2');
    expect(read('.claude/skills/grillo-wayfinder/references/check.md')).toBe('contradiction check v2');
    expect(read('.claude/skills/grillo-tagging/SKILL.md')).toBe('the project tracks its own copy');
    expect(warnings).toEqual([expect.stringContaining('.claude/skills/grillo-tagging/SKILL.md')]);
    expect(existsSync(join(project, '.claude', 'skills', 'not-grillo'))).toBe(false);
    expect(existsSync(join(project, 'CLAUDE.md'))).toBe(false);
    expect(existsSync(join(project, '.claude', 'CLAUDE.md'))).toBe(false);
  });

  it('keeps the shipped skills out of git through .git/info/exclude, once per skill however often it runs', async () => {
    const warn = () => undefined;

    await shipSkills({ sourceDir: skills, folder: project, warn });
    await shipSkills({ sourceDir: skills, folder: project, warn });

    const lines = excludeLines();
    expect(lines.filter((line) => line === '/.claude/skills/grillo-wayfinder/')).toHaveLength(1);
    expect(lines.filter((line) => line === '/.claude/skills/grillo-tagging/')).toHaveLength(1);
    expect(git('status', '--porcelain')).toBe('');
  });

  it('brings an updated skill into the project on the next launch', async () => {
    const warn = () => undefined;
    await shipSkills({ sourceDir: skills, folder: project, warn });

    writeFile(join(skills, 'grillo-wayfinder', 'SKILL.md'), 'wayfinder v3');
    await shipSkills({ sourceDir: skills, folder: project, warn });

    expect(read('.claude/skills/grillo-wayfinder/SKILL.md')).toBe('wayfinder v3');
  });

  it('does nothing when the app ships no skills yet', async () => {
    const before = read('.git/info/exclude');

    await shipSkills({ sourceDir: join(root, 'no-skills-here'), folder: project, warn: () => undefined });

    expect(read('.git/info/exclude')).toBe(before);
    expect(existsSync(join(project, '.claude', 'skills', 'grillo-wayfinder'))).toBe(false);
  });

  it('fails clearly when the project folder is not a git repository', async () => {
    const plainFolder = join(root, 'plain-folder');
    mkdirSync(plainFolder);

    await expect(shipSkills({ sourceDir: skills, folder: plainFolder, warn: () => undefined })).rejects.toThrow(
      /not a git repository/,
    );
  });
});
