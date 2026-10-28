/**
 * The live grilling session's contract (PRD section 4.5 items 1-5, section 7 recording consent): the host's
 * session state, the one error its callers handle, and the protocol messages a session types into an agent
 * (`resources/skills/README.md`, Screen-to-agent protocol).
 */
import type { AgentId } from './agents';

/** How the room answers the question at hand (PRD 4.5 item 7). */
export const AGENT_MODES = ['listen', 'type'] as const;
export type AgentMode = (typeof AGENT_MODES)[number];

export function isAgentMode(value: unknown): value is AgentMode {
  return (AGENT_MODES as readonly unknown[]).includes(value);
}

/** The control lines that take no value. */
export const USE_IT = 'use it';
export const SKIP = 'skip';

export function sessionLine(sessionFile: string): string {
  return `session: ${sessionFile}`;
}

export function modeLine(mode: AgentMode): string {
  return `mode: ${mode}`;
}

export function jumpLine(ticket: number): string {
  return `jump ${ticket}`;
}

/** Every member ticked present, the host included; an empty list is `present:` alone. */
export function presentLine(logins: readonly string[]): string {
  return logins.length === 0 ? 'present:' : `present: ${logins.join(', ')}`;
}

/** Why a session call was refused. Every refusal is a `SessionError`, so callers handle one error type. */
export type SessionErrorKind =
  /** No session has been started, or it has ended. */
  | 'no-session'
  /** A session is already running on this laptop. */
  | 'session-running'
  /** Recording was asked for before the host ticked consent. */
  | 'no-consent'
  /** The consent tick came from someone other than the member signed in on this laptop. */
  | 'not-host'
  /** A value the session cannot use: a malformed login or ticket number, an unknown mode. */
  | 'invalid'
  /** No running agent has that id. */
  | 'unknown-agent'
  /** The store refused or returned something the session cannot use. */
  | 'store';

export class SessionError extends Error {
  readonly kind: SessionErrorKind;

  constructor(kind: SessionErrorKind, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'SessionError';
    this.kind = kind;
  }
}

/** What happened to the slices of the session so far. */
export interface SliceCounts {
  /** Slices that arrived while recording, duplicates left out. */
  heard: number;
  /** Slices whose text went into the transcript. */
  transcribed: number;
  /** Slices that held no speech (empty text, or only a non-speech marker such as `[BLANK_AUDIO]`). */
  silent: number;
  /** Slices whose transcription failed, returned no text or took too long: left out, the stream went on. */
  dropped: number;
}

/** The session as the host's screen shows it. */
export interface SessionState {
  project: string;
  /** The session file's name without `.md`: `2026-10-24-091500`. */
  id: string;
  /** The session file's path in the project folder: `.grillo/sessions/2026-10-24-091500.md`. */
  file: string;
  date: string;
  present: string[];
  consent: { by: string; at: string } | null;
  recording: boolean;
  /** The agents whose channel is open, in the order they were opened. */
  channels: AgentId[];
  transcript: string;
  slices: SliceCounts;
}
