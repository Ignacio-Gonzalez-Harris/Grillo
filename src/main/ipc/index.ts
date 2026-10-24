import { BrowserWindow, ipcMain } from 'electron';
import { createMainIpc, type MainIpc } from './bridge';

/** The app's one bridge: invokes arrive through `ipcMain`, events go to every open window. */
export const mainIpc: MainIpc = createMainIpc(ipcMain, () =>
  BrowserWindow.getAllWindows()
    .map((window) => window.webContents)
    .filter((contents) => !contents.isDestroyed()),
);

export const { handle, send } = mainIpc;
