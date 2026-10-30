import { randomUUID } from 'node:crypto';
import { posix, win32 } from 'node:path';
import {
  AGENT_KINDS,
  type AgentId,
  type AgentInfo,
  type AgentRuntimeChoice,
  type StartAgentRequest,
} from '../../../shared/agents';

/** How long an agent must stay silent after output before its tab shows the waiting dot (issue 64 decision). */
export const WAITING_AFTER_MS = 3000;
/**
 * After typing the first message, Enter is pressed only once its echo has appeared and the terminal has then been
 * quiet this long. Claude Code echoes a typed message slowly, more slowly the longer it is, and an Enter that
 * arrives before the echo has finished is swallowed: the message stays in the input box unsent. Right after the
 * folder-trust question Claude Code can stay busy, and silent, for seconds before it echoes anything (issue 177),
 * so quiet alone never means the echo is done.
 */
export const ENTER_AFTER_QUIET_MS = 500;
/** How long to wait for the typed first message to show before pressing Enter anyway, so it is never left unsent. */
export const ECHO_WAIT_MS = 10_000;
/** The terminal's size until the terminal view sends its own. */
export const INITIAL_COLS = 120;
export const INITIAL_ROWS = 30;
/** Enough of the latest output to hold Claude Code's whole input box while looking for its prompt. */
const PROMPT_SCAN_CHARS = 4000;
/** How many characters of output per typed character an echo may take, escape codes and redraws included. */
const ECHO_SCAN_FACTOR = 4;
/**
 * Claude Code's input box, once escape codes and spaces are removed: a horizontal rule followed directly by the
 * prompt glyph. Its startup questions (trust this folder, use this MCP server) show the same glyph beside an
 * option, never right after a rule, so the first message is never typed into one of them.
 */
const PROMPT_SIGNATURE = '─❯';
const ENTER = '\r';
const CLAUDE_COMMAND = 'claude';

/** The part of a node-pty terminal the runtime uses. */
export interface Pty {
  onData(listener: (data: string) => void): unknown;
  onExit(listener: (event: { exitCode: number }) => void): unknown;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}

export interface PtySpawnOptions {
  cwd: string;
  cols: number;
  rows: number;
  env: Record<string, string | undefined>;
}

export type SpawnPty = (file: string, args: string[], options: PtySpawnOptions) => Pty;

export interface AgentRuntimeEvents {
  output(id: AgentId, data: string): void;
  exited(id: AgentId, exitCode: number): void;
  listChanged(list: AgentInfo[]): void;
}

export interface AgentRuntimeDeps {
  /** The full path of the member's `claude`; throws ClaudeNotFoundError when there is none. */
  findClaude(): string;
  /** Copies Grillo's skills into the project folder. */
  shipSkills(folder: string): Promise<void>;
  spawnPty: SpawnPty;
  env: Record<string, string | undefined>;
  events: AgentRuntimeEvents;
}

export interface AgentRuntime {
  /** Which runtime this is: every agent tab it starts runs this way. */
  readonly choice: AgentRuntimeChoice;
  startAgent(request: StartAgentRequest): Promise<AgentId>;
  /** Types raw text into the agent's terminal. A chat agent has no terminal and refuses it. */
  write(id: AgentId, text: string): void;
  /**
   * Sends one whole, non-empty message: a chat message, or on a terminal agent the text, then Enter once the text's
   * echo has appeared and the terminal has gone quiet.
   */
  send(id: AgentId, text: string): Promise<void>;
  /**
   * Resolves once the agent takes input: on a terminal agent, once Claude Code's prompt is up and the first message
   * has been sent, never while a start-up question shows. Rejects if the agent ends first or is unknown.
   */
  ready(id: AgentId): Promise<void>;
  resize(id: AgentId, cols: number, rows: number): void;
  /** Ends the agent's Claude Code. Does nothing for an agent that is already gone. */
  stop(id: AgentId): void;
  stopAll(): void;
  setTitle(id: AgentId, title: string): void;
  list(): AgentInfo[];
}

export class ClaudeNotFoundError extends Error {
  constructor() {
    super(
      'Claude Code was not found: there is no `claude` command on PATH. ' +
        'Install Claude Code, sign in with your Claude subscription, then start the agent again.',
    );
    this.name = 'ClaudeNotFoundError';
  }
}

/** Text typed into the terminal whose Enter waits for its echo to settle. */
interface EchoWait {
  /** Takes the agent's next output. */
  watch(data: string): void;
  /** Stops waiting at once, without pressing Enter: the agent has gone. */
  cancel(): void;
}

