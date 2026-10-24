import type { GrilloApi } from './ipc';

/**
 * The app-update contract (PRD section 4.1 item 4, section 8 Updates): Grillo checks GitHub Releases for a newer
 * version and reports it here; the setup screen draws the prototype's update card from this state. Grillo shows no
 * native dialog.
 */

/** The settings-file key of the auto-update switch, and its value until the member turns it on. */
export const AUTO_UPDATE_SETTING = 'autoUpdate';
export const DEFAULT_AUTO_UPDATE = false;

/**
 * Where the offered update is: `none` (nothing to offer), `available` (found, not downloaded), `downloading`, or
 * `ready` (downloaded, installs on `install()` or, with auto-update, on quit).
 */
export type UpdatePhase = 'none' | 'available' | 'downloading' | 'ready';

export interface UpdateState {
  /** The running version, for "You have 1.0.0". */
  currentVersion: string;
  phase: UpdatePhase;
  /** The offered version; null when the phase is `none`. */
  version: string | null;
  /** Download progress from 0 to 100 while downloading; null otherwise. */
  percent: number | null;
  /** The member's switch: download silently and install on the next restart. */
  autoUpdate: boolean;
  /**
   * True when Grillo cannot install the update itself (a Mac build that is not signed): the screen explains how to
   * install it by hand, and neither `install()` nor auto-update downloads anything.
   */
  manualInstall: boolean;
}

declare module './ipc' {
  interface InvokeChannels {
    'updates:get-state': { request: void; response: UpdateState };
    'updates:set-auto-update': { request: boolean; response: UpdateState };
    /** "Download and install": downloads the offered update if needed, then quits and installs it. */
    'updates:install': { request: void; response: void };
    /** "Later": hides the offer of this version until Grillo starts again. */
    'updates:later': { request: void; response: void };
  }
  interface EventChannels {
    'updates:update-available': { version: string };
    'updates:download-progress': { version: string; percent: number };
    'updates:ready-to-install': { version: string };
  }
}

/** What the setup screen calls; every call goes through `window.grillo`. */
export interface UpdatesClient {
  getUpdateState(): Promise<UpdateState>;
  setAutoUpdate(enabled: boolean): Promise<UpdateState>;
  install(): Promise<void>;
  later(): Promise<void>;
}

export function createUpdatesClient(api: GrilloApi): UpdatesClient {
  return {
    getUpdateState: () => api.invoke('updates:get-state', undefined),
    setAutoUpdate: (enabled) => api.invoke('updates:set-auto-update', enabled),
    install: () => api.invoke('updates:install', undefined),
    later: () => api.invoke('updates:later', undefined),
  };
}
