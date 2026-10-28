import { firstFrameArrives } from '../../main/features/audio-mac/loopback-check';
import type { GrilloApi } from '../../shared/ipc';
import { type AudioCapture, createAudioCapture } from './capture';
import { openWorkletSliceSource } from './graph';

/** The capture the screens use: the page's own media devices, the slicer worklet and `window.grillo`. */
export function createBrowserAudioCapture(): AudioCapture {
  // `window.grillo` is typed in src/preload/index.d.ts, which TypeScript skips beside src/preload/index.ts.
  const { grillo } = window as unknown as { grillo: GrilloApi };
  return createAudioCapture({
    grillo,
    mediaDevices: navigator.mediaDevices,
    openSliceSource: openWorkletSliceSource,
    firstLoopbackFrame: firstFrameArrives,
  });
}

export type { AudioCapture } from './capture';
