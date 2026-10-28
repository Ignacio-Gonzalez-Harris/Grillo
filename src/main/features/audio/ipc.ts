import { desktopCapturer, session, systemPreferences } from 'electron';
import type { FeatureContext } from '../../app/features';
import { registerAudioChannels } from './channels';
import { callAudioSupport, installCallAudioHandler } from './loopback';
import { checkMicrophoneAccess } from './permissions';
import { audioSlices } from './slices';

/** Audio capture: the renderer captures, main checks the microphone permission and serves the call audio. */
export function register({ ipc, settings }: FeatureContext): void {
  const { platform } = process;
  const systemVersion = process.getSystemVersion();
  installCallAudioHandler(
    platform,
    {
      setDisplayMediaRequestHandler: (handler) => session.defaultSession.setDisplayMediaRequestHandler(handler),
      getScreenSources: () => desktopCapturer.getSources({ types: ['screen'] }),
    },
    systemVersion,
  );
  registerAudioChannels(ipc, {
    settings,
    microphoneAccess: () => checkMicrophoneAccess(platform, systemPreferences),
    callAudioSupport: () => callAudioSupport(platform, systemVersion),
    deliverSlice: audioSlices.publish,
  });
}
