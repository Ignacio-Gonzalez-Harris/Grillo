/**
 * The audio-capture contract (PRD section 4.5 item 4, section 8 Toolkit): the renderer captures the room
 * microphone or the call audio and hands main 5-second slices of 16 kHz mono 16-bit PCM, the format the
 * speech engine reads.
 */

/** Samples per second of every slice: the rate the speech model expects. */
export const SLICE_SAMPLE_RATE = 16_000;
/** Length of one slice in live delivery. */
export const SLICE_SECONDS = 5;
/** Samples in one full slice; the last slice of a capture may be shorter. */
export const SAMPLES_PER_SLICE = SLICE_SAMPLE_RATE * SLICE_SECONDS;

/** What is captured: the laptop's microphone, or what the speakers play (the call's other participants). */
export const CAPTURE_SOURCES = ['microphone', 'call'] as const;
export type CaptureSource = (typeof CAPTURE_SOURCES)[number];

export function isCaptureSource(value: unknown): value is CaptureSource {
  return (CAPTURE_SOURCES as readonly unknown[]).includes(value);
}

/** One slice of captured audio, numbered from 0 in the order it was captured. */
export interface AudioSlice {
  source: CaptureSource;
  index: number;
  /** 16 kHz mono 16-bit PCM; at most `SAMPLES_PER_SLICE` samples. */
  pcm: Int16Array;
}

/**
 * Whether Grillo may use the microphone. `instruction` says where on this computer the person grants it;
 * show it when `granted` is false.
 */
export interface MicrophoneAccess {
  granted: boolean;
  instruction: string;
}

/** Whether this computer can capture the call audio. Mac call audio arrives with its own story. */
export type CallAudioSupport = { supported: true } | { supported: false; reason: string };

/** Why a capture could not start. */
export type CaptureFailure = 'unsupported' | 'permission-denied' | 'no-device' | 'already-capturing' | 'failed';

export type StartCaptureResult = { ok: true } | { ok: false; reason: CaptureFailure; message: string };

/** A microphone the person can pick. */
export interface InputDevice {
  deviceId: string;
  label: string;
}

/** The settings-file key that holds the picked microphone; absent or null means the system default. */
export const INPUT_DEVICE_SETTING = 'audioInputDevice';

declare module './ipc' {
  interface InvokeChannels {
    /** Checks the microphone permission, and on a Mac asks for it the first time. */
    'audio:microphone-access': { request: void; response: MicrophoneAccess };
    'audio:call-support': { request: void; response: CallAudioSupport };
    /** One captured slice, renderer to main. Rejected when the slice is malformed. */
    'audio:slice': { request: AudioSlice; response: void };
    'audio:get-input-device': { request: void; response: string | null };
    'audio:set-input-device': { request: string | null; response: void };
  }
}
