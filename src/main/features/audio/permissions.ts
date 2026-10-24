import type { MicrophoneAccess } from '../../../shared/audio';

/** The part of Electron's `systemPreferences` the permission check needs. */
export interface MediaAccessPreferences {
  getMediaAccessStatus(mediaType: 'microphone'): 'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown';
  /** macOS only: shows the system's own question the first time. */
  askForMediaAccess(mediaType: 'microphone'): Promise<boolean>;
}

export const MAC_MICROPHONE_INSTRUCTION =
  'Open System Settings > Privacy & Security > Microphone, turn on Grillo, then restart Grillo.';
export const WINDOWS_MICROPHONE_INSTRUCTION =
  'Open Settings > Privacy & security > Microphone, turn on "Microphone access" and "Let desktop apps access your microphone", then try again.';
const OTHER_MICROPHONE_INSTRUCTION = "Allow Grillo to use the microphone in your system's privacy settings, then try again.";

function instructionFor(platform: NodeJS.Platform): string {
  if (platform === 'darwin') return MAC_MICROPHONE_INSTRUCTION;
  if (platform === 'win32') return WINDOWS_MICROPHONE_INSTRUCTION;
  return OTHER_MICROPHONE_INSTRUCTION;
}

/**
 * Checks the microphone permission before a capture starts. On a Mac a missing permission makes capture
 * fail silently, so Grillo asks the system first: the first time it shows the system's question, and a
 * refusal is reported with where to grant it. Windows reports a switched-off microphone the same way.
 */
export async function checkMicrophoneAccess(
  platform: NodeJS.Platform,
  preferences: MediaAccessPreferences,
): Promise<MicrophoneAccess> {
  const instruction = instructionFor(platform);
  if (platform !== 'darwin' && platform !== 'win32') {
    return { granted: true, instruction };
  }
  const status = preferences.getMediaAccessStatus('microphone');
  if (platform === 'darwin' && status === 'not-determined') {
    return { granted: await preferences.askForMediaAccess('microphone'), instruction };
  }
  return { granted: status !== 'denied' && status !== 'restricted', instruction };
}
