/** The name the slicer registers under in the audio worklet. */
export const SLICER_PROCESSOR_NAME = 'grillo-pcm-slicer';
/** Sent to the worklet: hand over the last, shorter slice now. */
export const FLUSH_MESSAGE = 'flush';
/** Sent back once the last slice is on its way. */
export const FLUSHED_MESSAGE = 'flushed';
