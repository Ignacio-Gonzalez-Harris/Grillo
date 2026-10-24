import { contextBridge, ipcRenderer } from 'electron';
import { createGrilloApi } from './bridge';

contextBridge.exposeInMainWorld('grillo', createGrilloApi(ipcRenderer));
