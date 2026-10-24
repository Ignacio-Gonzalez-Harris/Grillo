// What the app window may show. The preload exposes `window.grillo` (every IPC channel) to whatever page the
// window holds, so the window must only ever hold the app's own page. Fails closed: a URL that cannot be
// parsed is never the app's page and is never opened.

const WEB_PROTOCOLS = new Set(['http:', 'https:']);

function parse(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/**
 * True when `url` is the app's own page: same origin as the dev server in development, or the very same
 * file as the packaged `index.html`.
 */
export function isAppPage(url: string, appUrl: string): boolean {
  const target = parse(url);
  const app = parse(appUrl);
  if (!target || !app || target.protocol !== app.protocol) {
    return false;
  }
  if (app.protocol === 'file:') {
    return target.pathname === app.pathname;
  }
  return WEB_PROTOCOLS.has(app.protocol) && target.origin === app.origin;
}

/** The link to hand to the system browser, or null when it is not an http(s) link. */
export function webUrlToOpenOutside(url: string): string | null {
  const target = parse(url);
  return target && WEB_PROTOCOLS.has(target.protocol) ? url : null;
}
