import { SLICE_SAMPLE_RATE } from '../../shared/audio';
import type { OpenSliceSource } from './capture';
import slicerWorkletUrl from './slicer.worklet.ts?worker&url';
import { FLUSH_MESSAGE, FLUSHED_MESSAGE, SLICER_PROCESSOR_NAME } from './worklet-protocol';

/**
 * The real audio graph: the captured stream feeds the slicer worklet in an audio context running at 16 kHz,
 * so Chromium resamples the device's audio before the worklet sees it.
 */
export const openWorkletSliceSource: OpenSliceSource<MediaStream> = async (stream, onSlice) => {
  const context = new AudioContext({ sampleRate: SLICE_SAMPLE_RATE });
  let flushed: (() => void) | undefined;
  try {
    await context.audioWorklet.addModule(slicerWorkletUrl);
    const input = context.createMediaStreamSource(stream);
    const slicer = new AudioWorkletNode(context, SLICER_PROCESSOR_NAME, { numberOfInputs: 1, numberOfOutputs: 0 });
    slicer.port.onmessage = (event: MessageEvent) => {
      if (event.data instanceof Int16Array) onSlice(event.data);
      else if (event.data === FLUSHED_MESSAGE) flushed?.();
    };
    input.connect(slicer);
    return {
      async stop() {
        const done = new Promise<void>((resolve) => {
          flushed = resolve;
        });
        slicer.port.postMessage(FLUSH_MESSAGE);
        await done;
        input.disconnect();
        await context.close();
      },
    };
  } catch (error) {
    await context.close();
    throw error;
  }
};
