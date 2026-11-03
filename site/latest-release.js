// @ts-check
/**
 * The download site's one script: it puts the visitor's own system's download button first, asks GitHub for the latest
 * release and points the download buttons straight at its installers. Without it (no JavaScript, no network, no
 * release yet) both buttons keep their static link to the releases page, so the page always works.
 *
 * The repository comes from the page's `data-repository` attribute and the signing state from `data-installers`
 * (`unsigned` in the pilot, `signed` once the signing story lands); the stylesheet shows or hides the warning steps.
 */

/** The one error a malformed answer from GitHub becomes; the page catches it and keeps its static links. */
export class ReleaseDataError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'ReleaseDataError';
  }
}

/** @typedef {{ name: string, url: string }} Installer */
/** @typedef {{ version: string, date: string, windows: Installer | null, mac: Installer | null }} LatestRelease */
/** @typedef {(url: string) => Promise<{ ok: boolean, json: () => Promise<unknown> }>} FetchLatest */
/** @typedef {'windows' | 'mac'} System */
/** @typedef {{ userAgentData?: { platform?: string }, platform?: string, userAgent?: string }} NavigatorLike */

/** The class that fills a download button as the visitor's own system's. */
const OWN_SYSTEM = 'dl-btn-own';
/** Phones and tablets: neither installer runs there, so no button is put first. */
const PHONE_OR_TABLET = /iphone|ipad|ipod|android/i;

/** The file ending of the installer each system downloads. */
const INSTALLER_ENDINGS = { windows: '.exe', mac: '.dmg' };
const PUBLISH_DATE = /^(\d{4}-\d{2}-\d{2})T/;
/** A file name GitHub accepts for a release asset: letters, digits, dot, dash and underscore. */
const ASSET_NAME = /^[\w.-]+$/;

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The first asset whose name ends with `ending` and whose link is that very file under the repository's release
 * downloads; any other asset is skipped.
 * @param {unknown[]} assets
 * @param {string} repository
 * @param {string} ending
 * @returns {Installer | null}
 */
function installerEndingWith(assets, repository, ending) {
  const downloads = `https://github.com/${repository}/releases/download/`;
  for (const asset of assets) {
    if (!isRecord(asset)) continue;
    const { name, browser_download_url: url } = asset;
    if (typeof name !== 'string' || typeof url !== 'string') continue;
    if (!ASSET_NAME.test(name) || !name.endsWith(ending) || !url.startsWith(downloads)) continue;
    const tagAndFile = url.slice(downloads.length).split('/');
    if (tagAndFile.length !== 2 || tagAndFile[0] === '..' || tagAndFile[1] !== name) continue;
    return { name, url };
  }
  return null;
}

/**
 * Reads GitHub's answer for the latest release (`GET /repos/{owner}/{repo}/releases/latest`).
 * @param {unknown} answer the parsed JSON body
 * @param {string} repository `owner/repo`
 * @returns {LatestRelease}
 * @throws {ReleaseDataError} when the answer is not a release
 */
export function readLatestRelease(answer, repository) {
  if (!isRecord(answer)) throw new ReleaseDataError('The latest release is not an object.');
  const { tag_name: tag, published_at: publishedAt, assets } = answer;
  if (typeof tag !== 'string') throw new ReleaseDataError('The latest release has no tag.');
  const version = tag.replace(/^v/, '');
  if (version === '') throw new ReleaseDataError('The latest release has an empty tag.');
  const date = typeof publishedAt === 'string' ? PUBLISH_DATE.exec(publishedAt)?.[1] : undefined;
  if (date === undefined) throw new ReleaseDataError('The latest release has no publish date.');
  if (!Array.isArray(assets)) throw new ReleaseDataError('The latest release has no list of assets.');
  return {
    version,
    date,
    windows: installerEndingWith(assets, repository, INSTALLER_ENDINGS.windows),
    mac: installerEndingWith(assets, repository, INSTALLER_ENDINGS.mac),
  };
}

/**
 * Points the download buttons at the release's installers and names them on the page. A system the release has no
 * installer for keeps its link to the releases page.
 * @param {Document} document
 * @param {LatestRelease} release
 */
export function showRelease(document, release) {
  const signed = document.documentElement.dataset.installers === 'signed';
  const files = [];
  for (const system of /** @type {const} */ (['windows', 'mac'])) {
    const installer = release[system];
    if (!installer) continue;
    files.push(installer.name);
    document.querySelector(`a[data-download="${system}"]`)?.setAttribute('href', installer.url);
    for (const name of document.querySelectorAll(`[data-file="${system}"]`)) name.textContent = installer.name;
  }
  const details = signed ? ['signed for Windows and Mac'] : files;
  const line = document.querySelector('[data-release-line]');
  if (line) line.textContent = ['Latest release: version ' + release.version, release.date, ...details].join(' · ');
  const pilotBadge = document.querySelector('[data-release-badge="unsigned"]');
  if (pilotBadge) pilotBadge.textContent = `Pilot release · version ${release.version}`;
  const signedBadge = document.querySelector('[data-release-badge="signed"]');
  if (signedBadge) signedBadge.textContent = `Version ${release.version} · signed for Windows and Mac`;
}

/**
 * The visitor's system, from what the browser says about itself; `null` when it is neither Windows nor a Mac.
 * @param {NavigatorLike} navigator
 * @returns {System | null}
 */
export function detectSystem(navigator) {
  const described = [navigator.userAgentData?.platform, navigator.platform, navigator.userAgent].join(' ');
  if (PHONE_OR_TABLET.test(described)) return null;
  if (/mac/i.test(described)) return 'mac';
  if (/win/i.test(described)) return 'windows';
  return null;
}

/**
 * Puts the visitor's own system's download button first and fills only it. With no system known, both buttons stay
 * as the page has them: both filled, Windows first.
 * @param {Document} document
 * @param {System | null} system
 */
export function showOwnSystemFirst(document, system) {
  if (!system) return;
  const own = document.querySelector(`a[data-download="${system}"]`);
  const row = own?.parentElement;
  if (!own || !row) return;
  for (const button of row.querySelectorAll('a[data-download]')) button.classList.toggle(OWN_SYSTEM, button === own);
  row.prepend(own);
}

/**
 * Asks GitHub for the latest release of the page's repository and shows it; on any failure the page stays as it is.
 * @param {Document} document
 * @param {FetchLatest} fetchLatest
 */
export async function start(document, fetchLatest) {
  const repository = document.documentElement.dataset.repository;
  if (!repository) return;
  try {
    const response = await fetchLatest(`https://api.github.com/repos/${repository}/releases/latest`);
    if (!response.ok) return;
    showRelease(document, readLatestRelease(await response.json(), repository));
  } catch {
    // No network, no release yet or a malformed answer: the static links to the releases page stay.
  }
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  showOwnSystemFirst(document, detectSystem(window.navigator));
  start(document, (url) => window.fetch(url));
}
