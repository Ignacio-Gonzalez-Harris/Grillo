import type { GrilloApi } from '../shared/ipc';

declare global {
  interface Window {
    grillo: GrilloApi;
  }
}
