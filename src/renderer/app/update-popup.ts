/**
 * The update pop-up (PRD section 8 Updates, "shows a pop-up offering to install"; prototype `screen-map-and-tickets`,
 * states "Update pop-up ..."): when the hourly check finds a newer version while Grillo is open, the setup check's
 * offer card shows over whatever screen is open. Each version pops up once; "Later" hides it until Grillo restarts.
 * The updates feature owns the update itself; the card follows its events.
 */
import type { GrilloApi } from '../../shared/ipc';
import { readEventVersion } from '../screens/setup-check/answers';
import { createUpdateCard } from '../screens/setup-check/update-card';

export interface UpdatePopupOptions {
  grillo: GrilloApi;
  /** True while the open screen shows the offer itself (the setup check), so no pop-up covers it. */
  screenShowsOffer: () => boolean;
  /** The parts of the window under the pop-up, out of reach of the keyboard and screen readers while it is open. */
  behind: readonly HTMLElement[];
}

export interface UpdatePopup {
  /** The overlay, placed last inside the window it covers. */
  root: HTMLElement;
  dispose(): void;
}

export function createUpdatePopup({ grillo, screenShowsOffer, behind }: UpdatePopupOptions): UpdatePopup {
  /** Every version offered since Grillo started, on the setup check or in the pop-up. */
  const offered = new Set<string>();
  const root = document.createElement('div');
  root.className = 'overlay';

  function setOpen(open: boolean): void {
    root.hidden = !open;
    behind.forEach((part) => part.toggleAttribute('inert', open));
  }

  // The card listens to the update events first, so it already shows the new version when the pop-up opens.
  const card = createUpdateCard(grillo, { popup: true, onLater: () => setOpen(false) });
  root.append(card.root);
  setOpen(false);

  const stopListening = grillo.on('updates:update-available', (payload) => {
    const version = readEventVersion(payload);
    if (!version || offered.has(version)) return;
    offered.add(version);
    if (!screenShowsOffer()) setOpen(true);
  });

  return {
    root,
    dispose() {
      stopListening();
      card.dispose();
    },
  };
}
