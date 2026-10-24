import { EventEmitter } from 'node:events';
import type { Updater } from './updates';

/**
 * A stand-in for electron-updater's `autoUpdater`, for tests. Like the real one it emits `update-available` during a
 * check, starts the download by itself when `autoDownload` is on, and both emits `error` and rejects when a check or a
 * download fails. Its flags start at the library's defaults (both true).
 */
export function createFakeUpdater() {
  const emitter = new EventEmitter();
  const state = {
    /** The version the next check finds; null means "up to date". */
    published: null as string | null,
    /** Set to make the next checks or downloads fail. */
    checkFailure: null as Error | null,
    downloadFailure: null as Error | null,
    checks: 0,
    downloads: 0,
    installs: [] as [boolean | undefined, boolean | undefined][],
  };

  const download = async (): Promise<string[]> => {
    state.downloads += 1;
    if (state.downloadFailure) {
      emitter.emit('error', state.downloadFailure);
      throw state.downloadFailure;
    }
    emitter.emit('download-progress', { percent: 40 });
    emitter.emit('download-progress', { percent: 100 });
    emitter.emit('update-downloaded', { version: state.published });
    return [];
  };

  const updater: Updater & { emit(event: string, payload: unknown): void } = {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    on(event, listener) {
      emitter.on(event, listener);
      return updater;
    },
    emit(event, payload) {
      emitter.emit(event, payload);
    },
    async checkForUpdates() {
      state.checks += 1;
      if (state.checkFailure) {
        emitter.emit('error', state.checkFailure);
        throw state.checkFailure;
      }
      if (state.published !== null) {
        emitter.emit('update-available', { version: state.published });
        if (updater.autoDownload) {
          await download();
        }
      }
      return null;
    },
    downloadUpdate: download,
    quitAndInstall(isSilent, isForceRunAfter) {
      state.installs.push([isSilent, isForceRunAfter]);
    },
  };

  return { updater, state };
}
