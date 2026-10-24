import { join } from 'node:path';
import { app, BrowserWindow } from 'electron';
import { mainIpc } from '../ipc';
import { loadFeatures } from './features';
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
  if (devServerUrl) {
    void window.loadURL(devServerUrl);
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'));
  }
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
