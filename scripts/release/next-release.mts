// Decides whether a merge to main publishes a new version, and which one (issue 213, PRD section 8, CI and
// Distribution). The auto-release workflow runs it on the commit CI just passed:
//
//   node scripts/release/next-release.mts <commit>
//
// It reads the latest published release with `gh`, lists the files changed since that release's tag with `git`, and
// prints its answer. On GitHub it also writes `release`, `version` and `tag` to $GITHUB_OUTPUT. It only reads: it
// never creates a release, a tag or a commit, so running it by hand is a safe dry run.
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** The folders and files that make up the installed app. A change anywhere else publishes nothing. */
const APP_FOLDERS = ['src/', 'resources/', 'build/'];
const APP_FILES = ['package.json', 'package-lock.json', 'electron-builder.yml', 'electron.vite.config.mts', '.nvmrc'];

const TAG_PREFIX = 'v';
const PLAIN_VERSION = /^(\d+)\.(\d+)\.(\d+)$/;

export type ReleaseDecision =
  | { release: true; version: string; tag: string; reason: string }
  | { release: false; reason: string };

interface ReleaseFacts {
  /** Tag of the latest published release, or null when nothing has been released yet. */
  latestTag: string | null;
  /** The version package.json names on the commit CI passed. */
  packageVersion: string;
  /** Files changed since the latest release's tag; null when there is no release to compare with. */
  changedFiles: string[] | null;
}

function parseVersion(version: string): [number, number, number] {
  const match = PLAIN_VERSION.exec(version);
  if (!match) throw new Error(`'${version}' is not a version (three numbers, such as 0.1.0)`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * The version to publish: the latest release's last number raised by one, unless package.json names a higher major
 * or minor (a person raised it in a pull request), which is then used as it is. With no release yet, package.json's.
 */
export function nextVersion(latestReleased: string | null, packageVersion: string): string {
  const [packageMajor, packageMinor] = parseVersion(packageVersion);
  if (latestReleased === null) return packageVersion;
  const [major, minor, patch] = parseVersion(latestReleased);
  const packageIsAhead = packageMajor > major || (packageMajor === major && packageMinor > minor);
  return packageIsAhead ? packageVersion : `${major}.${minor}.${patch + 1}`;
}

export function isAppFile(file: string): boolean {
  return APP_FILES.includes(file) || APP_FOLDERS.some((folder) => file.startsWith(folder));
}

function versionOfTag(tag: string): string {
  if (!tag.startsWith(TAG_PREFIX)) throw new Error(`'${tag}' is not a version tag (such as v0.1.0)`);
  return tag.slice(TAG_PREFIX.length);
}

export function decideRelease({ latestTag, packageVersion, changedFiles }: ReleaseFacts): ReleaseDecision {
  const latestVersion = latestTag === null ? null : versionOfTag(latestTag);
  const version = nextVersion(latestVersion, packageVersion);
  const release = { release: true as const, version, tag: `${TAG_PREFIX}${version}` };
  if (latestTag === null || changedFiles === null) return { ...release, reason: 'no version has been released yet' };
  if (!changedFiles.some(isAppFile)) return { release: false, reason: `no app change since ${latestTag}` };
  return { ...release, reason: `the app changed since ${latestTag}` };
}

/** The decision as the `name=value` lines GitHub Actions reads from $GITHUB_OUTPUT. */
export function workflowOutputs(decision: ReleaseDecision): string {
  const lines = [`release=${decision.release}`];
  if (decision.release) lines.push(`version=${decision.version}`, `tag=${decision.tag}`);
  return lines.map((line) => `${line}\n`).join('');
}

function run(command: string, args: string[]): string {
  return execFileSync(command, args, { encoding: 'utf8' }).trim();
}

/** The release GitHub marks as latest; drafts and pre-releases never count. */
function latestReleaseTag(): string | null {
  const tag = run('gh', [
    'release',
    'list',
    '--exclude-drafts',
    '--exclude-pre-releases',
    '--json',
    'tagName,isLatest',
    '--jq',
    '.[] | select(.isLatest) | .tagName',
  ]);
  return tag === '' ? null : tag;
}

/**
 * Files changed on the commit's side since it and the tag parted. The three dots mean a commit already inside the
 * release (CI on an older commit finishing after a newer one was released) shows no change and publishes nothing.
 */
function filesChangedSince(tag: string, commit: string): string[] {
  const output = run('git', ['diff', '--name-only', `${tag}...${commit}`]);
  return output === '' ? [] : output.split('\n');
}

function packageVersionAt(commit: string): string {
  return (JSON.parse(run('git', ['show', `${commit}:package.json`])) as { version: string }).version;
}

function main(commit: string | undefined): void {
  if (!commit) throw new Error('Usage: node scripts/release/next-release.mts <commit>');
  const latestTag = latestReleaseTag();
  const decision = decideRelease({
    latestTag,
    packageVersion: packageVersionAt(commit),
    changedFiles: latestTag === null ? null : filesChangedSince(latestTag, commit),
  });
  console.log(decision.release ? `Release ${decision.tag}: ${decision.reason}.` : `No release: ${decision.reason}.`);
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) appendFileSync(outputFile, workflowOutputs(decision));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv[2]);
}
