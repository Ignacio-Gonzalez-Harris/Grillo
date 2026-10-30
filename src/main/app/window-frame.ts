// The app window's frame. Grillo draws its own frame (the glass panel with the "Grillo" title bar from the UX
// prototype), so the window drops the system title bar and keeps only the system window buttons, drawn inside
// Grillo's title bar. Those keep the native behaviour: Windows 11 snap layouts, double-click to maximise, edge resize.
import type { BrowserWindowConstructorOptions } from 'electron';

// Main cannot read CSS, so these are copies of values in src/renderer/theme/tokens.css (window-frame.test.ts checks
// them against that file).
/** --color-glass-fill: the title bar's own glass fill, behind the Windows buttons. */
const GLASS_FILL = 'rgba(255, 255, 255, 0.55)';
/** --color-text: the button symbols, the same colour as the "Grillo" name beside them. */
const TEXT = '#18261e';
/** --space-3 + --size-logo + --space-3: the title bar's height, the logo between its top and bottom padding. */
const TITLE_BAR_HEIGHT = 12 + 20 + 12;
/** --space-4: the Mac buttons sit as far in from the window's corner as the title bar's own padding. */
const MAC_BUTTONS_INSET = 16;

export type WindowFrameOptions = Pick<
  BrowserWindowConstructorOptions,
  'titleBarStyle' | 'titleBarOverlay' | 'trafficLightPosition'
>;

/** The frame options of the app window on `platform`. */
export function windowFrameOptions(platform: NodeJS.Platform): WindowFrameOptions {
  if (platform === 'darwin') {
    // The red, yellow and green buttons stay; the overlay only tells the page where they are, so the logo clears them.
    return {
      titleBarStyle: 'hidden',
      titleBarOverlay: true,
      trafficLightPosition: { x: MAC_BUTTONS_INSET, y: MAC_BUTTONS_INSET },
    };
  }
  return {
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: GLASS_FILL, symbolColor: TEXT, height: TITLE_BAR_HEIGHT },
  };
}
