import { describe, expect, it, vi } from 'vitest';
import {
  checkMicrophoneAccess,
  MAC_MICROPHONE_INSTRUCTION,
  type MediaAccessPreferences,
  WINDOWS_MICROPHONE_INSTRUCTION,
} from './permissions';

type Status = ReturnType<MediaAccessPreferences['getMediaAccessStatus']>;

function preferences(status: Status, answer = false) {
  return {
    getMediaAccessStatus: vi.fn(() => status),
    askForMediaAccess: vi.fn(async () => answer),
  };
}

describe('checkMicrophoneAccess', () => {
  it.each<[NodeJS.Platform, Status, boolean, string]>([
    ['darwin', 'granted', true, MAC_MICROPHONE_INSTRUCTION],
    ['darwin', 'denied', false, MAC_MICROPHONE_INSTRUCTION],
    ['darwin', 'restricted', false, MAC_MICROPHONE_INSTRUCTION],
    ['win32', 'granted', true, WINDOWS_MICROPHONE_INSTRUCTION],
    ['win32', 'denied', false, WINDOWS_MICROPHONE_INSTRUCTION],
    ['win32', 'unknown', true, WINDOWS_MICROPHONE_INSTRUCTION],
  ])('on %s with the system saying %s reports granted=%s with that system\'s instruction', async (platform, status, granted, instruction) => {
    const prefs = preferences(status);

    await expect(checkMicrophoneAccess(platform, prefs)).resolves.toEqual({ granted, instruction });
    expect(prefs.askForMediaAccess).not.toHaveBeenCalled();
  });

  it('on a Mac asks the system the first time and reports its answer', async () => {
    const yes = preferences('not-determined', true);
    const no = preferences('not-determined', false);

    await expect(checkMicrophoneAccess('darwin', yes)).resolves.toEqual({ granted: true, instruction: MAC_MICROPHONE_INSTRUCTION });
    await expect(checkMicrophoneAccess('darwin', no)).resolves.toEqual({ granted: false, instruction: MAC_MICROPHONE_INSTRUCTION });
    expect(yes.askForMediaAccess).toHaveBeenCalledWith('microphone');
  });
});
