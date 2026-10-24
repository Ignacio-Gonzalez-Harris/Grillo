import { describe, expect, it } from 'vitest';
import { isAppPage, webUrlToOpenOutside } from './navigation';

const DEV_APP = 'http://localhost:5229/';
const PACKAGED_APP = 'file:///C:/Program%20Files/Grillo/resources/app.asar/out/renderer/index.html';

describe('which pages the app window may show', () => {
  it.each([
    ['the dev server page', DEV_APP, DEV_APP],
    ['another path on the dev server', 'http://localhost:5229/index.html?reload=1', DEV_APP],
    ['the packaged page', PACKAGED_APP, PACKAGED_APP],
    ['the packaged page with a hash', `${PACKAGED_APP}#map`, PACKAGED_APP],
  ])('allows %s', (_case, url, appUrl) => {
    expect(isAppPage(url, appUrl)).toBe(true);
  });

  it.each([
    ['an outside https page', 'https://example.com/ticket', DEV_APP],
    ['an outside http page', 'http://example.com/', PACKAGED_APP],
    ['the same host on another port', 'http://localhost:5230/', DEV_APP],
    ['a javascript: URL', 'javascript:alert(1)', DEV_APP],
    ['another local file', 'file:///C:/Users/someone/evil.html', PACKAGED_APP],
    ['a local file while in development', 'file:///C:/Users/someone/evil.html', DEV_APP],
    ['a malformed URL', 'not a url', DEV_APP],
    ['any URL when the app URL itself is malformed', DEV_APP, 'not a url'],
  ])('refuses %s', (_case, url, appUrl) => {
    expect(isAppPage(url, appUrl)).toBe(false);
  });
});

describe('which links open in the system browser', () => {
  it.each(['https://example.com/ticket', 'http://example.com/'])('opens the web link %s outside', (url) => {
    expect(webUrlToOpenOutside(url)).toBe(url);
  });

  it.each(['javascript:alert(1)', 'file:///C:/Windows/system32/calc.exe', 'mailto:someone@example.com', 'not a url'])(
    'opens nothing for %s',
    (url) => {
      expect(webUrlToOpenOutside(url)).toBeNull();
    },
  );
});
