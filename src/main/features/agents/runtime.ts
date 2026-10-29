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
 * After typing the first message, Enter is pressed only once the terminal has been quiet this long. Claude Code
 * echoes a typed message slowly, more slowly the longer it is, and an Enter that arrives before the echo has
 * finished is swallowed: the message stays in the input box unsent.
 */
export const ENTER_AFTER_QUIET_MS = 500;
/** The terminal's size until the terminal view sends its own. */
export const INITIAL_COLS = 120;
export const INITIAL_ROWS = 30;
/** Enough of the latest output to hold Claude Code's whole input box while looking for its prompt. */
const PROMPT_SCAN_CHARS = 4000;
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
  /** Sends one whole, non-empty message: a chat message, or on a terminal agent the text, then Enter. */
  send(id: AgentId, text: string): Promise<void>;
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

interface RunningAgent {
  info: AgentInfo;
  pty: Pty;
  firstMessage: string;
  /** The latest output, kept only until the prompt has appeared. */
  promptScan: string | undefined;
  waitingTimer: ReturnType<typeof setTimeout> | undefined;
  /** Set from typing the first message until its Enter is pressed. */
  enterTimer: ReturnType<typeof setTimeout> | undefined;
}

// eslint-disable-next-line no-control-regex -- terminal escape sequences start with the ESC control character
const ESCAPE_SEQUENCE = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[()][0-9A-Za-z]|[@-_])/g;
const WHITESPACE = /\s+/g;

function showsPrompt(output: string): boolean {
  return output.replace(ESCAPE_SEQUENCE, '').replace(WHITESPACE, '').includes(PROMPT_SIGNATURE);
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
    clearTimeout(agent.enterTimer);
    agents.delete(agent.info.id);
  }

  function pressEnterOnceQuiet(agent: RunningAgent): void {
    clearTimeout(agent.enterTimer);
    agent.enterTimer = setTimeout(() => {
      agent.enterTimer = undefined;
      agent.pty.write(ENTER);
    }, ENTER_AFTER_QUIET_MS);
  }

  function typeFirstMessageOnPrompt(agent: RunningAgent, data: string): void {
    if (agent.enterTimer !== undefined) {
      pressEnterOnceQuiet(agent);
      return;
    }
    if (agent.promptScan === undefined) {
      return;
    }
    agent.promptScan = (agent.promptScan + data).slice(-PROMPT_SCAN_CHARS);
    if (!showsPrompt(agent.promptScan)) {
      return;
    }
    agent.promptScan = undefined;
    if (agent.firstMessage === '') {
      return;
    }
    agent.pty.write(agent.firstMessage);
    pressEnterOnceQuiet(agent);
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
      waitingTimer: undefined,
      enterTimer: undefined,
    };
    agents.set(id, agent);

    pty.onData((data) => {
      if (agents.get(id) !== agent) {
        return;
      }
      deps.events.output(id, data);
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

  /** Types the message, then presses Enter as a write of its own (Claude Code reads both in one write as a paste). */
  async function send(id: AgentId, text: string): Promise<void> {
    const agent = find(id);
    assertSendableMessage(text);
    agent.pty.write(text);
    agent.pty.write(ENTER);
  }

  return {
    choice: 'terminal',
    startAgent,
    write(id, text) {
      find(id).pty.write(text);
    },
    send,
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
