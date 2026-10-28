import { app, Notification } from 'electron';
import type { FeatureContext } from '../../app/features';
import { appStore } from '../store/ipc';
import { createNudgesFeature, type Notifier } from './nudges';

/**
 * The `appId` pinned in electron-builder.yml. Windows shows a packaged app's notifications only under the id its Start
 * menu shortcut carries, which the installer sets to the `appId`.
 */
const WINDOWS_APP_ID = 'com.grillo.app';

const systemNotifier: Notifier = {
  show: ({ title, body }) => new Notification({ title, body }).show(),
};

/** Nudges as system notifications, reading the app's one store, the instance the store feature puts on IPC. */
export function register({ settings }: FeatureContext): void {
  if (!Notification.isSupported()) {
    return;
  }
  if (process.platform === 'win32' && app.isPackaged) {
    app.setAppUserModelId(WINDOWS_APP_ID);
  }
  createNudgesFeature({
    store: appStore(settings),
    settings,
    notifier: systemNotifier,
  }).start();
}