interface RunningAgent {
  info: AgentInfo;
  pty: Pty;
  firstMessage: string;
  /** The latest output, kept only until the prompt has appeared. */
  promptScan: string | undefined;
  /** Typed text waiting for its echo to settle before Enter: the first message's and each sent message's. */
  echoWaits: Set<EchoWait>;
  waitingTimer: ReturnType<typeof setTimeout> | undefined;
  /** Settles once the agent takes input (`ready`). */
  readiness: { promise: Promise<void>; resolve(): void; reject(error: Error): void };
}

// eslint-disable-next-line no-control-regex -- terminal escape sequences start with the ESC control character
const ESCAPE_SEQUENCE = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[()][0-9A-Za-z]|[@-_])/g;
const WHITESPACE = /\s+/g;

/** The text as Claude Code's screen shows it, with escape codes and spaces removed, so line wrapping never matters. */
function visibleText(output: string): string {
  return output.replace(ESCAPE_SEQUENCE, '').replace(WHITESPACE, '');
}

function showsPrompt(output: string): boolean {
  return visibleText(output).includes(PROMPT_SIGNATURE);
}

function isNonEmptyText(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

/** Throws unless the start request has a known kind, a folder, a title and a first message. */
export function assertValidStartRequest(request: StartAgentRequest): void {
  const valid =
    typeof request === 'object' &&
    request !== null &&
    (AGENT_KINDS as readonly unknown[]).includes(request.kind) &&
    isNonEmptyText(request.folder) &&
    typeof request.title === 'string' &&
    typeof request.firstMessage === 'string';
  if (!valid) {
    throw new Error('Invalid agent start request: it needs a known kind, a folder, a title and a first message');
  }
}

/** Throws unless the text is a message worth sending. */
export function assertSendableMessage(text: unknown): asserts text is string {
  if (typeof text !== 'string' || text === '') {
    throw new Error('A message cannot be empty');
  }
}

function isTerminalDimension(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

function readiness(): RunningAgent['readiness'] {
  let resolve: () => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  const promise = new Promise<void>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  // A readiness nobody asked for must not surface as an unhandled rejection when its agent ends.
  promise.catch(() => undefined);
  return { promise, resolve, reject };
}

function gone(id: AgentId): Error {
  return new Error(`The agent '${id}' has gone`);
}

export function createAgentRuntime(deps: AgentRuntimeDeps): AgentRuntime {
  const agents = new Map<AgentId, RunningAgent>();

  const announce = (): void => deps.events.listChanged(list());

  function list(): AgentInfo[] {
    return [...agents.values()].map(({ info }) => ({ ...info }));
  }

  function find(id: AgentId): RunningAgent {
    const agent = agents.get(id);
    if (!agent) {
      throw new Error(`No agent with id '${id}'`);
    }
    return agent;
  }

  function forget(agent: RunningAgent): void {
    clearTimeout(agent.waitingTimer);
    for (const wait of [...agent.echoWaits]) wait.cancel();
    agent.readiness.reject(gone(agent.info.id));
    agents.delete(agent.info.id);
  }

  /**
   * Types the text, then presses Enter once its echo has appeared (or ECHO_WAIT_MS have passed without it) and the
   * terminal has then been quiet for ENTER_AFTER_QUIET_MS; `entered` runs right after the Enter.
   */
  function typeThenEnter(agent: RunningAgent, text: string, done: { entered(): void; cancelled(): void }): void {
    // The scan holds the whole echo, however long the text: Claude Code redraws its input box around it.
    const scanChars = Math.max(PROMPT_SCAN_CHARS, ECHO_SCAN_FACTOR * text.length);
    const expected = visibleText(text);
    let scan = '';
    let echoed = false;
    let quietTimer: ReturnType<typeof setTimeout> | undefined;
    const stop = (): void => {
      clearTimeout(echoTimer);
      clearTimeout(quietTimer);
      agent.echoWaits.delete(wait);
    };
    const enterOnceQuiet = (): void => {
      echoed = true;
      clearTimeout(echoTimer);
      clearTimeout(quietTimer);
      quietTimer = setTimeout(() => {
        stop();
        agent.pty.write(ENTER);
        done.entered();
      }, ENTER_AFTER_QUIET_MS);
    };
    const echoTimer = setTimeout(enterOnceQuiet, ECHO_WAIT_MS);
    const wait: EchoWait = {
      watch(data) {
        if (echoed) {
          enterOnceQuiet();
          return;
        }
        scan = (scan + data).slice(-scanChars);
        if (visibleText(scan).includes(expected)) enterOnceQuiet();
      },
      cancel() {
        stop();
        done.cancelled();
      },
    };
    agent.echoWaits.add(wait);
    agent.pty.write(text);
  }

  function typeFirstMessageOnPrompt(agent: RunningAgent, data: string): void {
    if (agent.promptScan === undefined) {
      return;
    }
    agent.promptScan = (agent.promptScan + data).slice(-PROMPT_SCAN_CHARS);
    if (!showsPrompt(agent.promptScan)) {
      return;
    }
    agent.promptScan = undefined;
    if (agent.firstMessage === '') {
      agent.readiness.resolve();
      return;
    }
    typeThenEnter(agent, agent.firstMessage, { entered: () => agent.readiness.resolve(), cancelled: () => undefined });
  }

  function restartWaitingTimer(agent: RunningAgent): void {
    if (agent.info.waiting) {
      agent.info.waiting = false;
      announce();
    }
    clearTimeout(agent.waitingTimer);
    agent.waitingTimer = setTimeout(() => {
      agent.info.waiting = true;
      announce();
    }, WAITING_AFTER_MS);
  }

  async function startAgent(request: StartAgentRequest): Promise<AgentId> {
    assertValidStartRequest(request);
    const claude = deps.findClaude();
    await deps.shipSkills(request.folder);

    const pty = deps.spawnPty(claude, [], {
      cwd: request.folder,
      cols: INITIAL_COLS,
      rows: INITIAL_ROWS,
      env: deps.env,
    });
    const id = randomUUID();
    const agent: RunningAgent = {
      info: { id, kind: request.kind, title: request.title, folder: request.folder, waiting: false },
      pty,
      firstMessage: request.firstMessage,
      promptScan: '',
      echoWaits: new Set(),
      waitingTimer: undefined,
      readiness: readiness(),
    };
    agents.set(id, agent);

    pty.onData((data) => {
      if (agents.get(id) !== agent) {
        return;
      }
      deps.events.output(id, data);
      for (const wait of [...agent.echoWaits]) wait.watch(data);
      typeFirstMessageOnPrompt(agent, data);
      restartWaitingTimer(agent);
    });
    pty.onExit(({ exitCode }) => {
      if (agents.get(id) !== agent) {
        return;
      }
      forget(agent);
      deps.events.exited(id, exitCode);
      announce();
    });

    announce();
    return id;
  }

  function stop(id: AgentId): void {
    const agent = agents.get(id);
    if (!agent) {
      return;
    }
    forget(agent);
    agent.pty.kill();
    announce();
  }

  /**
   * Types the message, then presses Enter as a write of its own (Claude Code reads both in one write as a paste),
   * once the echo has settled: an Enter that arrives earlier, as on a long line, is swallowed.
   */
  function send(id: AgentId, text: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const agent = find(id);
      assertSendableMessage(text);
      typeThenEnter(agent, text, { entered: resolve, cancelled: () => reject(gone(id)) });
    });
  }

  return {
    choice: 'terminal',
    startAgent,
    write(id, text) {
      find(id).pty.write(text);
    },
    send,
    ready(id) {
      const agent = agents.get(id);
      return agent ? agent.readiness.promise : Promise.reject(new Error(`No agent with id '${id}'`));
    },
    resize(id, cols, rows) {
      const agent = find(id);
      if (!isTerminalDimension(cols) || !isTerminalDimension(rows)) {
        throw new Error(`Invalid terminal size: ${cols} columns by ${rows} rows`);
      }
      agent.pty.resize(cols, rows);
    },
    stop,
    stopAll() {
      for (const id of [...agents.keys()]) {
        stop(id);
      }
    },
    setTitle(id, title) {
      find(id).info.title = title;
      announce();
    },
    list,
  };
}

