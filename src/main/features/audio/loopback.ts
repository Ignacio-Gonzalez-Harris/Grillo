import type { CallAudioSupport } from '../../../shared/audio';

/** What the display-media handler answers: a screen for the (unused) video track, and the speakers' audio. */
export interface LoopbackStreams<Source> {
  video: Source;
  audio: 'loopback';
}

/** The parts of Electron's `session` and `desktopCapturer` the call-audio handler needs. */
export interface DisplayMediaHost<Source> {
  setDisplayMediaRequestHandler(
    handler: (request: unknown, callback: (streams: LoopbackStreams<Source> | null) => void) => void,
  ): void;
  getScreenSources(): Promise<Source[]>;
}

export const MAC_CALL_AUDIO_UNSUPPORTED =
  'Capturing the call audio on a Mac is not available yet. Record the room microphone instead.';

export function callAudioSupport(platform: NodeJS.Platform): CallAudioSupport {
  return platform === 'win32' ? { supported: true } : { supported: false, reason: MAC_CALL_AUDIO_UNSUPPORTED };
}

/**
 * On Windows, answers the renderer's `getDisplayMedia` with the system's loopback audio (what the speakers
 * play) and the first screen, without showing a picker: Chromium always captures a video track along
 * with display audio, and the renderer stops that track at once. Elsewhere nothing is installed.
 */
export function installCallAudioHandler<Source>(platform: NodeJS.Platform, host: DisplayMediaHost<Source>): void {
  if (!callAudioSupport(platform).supported) return;
  host.setDisplayMediaRequestHandler((_request, callback) => {
    host.getScreenSources().then(
      ([screen]) => callback(screen === undefined ? null : { video: screen, audio: 'loopback' }),
      () => callback(null),
    );
  });
}
