import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Window } from 'happy-dom';
import { parse } from 'yaml';
import { describe, expect, it, vi } from 'vitest';
import { findLiteralValues } from '../src/renderer/theme/token-lint';
import {
  ReleaseDataError,
  detectSystem,
  readLatestRelease,
  showOwnSystemFirst,
  showRelease,
  start,
} from './latest-release.js';

const SITE_FOLDER = __dirname;
const PAGE = readFileSync(join(SITE_FOLDER, 'index.html'), 'utf8');
const PROTOTYPE_FOLDER = join(SITE_FOLDER, '..', 'docs', 'ux', 'prototypes', 'grillo');

/** The repository the installers are published to, as electron-builder.yml names it. */
function publishedRepository(): string {
  const builder = parse(readFileSync(join(SITE_FOLDER, '..', 'electron-builder.yml'), 'utf8')) as {
    publish: { owner: string; repo: string };
  };
  return `${builder.publish.owner}/${builder.publish.repo}`;
}

const REPOSITORY = publishedRepository();
const RELEASES_PAGE = `https://github.com/${REPOSITORY}/releases/latest`;
const DOWNLOADS = `https://github.com/${REPOSITORY}/releases/download/v1.0.0`;

/** A made-up GitHub "latest release" answer, shaped like the REST API's. */
function sampleRelease() {
  return {
    tag_name: 'v1.0.0',
    published_at: '2026-10-22T09:30:00Z',
    assets: [
      { name: 'latest.yml', browser_download_url: `${DOWNLOADS}/latest.yml` },
      { name: 'Grillo-Setup-1.0.0.exe.blockmap', browser_download_url: `${DOWNLOADS}/Grillo-Setup-1.0.0.exe.blockmap` },
      { name: 'Grillo-Setup-1.0.0.exe', browser_download_url: `${DOWNLOADS}/Grillo-Setup-1.0.0.exe` },
      { name: 'Grillo-1.0.0-universal-mac.zip', browser_download_url: `${DOWNLOADS}/Grillo-1.0.0-universal-mac.zip` },
      { name: 'Grillo-1.0.0-universal.dmg', browser_download_url: `${DOWNLOADS}/Grillo-1.0.0-universal.dmg` },
    ],
  };
}

/** The site page loaded into a browser-like window, optionally marked as a signed or an unsigned release. */
function loadPage(installers?: 'signed' | 'unsigned'): Window {
  const window = new Window({
    url: 'https://example-owner.github.io/grillo/',
    settings: { disableCSSFileLoading: true, disableJavaScriptFileLoading: true },
  });
  window.document.write(PAGE);
  if (installers) window.document.documentElement.setAttribute('data-installers', installers);
  return window;
}

/** The page's document, typed as the DOM document the site script works on. */
function documentOf(window: Window): Document {
  return window.document as unknown as Document;
}

function downloadLink(window: Window, system: 'windows' | 'mac'): string {
  return window.document.querySelector(`a[data-download="${system}"]`)?.getAttribute('href') ?? '';
}

function isShown(window: Window, selector: string): boolean {
  const elements = [...window.document.querySelectorAll(selector)];
  if (elements.length === 0) throw new Error(`no element matches ${selector}`);
  const shown = elements.map((element) => window.getComputedStyle(element).display !== 'none');
  if (new Set(shown).size > 1) throw new Error(`some elements matching ${selector} are shown, others hidden`);
  return shown[0];
}

function releaseLine(window: Window): string {
  return window.document.querySelector('[data-release-line]')?.textContent ?? '';
}

function releaseBadge(window: Window, installers: 'signed' | 'unsigned'): string {
  return window.document.querySelector(`[data-release-badge="${installers}"]`)?.textContent ?? '';
}

function texts(window: Window, selector: string): string[] {
  return [...window.document.querySelectorAll(selector)].map((element) => element.textContent?.replace(/\s+/g, ' ').trim() ?? '');
}