/** Reads an environment variable whatever the case of its name, as Windows does. */
function envValue(env: Record<string, string | undefined>, name: string): string | undefined {
  const key = Object.keys(env).find((candidate) => candidate.toUpperCase() === name);
  return key === undefined ? undefined : env[key];
}

/**
 * The full path of the first `claude` on PATH. On Windows each PATHEXT extension is tried (claude.exe from the
 * native installer, claude.cmd from npm), because a terminal cannot start a bare name there.
 */
export function findClaude(
  env: Record<string, string | undefined>,
  platform: NodeJS.Platform,
  isFile: (path: string) => boolean,
): string {
  const isWindows = platform === 'win32';
  const path = isWindows ? win32 : posix;
  const folders = (envValue(env, 'PATH') ?? '').split(path.delimiter).filter((folder) => folder !== '');
  const names = isWindows
    ? (envValue(env, 'PATHEXT') ?? '').split(';').filter((ext) => ext !== '').map((ext) => CLAUDE_COMMAND + ext.toLowerCase())
    : [CLAUDE_COMMAND];

  for (const folder of folders) {
    for (const name of names) {
      const candidate = path.join(folder, name);
      if (isFile(candidate)) {
        return candidate;
      }
    }
  }
  throw new ClaudeNotFoundError();
}
