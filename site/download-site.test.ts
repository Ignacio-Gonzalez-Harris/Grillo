import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Window } from 'happy-dom';
import { parse } from 'yaml';
import { describe, expect, it, vi } from 'vitest';
import { findLiteralValues } from '../src/renderer/theme/token-lint';
import { ReleaseDataError, readLatestRelease, showRelease, start } from './latest-release.js';

const SITE_FOLDER = __dirname;
const PAGE = readFileSync(join(SITE_FOLDER, 'index.html'), 'utf8');

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
  it('before a release is read, sends both download buttons to the releases page and shows the unsigned warning', () => {
    const page = loadPage();

    expect(page.document.documentElement.getAttribute('data-repository')).toBe(REPOSITORY);
    expect(page.document.documentElement.getAttribute('data-installers')).toBe('unsigned');
    expect(downloadLink(page, 'windows')).toBe(RELEASES_PAGE);
    expect(downloadLink(page, 'mac')).toBe(RELEASES_PAGE);
    expect(page.document.querySelector('a[data-all-releases]')?.getAttribute('href')).toBe(
      `https://github.com/${REPOSITORY}/releases`,
    );
    expect(isShown(page, '[data-warning="unsigned"]')).toBe(true);
    expect(isShown(page, '.unsigned-only')).toBe(true);
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
    expect(isShown(page, '[data-warning="unsigned"]')).toBe(true);
  });

  it('for a signed release, hides the warning note and the warning steps and says the installers are signed', () => {
    const page = loadPage('signed');

    showRelease(documentOf(page), readLatestRelease(sampleRelease(), REPOSITORY));

    expect(releaseLine(page)).toBe('Latest release: version 1.0.0 · 2026-10-22 · signed for Windows and Mac');
    expect(isShown(page, '[data-warning="unsigned"]')).toBe(false);
    expect(isShown(page, '.unsigned-only')).toBe(false);
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
    const prototype = readFileSync(join(SITE_FOLDER, '..', 'docs', 'ux', 'prototypes', 'grillo', 'tokens.css'), 'utf8');

    expect(readFileSync(join(SITE_FOLDER, 'tokens.css'), 'utf8')).toBe(prototype);
  });
});
