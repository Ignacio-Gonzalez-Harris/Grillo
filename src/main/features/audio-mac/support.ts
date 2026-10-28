import type { CallAudioSupport } from '../../../shared/audio';

/** Electron (39 and later) captures system audio on a Mac through Apple's CoreAudio tap, which starts at 14.2. */
const MIN_MAJOR = 14;
const MIN_MINOR = 2;
const MAC_VERSION = /^(\d+)(?:\.(\d+))?(?:\.\d+)?$/;

export const MAC_CALL_AUDIO_NEEDS_NEWER_MACOS =
  'Capturing the call audio on a Mac needs macOS 14.2 or later. Update macOS, or record the room microphone instead.';

function isTapAvailable(systemVersion: string): boolean {
  const match = MAC_VERSION.exec(systemVersion);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2] ?? 0);
  return major > MIN_MAJOR || (major === MIN_MAJOR && minor >= MIN_MINOR);
}

/**
 * Whether this Mac can capture the call audio, from its macOS version (`process.getSystemVersion()`). A missing
 * permission gives no error on a Mac, only a silent track, so a supported answer asks the capture to confirm that
 * frames arrive before it records.
 */
export function macCallAudioSupport(systemVersion: string): CallAudioSupport {
  return isTapAvailable(systemVersion)
    ? { supported: true, confirmFramesArrive: true }
    : { supported: false, reason: MAC_CALL_AUDIO_NEEDS_NEWER_MACOS };
}
