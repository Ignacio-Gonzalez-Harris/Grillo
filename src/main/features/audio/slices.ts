import type { AudioSlice } from '../../../shared/audio';
import type { Unsubscribe } from '../../../shared/ipc';

export type SliceListener = (slice: AudioSlice) => void;

/** Where captured slices arrive in main; the meeting session subscribes and hands them to transcription. */
export interface SliceBus {
  publish(slice: AudioSlice): void;
  subscribe(listener: SliceListener): Unsubscribe;
}

export function createSliceBus(): SliceBus {
  const listeners = new Set<SliceListener>();
  return {
    publish(slice) {
      for (const listener of [...listeners]) listener(slice);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** The app's one bus: every slice the renderer captures, whichever source it came from. */
export const audioSlices: SliceBus = createSliceBus();
