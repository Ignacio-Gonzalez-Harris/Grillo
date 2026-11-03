/**
 * The update pop-up (PRD section 8 Updates, "shows a pop-up offering to install"; prototype `screen-map-and-tickets`,
 * states "Update pop-up ..."): when the hourly check finds a newer version while Grillo is open, the setup check's
 * offer card shows over whatever screen is open. Each version pops up once; "Later" hides it until Grillo restarts.
 * The updates feature owns the update itself; the card follows its events.
 *
 * Main looks for an update before the window listens, and it announces each version only once, so an announcement can
 * come too early for the event. So once the first screen is open (`start`, and only then is it known whether that screen
 * shows the offer itself) the pop-up also asks main what it is offering. A version put off with Later is no longer
 * offered there.
 */
import type { GrilloApi } from '../../shared/ipc';
import { createUpdatesClient } from '../../shared/updates';
import { readEventVersion, readUpdateState } from '../screens/setup-check/answers';
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
  /** Called whenever a screen opens: the first call starts the offering. */
  start(): void;
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

  /** False until the first screen is open; a version announced before that is read from main in `start`. */
  let started = false;
  let disposed = false;

  function offer(version: string | null): void {
    if (!started || disposed || !version || offered.has(version)) return;
    offered.add(version);
    if (!screenShowsOffer()) setOpen(true);
  }

  const stopListening = grillo.on('updates:update-available', (payload) => offer(readEventVersion(payload)));

  return {
    root,
    start() {
      if (started) return;
      started = true;
      createUpdatesClient(grillo)
        .getUpdateState()
        .then((answer) => offer(readUpdateState(answer).version))
        .catch((error: unknown) => console.warn('Grillo could not read the update offer.', error));
    },
    dispose() {
      disposed = true;
      stopListening();
      card.dispose();
    },
  };
}
