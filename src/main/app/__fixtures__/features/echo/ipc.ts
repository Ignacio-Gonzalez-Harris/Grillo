// A made-up feature folder used only by the feature-discovery test. Nothing outside this folder names it.
import type { FeatureContext } from '../../../features';

declare module '../../../../../shared/ipc' {
  interface InvokeChannels {
    'fixture-echo:say': { request: string; response: string };
  }
}

export function register({ ipc }: FeatureContext): void {
  ipc.handle('fixture-echo:say', (text) => `echo: ${text}`);
}
