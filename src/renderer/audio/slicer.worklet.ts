// Runs in the audio worklet's own scope, where these exist as globals; TypeScript's DOM library lacks them.
import { createPcmSlicer, downmix } from './slicer';
import { FLUSH_MESSAGE, FLUSHED_MESSAGE, SLICER_PROCESSOR_NAME } from './worklet-protocol';

declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, processor: new () => AudioWorkletProcessor): void;

/** Slices the captured audio on the audio thread and posts each slice to the page. */
class SlicerProcessor extends AudioWorkletProcessor {
  private readonly slicer = createPcmSlicer({
    inputSampleRate: sampleRate,
    onSlice: (pcm) => this.port.postMessage(pcm, [pcm.buffer]),
  });

  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent) => {
      if (event.data === FLUSH_MESSAGE) {
        this.slicer.flush();
        this.port.postMessage(FLUSHED_MESSAGE);
      }
    };
  }

  process(inputs: Float32Array[][]): boolean {
    const channels = inputs[0];
    if (channels !== undefined && channels.length > 0) this.slicer.push(downmix(channels));
    return true;
  }
}

registerProcessor(SLICER_PROCESSOR_NAME, SlicerProcessor);
