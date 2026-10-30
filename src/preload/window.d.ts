// The type of `window.grillo`, the bridge the preload script exposes. Named apart from index.ts: TypeScript skips a
// .d.ts that shares its name with a .ts file beside it.
import type { GrilloApi } from '../shared/ipc';

declare global {
  interface Window {
    grillo: GrilloApi;
  }
}
