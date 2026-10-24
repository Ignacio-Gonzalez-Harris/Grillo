import { app } from 'electron';
import { autoUpdater } from 'electron-updater';
import type { FeatureContext } from '../../app/features';
import { createUpdatesFeature } from './updates';

/**
 * Set to `true` at build time (`MAIN_VITE_MAC_SIGNED=true npm run build`) by the release job that signs the Mac app.
 * Until then a Mac build counts as unsigned and offers only a manual install.
 */
const macBuildSigned = import.meta.env.MAIN_VITE_MAC_SIGNED === 'true';

/** App updates from GitHub Releases, as pinned under `publish` in electron-builder.yml. */
export function register({ ipc, settings }: FeatureContext): void {
  createUpdatesFeature({
    ipc,
    settings,
    updater: () => autoUpdater,
    currentVersion: app.getVersion(),
    isPackaged: app.isPackaged,
    platform: process.platform,
    macBuildSigned,
  }).start();
}
