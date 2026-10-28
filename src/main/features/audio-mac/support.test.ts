import { describe, expect, it } from 'vitest';
import { MAC_CALL_AUDIO_NEEDS_NEWER_MACOS, macCallAudioSupport } from './support';

describe('Mac call-audio support', () => {
  it.each(['14.2', '14.2.1', '14.10', '15.0', '26.1'])(
    'on macOS %s is supported, and asks the capture to confirm frames arrive',
    (version) => {
      expect(macCallAudioSupport(version)).toEqual({ supported: true, confirmFramesArrive: true });
    },
  );

  it.each(['14.1.2', '14.0', '13.6.4', '10.15.7', '', 'Sonoma', '14', 'x.y'])(
    'on macOS version "%s" is a typed unsupported answer saying macOS 14.2 is needed',
    (version) => {
      expect(macCallAudioSupport(version)).toEqual({ supported: false, reason: MAC_CALL_AUDIO_NEEDS_NEWER_MACOS });
      expect(MAC_CALL_AUDIO_NEEDS_NEWER_MACOS).toContain('macOS 14.2');
    },
  );
});
