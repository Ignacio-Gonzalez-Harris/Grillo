import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { windowFrameOptions } from './window-frame';

/** The value of one design token, read from the renderer's token file (the one source of colours and sizes). */
function token(name: string): string {
  const tokens = readFileSync(resolve('src/renderer/theme/tokens.css'), 'utf8');
  const match = new RegExp(`--${name}:\\s*([^;]+);`).exec(tokens);
  if (!match) throw new Error(`No --${name} token in tokens.css`);
  return match[1].trim();
}

const pixels = (name: string) => Number.parseFloat(token(name));

describe('the app window frame', () => {
  it.each(['win32', 'darwin'] as const)('has no native title bar on %s', (platform) => {
    expect(windowFrameOptions(platform).titleBarStyle).toBe('hidden');
  });

  it("draws the Windows minimise, maximise and close buttons inside Grillo's title bar, in token colours", () => {
    expect(windowFrameOptions('win32').titleBarOverlay).toEqual({
      color: token('color-glass-fill'),
      symbolColor: token('color-text'),
      // The title bar's height: the logo between its top and bottom padding.
      height: pixels('space-3') + pixels('size-logo') + pixels('space-3'),
    });
  });

  it("keeps the Mac buttons, placed inside Grillo's title bar, and tells the page where they are", () => {
    const options = windowFrameOptions('darwin');

    expect(options.titleBarOverlay).toBe(true);
    expect(options.trafficLightPosition).toEqual({ x: pixels('space-4'), y: pixels('space-4') });
  });
});
