/**
 * The live grilling session on the host's laptop (PRD section 4.5 items 1-5, section 7 recording consent): who is
 * present, the consent tick, one recording switch that turns audio slices into the session transcript file, and a
 * per-agent channel that writes the live transcript into an agent's input box and types the protocol messages of
 * `resources/skills/README.md`. A chat agent has no input box: its transcript is held here and goes out with the
 * next protocol message, as one chat message.
 */
import type { AgentId } from '../../../shared/agents';
import type { AudioSlice } from '../../../shared/audio';
import type { Unsubscribe } from '../../../shared/ipc';
import {
  type AgentMode,
  isAgentMode,
  jumpLine,
  modeLine,
  presentLine,
  sessionLine,
  SessionError,
  type SessionState,
  SKIP,
  type SliceCounts,
  USE_IT,
} from '../../../shared/session';
import { StoreError } from '../../../shared/store';
import { GRILLO_FILES, isLogin, isSessionId, sameLogin } from '../../store/github/repo/names';
import type { Store } from '../../store/store';
import type { Consent, GrillingSession } from '../../store/types';
import { type AgentRuntime, ENTER_AFTER_QUIET_MS } from '../agents/runtime';
import type { SliceListener } from '../audio/slices';
import type { Transcriber } from '../transcription/transcriber';

/**
 * How long the slice at the head of the stream may take to transcribe before it is left out, so one outlier never
 * holds up the slices behind it. Three slices' worth: a 5-second slice normally takes about a second.
 */
export const OUTLIER_AFTER_MS = 15_000;
/** Ctrl+J: Claude Code puts a new line in its input box without sending the message. */
export const LINE_BREAK = '\n';
const ENTER = '\r';
const TRANSCRIPT_LINE_SEPARATOR = '\n';
/** Everything a terminal reads as a key press or an escape code rather than text, line breaks included. */
// eslint-disable-next-line no-control-regex -- the point is to find control characters
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/g;
/** whisper.cpp's non-speech markers, such as `[BLANK_AUDIO]` or `[MUSIC]`. */
const NON_SPEECH_MARKER = /\[[^\]]*\]/g;
const WHITESPACE = /\s+/g;

/** The store calls a session makes. */
export type SessionStore = Pick<Store, 'currentMember' | 'createSession' | 'updateSession'>;

export interface SessionHostDeps {
  store: SessionStore;
  /** Where captured slices arrive in main (`audioSlices`). */
  slices: { subscribe(listener: SliceListener): Unsubscribe };
  transcriber: Transcriber;
  agents: Pick<AgentRuntime, 'choice' | 'write' | 'send' | 'list'>;
  /**
   * Told the words a chat agent's channel holds each time they change, for its chat view's box: `''` once none are
   * held, with `sent` true when a protocol message took the whole box (the view then empties it).
   */
  held?(agentId: AgentId, text: string, sent: boolean): void;
}