/** The download buttons in page order: which system each is for, and whether it is filled as the visitor's own. */
function downloadButtons(window: Window): { system: string | null; own: boolean }[] {
  return [...window.document.querySelectorAll('a[data-download]')].map((button) => ({
    system: button.getAttribute('data-download'),
    own: button.classList.contains('dl-btn-own'),
  }));
}

/** The page's own style blocks, as written. */
function pageCss(): string {
  return [...PAGE.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((match) => match[1]).join('\n');
}

/** Removes every `@media (prefers-reduced-motion: no-preference) { ... }` block, braces matched. */
function withoutMotionAllowedBlocks(css: string): string {
  const opening = /@media\s*\(\s*prefers-reduced-motion\s*:\s*no-preference\s*\)\s*\{/g;
  let rest = css;
  for (let match = opening.exec(rest); match; match = opening.exec(rest)) {
    let depth = 1;
    let end = match.index + match[0].length;
    while (depth > 0 && end < rest.length) {
      if (rest[end] === '{') depth += 1;
      if (rest[end] === '}') depth -= 1;
      end += 1;
    }
    rest = rest.slice(0, match.index) + rest.slice(end);
    opening.lastIndex = match.index;
  }
  return rest;
}

const MOTION_PROPERTY = /(?:^|[{;\s])(?:animation|transition)(?:-[a-z-]+)?\s*:/;

/** Every file the page loads from beside itself: relative `src` and `href` values (no links, anchors or data). */
function localFilesThePageLoads(): string[] {
  const references = [...PAGE.matchAll(/\s(?:src|href)="([^"]+)"/g)].map((match) => match[1]);
  return [...new Set(references.filter((reference) => !/^(?:[a-z]+:|#|\/\/)/i.test(reference)))];
}

describe('reading the latest release from GitHub', () => {
  it('finds the Windows installer and the universal Mac disk image (never its update zip), the version and the day it was published', () => {
    expect(readLatestRelease(sampleRelease(), REPOSITORY)).toEqual({
      version: '1.0.0',
      date: '2026-10-22',
      windows: { name: 'Grillo-Setup-1.0.0.exe', url: `${DOWNLOADS}/Grillo-Setup-1.0.0.exe` },
      mac: { name: 'Grillo-1.0.0-universal.dmg', url: `${DOWNLOADS}/Grillo-1.0.0-universal.dmg` },
    });
  });

  it.each([
    ['nothing', null],
    ['a string', 'Not Found'],
    ['a list', [sampleRelease()]],
    ['an error message', { message: 'Not Found' }],
    ['a release without a tag', { ...sampleRelease(), tag_name: null }],
    ['a release whose tag is a number', { ...sampleRelease(), tag_name: 42 }],
    ['a release with an empty tag', { ...sampleRelease(), tag_name: 'v' }],
    ['a release with no publish date', { ...sampleRelease(), published_at: null }],
    ['a release with a date that is not a date', { ...sampleRelease(), published_at: 'yesterday' }],
    ['a release whose assets are missing', { ...sampleRelease(), assets: null }],
    ['a release whose assets are not a list', { ...sampleRelease(), assets: { name: 'Grillo-1.0.0-universal.dmg' } }],
  ])('rejects %s with a release data error', (_case, answer) => {
    expect(() => readLatestRelease(answer, REPOSITORY)).toThrow(ReleaseDataError);
  });

  it('skips assets that are empty, unnamed, or link anywhere but this repository’s release downloads', () => {
    const elsewhere = 'https://github.com/someone-else/Grillo/releases/download/v1.0.0/Grillo-Setup-1.0.0.exe';
    const release = {
      ...sampleRelease(),
      assets: [
        null,
        'Grillo-Setup-1.0.0.exe',
        { name: null, browser_download_url: `${DOWNLOADS}/Grillo-Setup-1.0.0.exe` },
        { name: 'Grillo-Setup-1.0.0.exe', browser_download_url: null },
        { name: 'Grillo-Setup-1.0.0.exe', browser_download_url: 'javascript:alert(1)' },
        { name: 'Grillo-Setup-1.0.0.exe', browser_download_url: elsewhere },
        { name: 'Grillo-Setup-1.0.0.exe', browser_download_url: `https://github.com/${REPOSITORY}/../x/Grillo-Setup-1.0.0.exe` },
        { name: 'Grillo-1.0.0-universal.dmg', browser_download_url: `http://github.com/${REPOSITORY}/releases/download/v1.0.0/Grillo-1.0.0-universal.dmg` },
        { name: 'Grillo-1.0.0-universal.dmg', browser_download_url: `${DOWNLOADS}/Grillo-1.0.0-universal.dmg` },
        { name: 'Grillo-1.0.0-universal.dmg', browser_download_url: `${DOWNLOADS}/Grillo-1.0.0-universal.dmg` },
      ],
    };

    expect(readLatestRelease(release, REPOSITORY)).toMatchObject({
      windows: null,
      mac: { name: 'Grillo-1.0.0-universal.dmg', url: `${DOWNLOADS}/Grillo-1.0.0-universal.dmg` },
    });
  });
});

describe('the download page', () => {
  it('before a release is read, sends both download buttons to the releases page and shows the unsigned install steps', () => {
    const page = loadPage();

    expect(page.document.documentElement.getAttribute('data-repository')).toBe(REPOSITORY);
    expect(page.document.documentElement.getAttribute('data-installers')).toBe('unsigned');
    expect(downloadLink(page, 'windows')).toBe(RELEASES_PAGE);
    expect(downloadLink(page, 'mac')).toBe(RELEASES_PAGE);
    expect(page.document.querySelector('a[data-all-releases]')?.getAttribute('href')).toBe(
      `https://github.com/${REPOSITORY}/releases`,
    );
    expect(page.document.querySelector('[data-warning="unsigned"]')).toBeNull();
    expect(isShown(page, '.unsigned-only')).toBe(true);
    expect(isShown(page, '.signed-only')).toBe(false);
    expect(releaseBadge(page, 'unsigned')).toBe('Pilot release');
  });

  it('shows every part of the redesigned landing page: hero, app illustration, features, flow, install and footer', () => {
    const page = loadPage();

    expect(page.document.querySelector('.dl-hero img[src="grillo-logo.png"]')).not.toBeNull();
    expect(texts(page, '.dl-hero h1')).toEqual(['Grillo']);
    expect(texts(page, '.dl-pitch')).toHaveLength(1);
    expect(page.document.querySelectorAll('.dl-downloads a[data-download]')).toHaveLength(2);
    expect(page.document.querySelector('.dl-release [data-release-line]')).not.toBeNull();
    expect(page.document.querySelector('.dl-release a[data-all-releases]')).not.toBeNull();
    expect(page.document.querySelector('.dl-hero [data-app-mock]')).not.toBeNull();
    expect(page.document.querySelectorAll('.dl-glow span')).toHaveLength(5);
    expect(texts(page, '.dl-features .dl-feature h3')).toEqual([
      'Only your questions',
      'Recorded on your laptop',
      'Every line has a source',
    ]);
    expect(texts(page, '.dl-flow > li h3')).toEqual([
      'Create a project',
      'Give the idea',
      'Tag the questions',
      'Answer together',
      'Get the PRD',
    ]);
    for (const step of page.document.querySelectorAll('.dl-flow > li')) expect(step.querySelector('svg')).not.toBeNull();
    expect(page.document.querySelectorAll('.dl-need li')).toHaveLength(3);
    expect(page.document.querySelector('[data-warning="unsigned"]')).toBeNull();
    expect(page.document.querySelector('[data-install="windows"] [data-file="windows"]')).not.toBeNull();
    expect(page.document.querySelector('[data-install="mac"] [data-file="mac"]')).not.toBeNull();
    expect(page.document.querySelector('.dl-footer a')?.getAttribute('href')).toBe(`https://github.com/${REPOSITORY}/releases`);
    expect(page.document.querySelector('.dl-footer')?.textContent).toContain('By Ignacio Gonzalez');
  });

  it('in the pilot, links the latest installers and names them in the release line and the install steps', () => {
    const page = loadPage('unsigned');

    showRelease(documentOf(page), readLatestRelease(sampleRelease(), REPOSITORY));

    expect(downloadLink(page, 'windows')).toBe(`${DOWNLOADS}/Grillo-Setup-1.0.0.exe`);
    expect(downloadLink(page, 'mac')).toBe(`${DOWNLOADS}/Grillo-1.0.0-universal.dmg`);
    expect(releaseLine(page)).toBe(
      'Latest release: version 1.0.0 · 2026-10-22 · Grillo-Setup-1.0.0.exe · Grillo-1.0.0-universal.dmg',
    );
    expect(page.document.querySelector('[data-file="windows"]')?.textContent).toBe('Grillo-Setup-1.0.0.exe');
    expect(page.document.querySelector('[data-file="mac"]')?.textContent).toBe('Grillo-1.0.0-universal.dmg');
    expect(texts(page, '[data-file]')).toEqual([
      'Grillo-Setup-1.0.0.exe',
      'Grillo-1.0.0-universal.dmg',
      'Grillo-Setup-1.0.0.exe',
      'Grillo-1.0.0-universal.dmg',
    ]);
    expect(releaseBadge(page, 'unsigned')).toBe('Pilot release · version 1.0.0');
    expect(page.document.querySelector('[data-warning="unsigned"]')).toBeNull();
  });

  it('for a signed release, hides the warning steps and says the installers are signed', () => {
    const page = loadPage('signed');

    showRelease(documentOf(page), readLatestRelease(sampleRelease(), REPOSITORY));

    expect(releaseLine(page)).toBe('Latest release: version 1.0.0 · 2026-10-22 · signed for Windows and Mac');
    expect(page.document.querySelector('[data-warning="unsigned"]')).toBeNull();
    expect(isShown(page, '.unsigned-only')).toBe(false);
    expect(isShown(page, '.signed-only')).toBe(true);
    expect(releaseBadge(page, 'signed')).toBe('Version 1.0.0 · signed for Windows and Mac');
  });

  it('before a signed release is read, says the installers are signed without naming a version', () => {
    const page = loadPage('signed');

    expect(isShown(page, '.signed-only')).toBe(true);
    expect(releaseBadge(page, 'signed')).toBe('Signed for Windows and Mac');
  });

  it('keeps the releases page link for a system the release has no installer for', () => {
    const page = loadPage('unsigned');
    const release = readLatestRelease({ ...sampleRelease(), assets: sampleRelease().assets.slice(0, 3) }, REPOSITORY);

    showRelease(documentOf(page), release);

    expect(downloadLink(page, 'windows')).toBe(`${DOWNLOADS}/Grillo-Setup-1.0.0.exe`);
    expect(downloadLink(page, 'mac')).toBe(RELEASES_PAGE);
    expect(releaseLine(page)).toBe('Latest release: version 1.0.0 · 2026-10-22 · Grillo-Setup-1.0.0.exe');
  });
});

describe('the visitor’s own system first', () => {
  it.each([
    ['Windows', { userAgentData: { platform: 'Windows' }, platform: 'Win32', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }, 'windows'],
    ['Windows without client hints', { platform: 'Win32', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }, 'windows'],
    ['a Mac', { userAgentData: { platform: 'macOS' }, platform: 'MacIntel', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' }, 'mac'],
    ['a Mac without client hints', { platform: 'MacIntel', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' }, 'mac'],
    ['Linux', { userAgentData: { platform: 'Linux' }, platform: 'Linux x86_64', userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' }, null],
    ['an iPhone', { platform: 'iPhone', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' }, null],
    ['an Android phone', { platform: 'Linux armv8l', userAgent: 'Mozilla/5.0 (Linux; Android 14)' }, null],
    ['a browser that says nothing', {}, null],
  ])('tells %s apart', (_case, navigator, system) => {
    expect(detectSystem(navigator)).toBe(system);
  });

  it.each([
    ['a Windows visitor, puts Download for Windows first and fills only it', 'windows', [{ system: 'windows', own: true }, { system: 'mac', own: false }]],
    ['a Mac visitor, puts Download for Mac first and fills only it', 'mac', [{ system: 'mac', own: true }, { system: 'windows', own: false }]],
    ['an unknown system, keeps both buttons filled, Windows first', null, [{ system: 'windows', own: true }, { system: 'mac', own: true }]],
  ] as const)('for %s', (_case, system, buttons) => {
    const page = loadPage('unsigned');

    showOwnSystemFirst(documentOf(page), system);

    expect(downloadButtons(page)).toEqual(buttons);
  });
});

describe('starting the page', () => {
  it('asks GitHub for the repository’s latest release and shows it', async () => {
    const page = loadPage('unsigned');
    const fetchLatest = vi.fn(async (_url: string) => ({ ok: true, json: async () => sampleRelease() }));

    await start(documentOf(page), fetchLatest);

    expect(fetchLatest).toHaveBeenCalledWith(`https://api.github.com/repos/${REPOSITORY}/releases/latest`);
    expect(downloadLink(page, 'windows')).toBe(`${DOWNLOADS}/Grillo-Setup-1.0.0.exe`);
  });

  it.each([
    ['the network fails', async () => Promise.reject(new TypeError('Failed to fetch'))],
    ['there is no release yet', async () => ({ ok: false, json: async () => ({ message: 'Not Found' }) })],
    ['the answer is not JSON', async () => ({ ok: true, json: async () => Promise.reject(new SyntaxError('bad')) })],
    ['the answer is not a release', async () => ({ ok: true, json: async () => ({ tag_name: 42 }) })],
  ])('leaves the releases page links in place when %s', async (_case, fetchLatest) => {
    const page = loadPage('unsigned');
    const before = page.document.body.innerHTML;

    await start(documentOf(page), fetchLatest);

    expect(page.document.body.innerHTML).toBe(before);
  });
});

describe('the site’s design tokens', () => {
  it('uses no colour or spacing value outside tokens.css', () => {
    expect(findLiteralValues(PAGE, 'index.html')).toEqual([]);
  });

  it('keeps site/tokens.css an exact copy of the UX prototype token file', () => {
    const prototype = readFileSync(join(PROTOTYPE_FOLDER, 'tokens.css'), 'utf8');

    expect(readFileSync(join(SITE_FOLDER, 'tokens.css'), 'utf8')).toBe(prototype);
  });

  it('moves only when the visitor’s system allows motion', () => {
    const css = pageCss();

    expect(css).toMatch(/@keyframes/);
    expect(withoutMotionAllowedBlocks(css)).not.toMatch(MOTION_PROPERTY);
  });
});

describe('the site’s files', () => {
  it('serves the logo as an exact copy of the UX prototype’s', () => {
    expect(readFileSync(join(SITE_FOLDER, 'grillo-logo.png'))).toEqual(readFileSync(join(PROTOTYPE_FOLDER, 'grillo-logo.png')));
  });

  it('has every file the page loads beside it', () => {
    const files = localFilesThePageLoads();

    expect(files).toEqual(expect.arrayContaining(['tokens.css', 'latest-release.js', 'grillo-logo.png']));
    for (const file of files) expect(() => readFileSync(join(SITE_FOLDER, file))).not.toThrow();
  });
});
