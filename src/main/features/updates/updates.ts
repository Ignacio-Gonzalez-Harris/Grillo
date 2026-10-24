import { AUTO_UPDATE_SETTING, DEFAULT_AUTO_UPDATE, type UpdateState } from '../../../shared/updates';
import type { Settings } from '../../app/settings';
import type { MainIpc } from '../../ipc/bridge';

/** How often Grillo looks for a newer release while it is open (PRD section 8, Updates). */
export const CHECK_INTERVAL_MS = 60 * 60 * 1000;

const LOWEST_PERCENT = 0;
const HIGHEST_PERCENT = 100;

type UpdaterEvent = 'update-available' | 'download-progress' | 'update-downloaded' | 'error';

/** The part of electron-updater's `autoUpdater` Grillo uses; a fake stands in for it in tests. */
export interface Updater {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  on(event: UpdaterEvent, listener: (payload: unknown) => void): unknown;
  /** With `autoDownload` on, the answer carries the download it started, which runs on after the check. */
  checkForUpdates(): Promise<{ downloadPromise?: Promise<unknown> | null } | null>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
}

export interface UpdateLog {
  info(message: string): void;
  warn(message: string): void;
}

export interface UpdatesFeatureOptions {
  ipc: MainIpc;
  settings: Settings;
  /** Called only in a packaged app, so a dev run never builds an updater. */
  updater: () => Updater;
  currentVersion: string;
  isPackaged: boolean;
  platform: NodeJS.Platform;
  /** True when this Mac build is code-signed; Squirrel.Mac refuses to install an update into an unsigned app. */
  macBuildSigned: boolean;
  log?: UpdateLog;
}

export interface UpdatesFeature {
  /** Checks now, then every hour (a packaged app only). */
  start(): void;
  stop(): void;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The version in an updater answer, or null when the answer has none Grillo can use. */
function versionIn(info: unknown): string | null {
  const version = (info as { version?: unknown } | null | undefined)?.version;
  return typeof version === 'string' && version !== '' ? version : null;
}

function percentIn(progress: unknown): number | null {
  const percent = (progress as { percent?: unknown } | null | undefined)?.percent;
  if (typeof percent !== 'number' || !Number.isFinite(percent)) {
    return null;
  }
  return Math.min(HIGHEST_PERCENT, Math.max(LOWEST_PERCENT, percent));
}

/**
 * The app-update check (PRD section 4.1 item 4, section 8 Updates): looks for a newer GitHub release at start and
 * every hour, reports it over IPC for the setup screen's update card (never a native dialog), and downloads and
 * installs it when the member says so, or silently on the next quit when the auto-update setting is on.
 */
export function createUpdatesFeature(options: UpdatesFeatureOptions): UpdatesFeature {
  const { ipc, settings, currentVersion, isPackaged, platform, macBuildSigned, log = console } = options;
  const manualInstall = platform === 'darwin' && !(isPackaged && macBuildSigned);
  const dismissed = new Set<string>();
  let updater: Updater | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let checking = false;
  let installWhenReady = false;
  let offer: Pick<UpdateState, 'phase' | 'version' | 'percent'> = { phase: 'none', version: null, percent: null };

  const autoUpdate = (): boolean => settings.get<unknown>(AUTO_UPDATE_SETTING, DEFAULT_AUTO_UPDATE) === true;
  const installsByItself = (): boolean => autoUpdate() && !manualInstall;
  const state = (): UpdateState => ({ currentVersion, ...offer, autoUpdate: autoUpdate(), manualInstall });

  const applyAutoUpdate = (): void => {
    if (updater) {
      updater.autoDownload = installsByItself();
      updater.autoInstallOnAppQuit = installsByItself();
    }
  };

  const announce = (version: string): void => {
    offer = { phase: 'available', version, percent: null };
    ipc.send('updates:update-available', { version });
  };

  /** A download that failed puts the offer back, so the card can be pressed again. */
  const downloadFailed = (): void => {
    installWhenReady = false;
    if (offer.phase === 'downloading' && offer.version) {
      announce(offer.version);
    }
  };

  const download = async (active: Updater): Promise<void> => {
    offer = { ...offer, phase: 'downloading' };
    try {
      await active.downloadUpdate();
    } catch (error) {
      log.warn(`Update download failed: ${describe(error)}`);
      downloadFailed();
    }
  };

  const listen = (active: Updater): void => {
    active.on('update-available', (info) => {
      const version = versionIn(info);
      if (version === null) {
        log.warn('Update check answered without a version; ignored');
      } else if (!dismissed.has(version) && offer.version !== version) {
        announce(version);
      }
    });
    active.on('download-progress', (progress) => {
      const percent = percentIn(progress);
      const { version, phase } = offer;
      if (percent !== null && version && phase !== 'ready') {
        offer = { version, phase: 'downloading', percent };
        ipc.send('updates:download-progress', { version, percent });
      }
    });
    active.on('update-downloaded', (info) => {
      const version = versionIn(info);
      if (version === null) {
        log.warn('Update download finished without a version; ignored');
        return;
      }
      offer = { phase: 'ready', version, percent: null };
      ipc.send('updates:ready-to-install', { version });
      if (installWhenReady) {
        active.quitAndInstall(true, true);
      }
    });
    active.on('error', (error) => {
      log.warn(`Updater error: ${describe(error)}`);
      downloadFailed();
    });
  };

  const check = async (): Promise<void> => {
    if (!updater || checking || offer.phase === 'downloading' || offer.phase === 'ready') {
      return;
    }
    checking = true;
    try {
      const result = await updater.checkForUpdates();
      // A failed silent download is already logged and undone by the `error` listener; this keeps it from also
      // surfacing as an unhandled rejection.
      result?.downloadPromise?.catch(() => undefined);
    } catch (error) {
      log.warn(`Update check failed: ${describe(error)}`);
    } finally {
      checking = false;
    }
  };

  ipc.handle('updates:get-state', () => state());
  ipc.handle('updates:set-auto-update', (enabled) => {
    if (typeof enabled !== 'boolean') {
      throw new Error(`autoUpdate must be a boolean, got '${String(enabled)}'`);
    }
    settings.set(AUTO_UPDATE_SETTING, enabled);
    applyAutoUpdate();
    if (updater && installsByItself() && offer.phase === 'available') {
      void download(updater);
    }
    return state();
  });
  ipc.handle('updates:install', async () => {
    if (!updater || manualInstall || offer.phase === 'none') {
      log.info('Install asked with no update Grillo can install itself; nothing done');
      return;
    }
    installWhenReady = true;
    if (offer.phase === 'ready') {
      updater.quitAndInstall(true, true);
    } else if (offer.phase === 'available') {
      await download(updater);
    }
  });
  ipc.handle('updates:later', () => {
    installWhenReady = false;
    if (offer.phase === 'available' && offer.version) {
      dismissed.add(offer.version);
      offer = { phase: 'none', version: null, percent: null };
    }
  });

  return {
    start() {
      if (!isPackaged) {
        log.info('Update check skipped: this is a development run, not an installed app');
        return;
      }
      if (!updater) {
        updater = options.updater();
        listen(updater);
      }
      applyAutoUpdate();
      void check();
      timer ??= setInterval(() => void check(), CHECK_INTERVAL_MS);
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}