/** One host's session. Every refusal is a `SessionError`. */
export interface SessionHost {
  /** Creates the session file, named by the moment it starts, and tells every open channel about it. */
  startSession(project: string): Promise<SessionState>;
  /** Replaces the list of members present, in the session file too. */
  setPresent(logins: string[]): Promise<void>;
  /** The host ticks "everyone here agreed"; recorded once, with the login and the time. */
  tickConsent(login: string): Promise<void>;
  /** On (only after consent): slices are transcribed into the file. Off resolves once the file holds them all. */
  setRecording(on: boolean): Promise<void>;
  /** Stops the recording, closes every channel and forgets the session. */
  endSession(): Promise<void>;
  /** Open: each transcribed slice is written into the agent's input box, without Enter. */
  setChannel(agentId: AgentId, open: boolean): Promise<void>;
  /** The agents whose channel is open, in opening order, with or without a session running. */
  channels(): AgentId[];
  /** Types `session: <file>` into a meeting agent, channel open or not; once per agent and session. */
  tellSession(agentId: AgentId): Promise<void>;
  /**
   * Sends what a chat agent's message box holds as one chat message (the member pressed Send). The held words the
   * box showed (`shownHeld`) go with it and are no longer held; words spoken since stay held.
   */
  sendBox(agentId: AgentId, text: string, shownHeld: string): Promise<void>;
  /** The held words a chat agent's message box showed went out another way (an answer): they are no longer held. */
  releaseHeld(agentId: AgentId, shownHeld: string): Promise<void>;
  /**
   * The member edited a chat agent's message box (grilling agents): it now shows `text`, which stands for the first
   * held words, those in `shownHeld`. The next protocol message (Use it, skip, …) sends `text` and the words held
   * since, instead of the held words.
   */
  editBox(agentId: AgentId, text: string, shownHeld: string): Promise<void>;
  /** Sends the agent's input box with `use it` as its last line. The ones below type their protocol message. */
  useIt(agentId: AgentId): Promise<void>;
  typeMode(agentId: AgentId, mode: AgentMode): Promise<void>;
  /** Types the presence message (`present: <logins>`) into a meeting agent, after any transcript in its box. */
  typePresent(agentId: AgentId, logins: string[]): Promise<void>;
  skip(agentId: AgentId): Promise<void>;
  jump(agentId: AgentId, ticket: number): Promise<void>;
  /** The running session, or null when there is none. */
  state(): SessionState | null;
}

interface RunningSession {
  project: string;
  id: string;
  file: string;
  date: string;
  present: string[];
  consent: Consent | null;
  transcriptLines: string[];
  /** The transcript as the file last held it. */
  savedTranscript: string;
  slices: SliceCounts;
}

interface AgentBox {
  id: AgentId;
  open: boolean;
  mode: AgentMode | undefined;
  /** True once the session wrote transcript into the box and has not sent it since. */
  holdsText: boolean;
  /** A chat agent's transcript lines not sent yet; they go out with its next protocol message. */
  draft: string[];
  /** A chat agent's message box as the member last edited it, standing for the first `covers` lines of `draft`. */
  edited: { text: string; covers: number } | undefined;
  /** The session file this agent has been told about. */
  toldSession: string | undefined;
  /** Writes to this agent, one after another, so a control line is never overtaken by a slice. */
  queue: Promise<void>;
}

type SliceOutcome = { kind: 'text'; line: string } | { kind: 'silent' } | { kind: 'dropped' };

const DROPPED: SliceOutcome = { kind: 'dropped' };

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A slice's text as one clean transcript line; untrusted, since it comes straight from the speech engine. */
function outcomeOf(text: unknown): SliceOutcome {
  if (typeof text !== 'string') return DROPPED;
  const line = text.replace(NON_SPEECH_MARKER, ' ').replace(CONTROL_CHARACTERS, ' ').replace(WHITESPACE, ' ').trim();
  return line === '' ? { kind: 'silent' } : { kind: 'text', line };
}

function isConsent(value: unknown): value is Consent {
  const consent = value as Partial<Consent> | null;
  return typeof consent === 'object' && consent !== null && typeof consent.by === 'string' && typeof consent.at === 'string';
}

function checkedCreated(value: unknown): GrillingSession {
  const created = value as Partial<GrillingSession> | null;
  const valid =
    typeof created === 'object' &&
    created !== null &&
    isSessionId(created.id) &&
    typeof created.date === 'string' &&
    Array.isArray(created.present) &&
    created.present.every((login) => typeof login === 'string') &&
    (created.consent === null || isConsent(created.consent));
  if (!valid) {
    throw new SessionError('store', 'The store returned a session the host cannot use');
  }
  return created as GrillingSession;
}

