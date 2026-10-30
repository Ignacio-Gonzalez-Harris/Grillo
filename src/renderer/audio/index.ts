import { firstFrameArrives } from '../../main/features/audio-mac/loopback-check';
import { type AudioCapture, createAudioCapture } from './capture';
import { openWorkletSliceSource } from './graph';

/** The capture the screens use: the page's own media devices, the slicer worklet and `window.grillo`. */
export function createBrowserAudioCapture(): AudioCapture {
  return createAudioCapture({
    grillo: window.grillo,
    mediaDevices: navigator.mediaDevices,
    openSliceSource: openWorkletSliceSource,
    firstLoopbackFrame: firstFrameArrives,
  });
}

export type { AudioCapture } from './capture';
