import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, BrowserWindow, shell } from 'electron';
import { mainIpc } from '../ipc';
import { loadFeatures } from './features';
import { isAppPage, webUrlToOpenOutside } from './navigation';
import { createSettings, SETTINGS_FILE_NAME } from './settings';

const WINDOW_WIDTH = 1280;
const WINDOW_HEIGHT = 800;

function createWindow(): void {
  const window = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    title: 'Grillo',
    show: false,
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

void app.whenReady().then(() => {
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
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
