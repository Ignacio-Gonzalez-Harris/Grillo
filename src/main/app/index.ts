import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, BrowserWindow, dialog, shell } from 'electron';
import icon from '../../../build/icon.png?asset';
import { mainIpc } from '../ipc';
import { loadFeatures } from './features';
import { isAppPage, webUrlToOpenOutside } from './navigation';
import { createSettings, SETTINGS_FILE_NAME } from './settings';
import { repairPathFromLoginShell, runLoginShell } from './shell-path';
import { startOrQuit } from './startup';
import { windowFrameOptions } from './window-frame';

const WINDOW_WIDTH = 1280;
const WINDOW_HEIGHT = 800;

function createWindow(): void {
  const window = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    title: 'Grillo',
    icon,
    show: false,
    ...windowFrameOptions(process.platform),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  window.once('ready-to-show', () => window.show());

  // electron-vite sets this while `npm run dev` serves the renderer; the built app loads its files.
  const devServerUrl = process.env['ELECTRON_RENDERER_URL'];
  const appUrl = devServerUrl ?? pathToFileURL(join(__dirname, '../renderer/index.html')).href;

  // The window only ever shows the app's own page: a link elsewhere opens in the system browser
  // (http and https only), and never inside the window, where it would reach window.grillo.
  const openOutside = (url: string): void => {
    const webUrl = webUrlToOpenOutside(url);
    if (webUrl) {
      void shell.openExternal(webUrl);
    }
  };
  window.webContents.on('will-navigate', (event, url) => {
    if (!isAppPage(url, appUrl)) {
      event.preventDefault();
      openOutside(url);
    }
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    openOutside(url);
    return { action: 'deny' };
  });

  void window.loadURL(appUrl);
}

// Started before the app is ready so the login shell runs alongside Electron's own start-up; every feature registers
// only after it settles, so each child process a feature starts sees the repaired PATH. It never waits past its limit.
const pathRepaired = repairPathFromLoginShell({
  platform: process.platform,
  env: process.env,
  runShell: runLoginShell,
  warn: console.warn,
});

async function start(): Promise<void> {
  await pathRepaired;
  loadFeatures({
    ipc: mainIpc,
    settings: createSettings(join(app.getPath('userData'), SETTINGS_FILE_NAME)),
  });
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
}

// A start-up that throws shows its reason in the system's error dialog and quits (app.quit, so every feature's
// will-quit clean-up still runs), never leaving a Grillo process running with no window.
void app.whenReady().then(() =>
  startOrQuit(start, {
    showError: (title, content) => dialog.showErrorBox(title, content),
    quit: () => app.quit(),
  }),
);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