/** Runs a store call; whatever it throws becomes a `SessionError`, `invalid` when the store refused the value. */
async function fromStore<T>(what: string, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof SessionError) throw error;
    const kind = error instanceof StoreError && error.kind === 'invalid' ? 'invalid' : 'store';
    throw new SessionError(kind, `${what}: ${messageOf(error)}`, { cause: error });
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Waits for one slice's text while it is at the head of the stream, at most `OUTLIER_AFTER_MS`. */
async function headOfStream(text: Promise<unknown>): Promise<SliceOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<SliceOutcome>((resolve) => {
    timer = setTimeout(() => resolve(DROPPED), OUTLIER_AFTER_MS);
  });
  try {
    return await Promise.race([text.then(outcomeOf, () => DROPPED), late]);
  } finally {
    clearTimeout(timer);
  }
}

export function createSessionHost(deps: SessionHostDeps): SessionHost {
  let session: RunningSession | undefined;
  let starting = false;
  const boxes = new Map<AgentId, AgentBox>();
  /** The agents whose channel is open, in opening order. */
  const channels: AgentId[] = [];

  let stopListening: Unsubscribe | undefined;
  let heardThisRecording = new Set<string>();
  /** Every slice heard, in order; each link settles once its text is in the transcript or it was left out. */
  let stream: Promise<void> = Promise.resolve();
  /** Store writes for the session, one at a time, in call order. */
  let storeQueue: Promise<unknown> = Promise.resolve();
  /** A transcript write that has not started yet; it will carry every line added before it starts. */
  let queuedTranscriptWrite: Promise<void> | undefined;

  function running(): RunningSession {
    if (!session) throw new SessionError('no-session', 'No grilling session is running');
    return session;
  }

  function inOrder<T>(call: () => Promise<T>): Promise<T> {
    const result = storeQueue.then(call);
    storeQueue = result.catch(() => undefined);
    return result;
  }

  function transcriptOf(current: RunningSession): string {
    return current.transcriptLines.join(TRANSCRIPT_LINE_SEPARATOR);
  }

  /** Writes the whole transcript; a failure is kept quiet here and shows as an unsaved transcript. */
  function writeTranscript(current: RunningSession): Promise<void> {
    if (queuedTranscriptWrite) return queuedTranscriptWrite;
    const write = inOrder(async () => {
      queuedTranscriptWrite = undefined;
      const transcript = transcriptOf(current);
      await deps.store.updateSession(current.project, current.id, { transcript });
      current.savedTranscript = transcript;
    }).catch(() => undefined);
    queuedTranscriptWrite = write;
    return write;
  }

  async function saveTranscript(current: RunningSession): Promise<void> {
    await stream;
    if (current.savedTranscript !== transcriptOf(current)) await writeTranscript(current);
    if (current.savedTranscript !== transcriptOf(current)) {
      throw new SessionError('store', 'The transcript could not be written to the session file; try again');
    }
  }

  function knownBox(agentId: AgentId): AgentBox {
    if (typeof agentId !== 'string' || !deps.agents.list().some((agent) => agent.id === agentId)) {
      throw new SessionError('unknown-agent', `No running agent with id '${String(agentId)}'`);
    }
    let box = boxes.get(agentId);
    if (!box) {
      box = {
        id: agentId,
        open: false,
        mode: undefined,
        holdsText: false,
        draft: [],
        edited: undefined,
        toldSession: undefined,
        queue: Promise.resolve(),
      };
      boxes.set(agentId, box);
    }
    return box;
  }

  function closeChannel(box: AgentBox): void {
    box.open = false;
    const at = channels.indexOf(box.id);
    if (at >= 0) channels.splice(at, 1);
  }

  function inBox<T>(box: AgentBox, write: () => T | Promise<T>): Promise<T> {
    const result = box.queue.then(write);
    box.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  function agentGone(box: AgentBox, error: unknown): SessionError {
    closeChannel(box);
    return new SessionError('unknown-agent', `The agent '${box.id}' has gone: ${messageOf(error)}`, { cause: error });
  }

  function typeOrRefuse(box: AgentBox, text: string): void {
    try {
      deps.agents.write(box.id, text);
    } catch (error) {
      throw agentGone(box, error);
    }
  }

  /** Keeps a chat agent's held words and tells its chat view, so the message box shows them as they are spoken. */
  function setDraft(box: AgentBox, draft: string[]): void {
    const changed = draft.length > 0 || box.draft.length > 0;
    box.draft = draft;
    if (changed) deps.held?.(box.id, draft.join(TRANSCRIPT_LINE_SEPARATOR), false);
  }

  /** A chat agent's box, for the calls its message box makes with the held words it showed. */
  function chatBox(agentId: AgentId, shownHeld: unknown): AgentBox {
    const box = knownBox(agentId);
    if (typeof shownHeld !== 'string') throw new SessionError('invalid', 'The held words shown are text');
    if (deps.agents.choice !== 'chat') throw new SessionError('invalid', 'Only a chat agent has a message box');
    return box;
  }

  /** How many of the first held lines the box showed, or undefined when they are no longer the first ones held. */
  function shownLines(box: AgentBox, shownHeld: string): number | undefined {
    const shown = shownHeld === '' ? [] : shownHeld.split(TRANSCRIPT_LINE_SEPARATOR);
    return shown.every((line, at) => box.draft[at] === line) ? shown.length : undefined;
  }

  /** The box left the chat view another way (Send, an answer): the words it showed and the member's edit go with it. */
  function dropShown(box: AgentBox, shownHeld: string): void {
    box.edited = undefined;
    const shown = shownLines(box, shownHeld);
    if (shown !== undefined && shown > 0) setDraft(box, box.draft.slice(shown));
  }

  /**
   * A chat agent's protocol message: what its message box shows (the member's edit, if any, then the words held
   * since), then the control line on a line of its own. The box is empty afterwards.
   */
  async function sendChatMessage(box: AgentBox, controlLine: string): Promise<void> {
    const { edited, draft } = box;
    const boxLines = edited ? [edited.text, ...draft.slice(edited.covers)].filter((line) => line !== '') : draft;
    const message = [...boxLines, controlLine].join(TRANSCRIPT_LINE_SEPARATOR);
    box.edited = undefined;
    box.draft = [];
    if (edited !== undefined || draft.length > 0) deps.held?.(box.id, '', true);
    try {
      await deps.agents.send(box.id, message);
    } catch (error) {
      throw agentGone(box, error);
    }
  }

  /** One protocol message: the control line on a line of its own below any transcript, then Enter. */
  function sendControlLine(box: AgentBox, controlLine: string): Promise<void> {
    return inBox(box, async () => {
      if (deps.agents.choice === 'chat') {
        await sendChatMessage(box, controlLine);
        return;
      }
      typeOrRefuse(box, box.holdsText ? LINE_BREAK + controlLine : controlLine);
      // Claude Code swallows an Enter that arrives before it has echoed the text typed just before it.
      await delay(ENTER_AFTER_QUIET_MS);
      typeOrRefuse(box, ENTER);
      box.holdsText = false;
    });
  }

  /** Tells the agent the session file once; the promise settles once the line is typed. */
  function sendSessionLine(box: AgentBox, current: RunningSession): Promise<void> {
    if (box.toldSession === current.file) return Promise.resolve();
    box.toldSession = current.file;
    return sendControlLine(box, sessionLine(current.file));
  }

  function tellSession(box: AgentBox, current: RunningSession): void {
    sendSessionLine(box, current).catch(() => undefined);
  }

  function writeSliceToChannels(line: string): void {
    for (const id of [...channels]) {
      const box = boxes.get(id);
      if (!box || box.mode === 'type') continue;
      void inBox(box, () => {
        if (!box.open) return;
        if (deps.agents.choice === 'chat') {
          setDraft(box, [...box.draft, line]);
          return;
        }
        try {
          deps.agents.write(id, box.holdsText ? LINE_BREAK + line : line);
          box.holdsText = true;
        } catch {
          closeChannel(box);
        }
      });
    }
  }

  function apply(current: RunningSession, outcome: SliceOutcome): void {
    if (outcome.kind === 'dropped') {
      current.slices.dropped += 1;
      return;
    }
    if (outcome.kind === 'silent') {
      current.slices.silent += 1;
      return;
    }
    current.slices.transcribed += 1;
    current.transcriptLines.push(outcome.line);
    void writeTranscript(current);
    writeSliceToChannels(outcome.line);
  }

  function hear(current: RunningSession, slice: AudioSlice): void {
    const key = `${slice.source}:${slice.index}`;
    if (heardThisRecording.has(key)) return;
    heardThisRecording.add(key);
    current.slices.heard += 1;
    const text = Promise.resolve().then(() => deps.transcriber.transcribe(slice.pcm));
    text.catch(() => undefined);
    stream = stream.then(async () => apply(current, await headOfStream(text))).catch(() => undefined);
  }

  async function stopRecording(current: RunningSession): Promise<void> {
    if (stopListening) {
      stopListening();
      stopListening = undefined;
    }
    await saveTranscript(current);
  }

  function snapshot(current: RunningSession): SessionState {
    return {
      project: current.project,
      id: current.id,
      file: current.file,
      date: current.date,
      present: [...current.present],
      consent: current.consent ? { ...current.consent } : null,
      recording: stopListening !== undefined,
      channels: [...channels],
      transcript: transcriptOf(current),
      slices: { ...current.slices },
    };
  }

  return {
    async startSession(project) {
      if (session || starting) throw new SessionError('session-running', 'A grilling session is already running');
      if (typeof project !== 'string' || project === '') {
        throw new SessionError('invalid', 'A session needs the project it belongs to');
      }
      starting = true;
      try {
        const created = checkedCreated(
          await fromStore('The session could not be started', () => deps.store.createSession(project, { present: [] })),
        );
        const current: RunningSession = {
          project,
          id: created.id,
          file: GRILLO_FILES.session(created.id),
          date: created.date,
          present: [...created.present],
          consent: created.consent,
          transcriptLines: [],
          savedTranscript: '',
          slices: { heard: 0, transcribed: 0, silent: 0, dropped: 0 },
        };
        session = current;
        for (const id of channels) {
          const box = boxes.get(id);
          if (box) tellSession(box, current);
        }
        return snapshot(current);
      } finally {
        starting = false;
      }
    },

    async setPresent(logins) {
      const current = running();
      if (!Array.isArray(logins) || !logins.every(isLogin)) {
        throw new SessionError('invalid', 'Presence is a list of GitHub logins');
      }
      const present = logins.filter((login, at) => logins.findIndex((other) => sameLogin(other, login)) === at);
      await fromStore('Presence could not be recorded', () =>
        inOrder(() => deps.store.updateSession(current.project, current.id, { present })),
      );
      current.present = present;
    },

    async tickConsent(login) {
      const current = running();
      if (!isLogin(login)) throw new SessionError('invalid', 'Consent is ticked by a GitHub login');
      if (current.consent) return;
      const host = await fromStore('The host could not be read', () => deps.store.currentMember(current.project));
      if (!sameLogin(host.login, login)) {
        throw new SessionError('not-host', `Only the host signed in on this laptop (${host.login}) ticks consent`);
      }
      const updated = await fromStore('Consent could not be recorded', () =>
        inOrder(() => deps.store.updateSession(current.project, current.id, { consent: true })),
      );
      const consent = (updated as Partial<GrillingSession> | null)?.consent;
      if (!isConsent(consent)) throw new SessionError('store', 'The store did not record the consent tick');
      current.consent = { by: consent.by, at: consent.at };
    },

    async setRecording(on) {
      const current = running();
      if (typeof on !== 'boolean') throw new SessionError('invalid', 'The recording switch is on or off');
      if (!on) {
        await stopRecording(current);
        return;
      }
      if (!current.consent) {
        throw new SessionError('no-consent', 'Record stays disabled until the host ticks "everyone here agreed"');
      }
      if (stopListening) return;
      heardThisRecording = new Set();
      stopListening = deps.slices.subscribe((slice) => hear(current, slice));
    },

    async endSession() {
      const current = running();
      await stopRecording(current);
      for (const id of [...channels]) {
        const box = boxes.get(id);
        if (box) closeChannel(box);
      }
      await storeQueue;
      session = undefined;
    },

    async setChannel(agentId, open) {
      if (typeof open !== 'boolean') throw new SessionError('invalid', 'A channel is open or closed');
      if (!open) {
        const box = boxes.get(agentId);
        if (box) closeChannel(box);
        return;
      }
      const box = knownBox(agentId);
      if (!box.open) {
        box.open = true;
        channels.push(box.id);
      }
      if (session) tellSession(box, session);
    },

    channels() {
      return [...channels];
    },

    tellSession(agentId) {
      return Promise.resolve().then(() => {
        const current = running();
        return sendSessionLine(knownBox(agentId), current);
      });
    },

    sendBox(agentId, text, shownHeld) {
      return Promise.resolve().then(() => {
        const box = chatBox(agentId, shownHeld);
        if (typeof text !== 'string' || text.trim() === '') throw new SessionError('invalid', 'A message cannot be empty');
        return inBox(box, async () => {
          dropShown(box, shownHeld);
          try {
            await deps.agents.send(box.id, text);
          } catch (error) {
            throw agentGone(box, error);
          }
        });
      });
    },

    releaseHeld(agentId, shownHeld) {
      return Promise.resolve().then(() => {
        const box = chatBox(agentId, shownHeld);
        return inBox(box, () => dropShown(box, shownHeld));
      });
    },

    editBox(agentId, text, shownHeld) {
      return Promise.resolve().then(() => {
        const box = chatBox(agentId, shownHeld);
        if (typeof text !== 'string') throw new SessionError('invalid', 'The message box holds text');
        // In line with the box's messages, so an edit made after a Send or Use it never comes before it.
        return inBox(box, () => {
          const covers = shownLines(box, shownHeld);
          // An edit of words already sent arrives late: the box it describes has gone, so it is dropped.
          if (covers !== undefined) box.edited = { text: text.trim(), covers };
        });
      });
    },

    useIt(agentId) {
      return Promise.resolve().then(() => sendControlLine(knownBox(agentId), USE_IT));
    },

    typeMode(agentId, mode) {
      return Promise.resolve().then(() => {
        const box = knownBox(agentId);
        if (!isAgentMode(mode)) throw new SessionError('invalid', `'${String(mode)}' is not a mode: listen or type`);
        box.mode = mode;
        return sendControlLine(box, modeLine(mode));
      });
    },

    typePresent(agentId, logins) {
      return Promise.resolve().then(() => {
        const box = knownBox(agentId);
        if (!Array.isArray(logins) || !logins.every(isLogin)) {
          throw new SessionError('invalid', 'Presence is a list of GitHub logins');
        }
        return sendControlLine(box, presentLine(logins));
      });
    },

    skip(agentId) {
      return Promise.resolve().then(() => sendControlLine(knownBox(agentId), SKIP));
    },

    jump(agentId, ticket) {
      return Promise.resolve().then(() => {
        const box = knownBox(agentId);
        if (!Number.isInteger(ticket) || ticket < 1) {
          throw new SessionError('invalid', `'${String(ticket)}' is not a ticket number`);
        }
        return sendControlLine(box, jumpLine(ticket));
      });
    },

    state() {
      return session ? snapshot(session) : null;
    },
  };
}
