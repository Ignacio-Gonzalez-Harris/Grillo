import { randomUUID } from 'node:crypto';
import type {
  ChatActionResult,
  ChatAgentId,
  ChatAnswer,
  ChatMessage,
  ChatQuestionItem,
  StartChatAgentRequest,
} from '../../../shared/agent-chat';
import { AGENT_ID_VARIABLE, AGENT_KINDS } from '../../../shared/agents';
import { createLineSplitter, parseEventLine, type StreamEvent } from './stream';

/**
 * How a chat agent runs: the member's own `claude` in machine-readable mode (PRD section 8, decision [I2]). The flags
 * are pinned. `--bare` is never passed: it would skip the member's user-level `CLAUDE.md` and subscription login.
 * `--permission-prompt-tool stdio` makes Claude Code send every permission prompt and clickable-options question to
 * Grillo as a control request; without it the `AskUserQuestion` tool is not offered at all.
 */
export const CHAT_FLAGS: readonly string[] = [
  '-p',
  '--input-format',
  'stream-json',
  '--output-format',
  'stream-json',
  '--verbose',
  '--permission-prompt-tool',
  'stdio',
  '--permission-mode',
  'manual',
];

/** Sent to Claude Code when the member says no to a tool or dismisses a question. */
const DENIED_MESSAGE = 'The member said no.';

/** How much of Claude Code's own error text (stderr) a failed end shows: its last lines, each cut to a length. */
const ERROR_LINES_SHOWN = 10;
const ERROR_LINE_LENGTH = 160;
/** Terminal colour and cursor codes, which mean nothing in a chat. */
const ESCAPE = String.fromCharCode(27);
const TERMINAL_CODES = new RegExp(`${ESCAPE}\\[[0-9;?]*[A-Za-z]`, 'g');

/** The chat messages after which the agent waits for the member, until it is at work again. */
const WAITING_MESSAGES: ReadonlySet<ChatMessage['type']> = new Set(['result', 'question', 'permission']);

/** The part of a child process the driver uses: stdout as text, stdin, and its end. */
export interface ChatProcess {
  onStdout(listener: (chunk: string) => void): void;
  /** Its own error text (stderr), as text. */
  onStderr(listener: (chunk: string) => void): void;
  /** Null when the process could not start or was killed by a signal. */
  onExit(listener: (exitCode: number | null) => void): void;
  write(data: string): void;
  stop(): void;
}

export interface ChatSpawnOptions {
  cwd: string;
  env: Record<string, string | undefined>;
}

export type SpawnChatProcess = (file: string, args: readonly string[], options: ChatSpawnOptions) => ChatProcess;

export interface ChatDriverEvents {
  message(id: ChatAgentId, message: ChatMessage): void;
  raw(id: ChatAgentId, line: string): void;
  exited(id: ChatAgentId, exitCode: number | null): void;
}

export interface ChatDriverDeps {
  /** The full path of the member's `claude`; throws ClaudeNotFoundError when there is none. */
  findClaude(): string;
  /** Copies Grillo's skills into the project folder. */
  shipSkills(folder: string): Promise<void>;
  spawnProcess: SpawnChatProcess;
  env: Record<string, string | undefined>;
  events: ChatDriverEvents;
}

/**
 * The one way Grillo talks to a chat agent. This module holds its only implementation, over the `claude` CLI; the
 * Agent SDK can replace it by implementing this interface in one module.
 */
export interface ChatDriver {
  startChatAgent(request: StartChatAgentRequest): Promise<ChatAgentId>;
  /** Writes one message into the agent's input, as if the member typed it. */
  send(id: ChatAgentId, text: string): ChatActionResult;
  /** Answers a `question` message with the chosen option (or free text). */
  answer(id: string, option: ChatAnswer): ChatActionResult;
  /** Lets the tool of a `permission` message run. */
  allow(id: string): ChatActionResult;
  /** Refuses a `permission` message, or dismisses a `question`. */
  deny(id: string): ChatActionResult;
  /**
   * Ends the agent's Claude Code without reporting an exit; says whether it was running. Does nothing for an agent
   * that is already gone.
   */
  stop(id: ChatAgentId): boolean;
  stopAll(): void;
}

interface PendingRequest {
  agentId: ChatAgentId;
  kind: 'question' | 'permission';
  input: Record<string, unknown>;
  questions: ChatQuestionItem[];
}

interface RunningChatAgent {
  id: ChatAgentId;
  process: ChatProcess;
  /** Every control request id Claude Code has sent, so a repeated one is caught. */
  seenRequestIds: Set<string>;
  /** Ids of the control requests Grillo sent and Claude Code has not answered yet. */
  awaitingResponses: Set<string>;
  /** Whether the agent was last shown waiting for the member, so its next tool event says it works again. */
  waiting: boolean;
  /** The last lines of Claude Code's own error text, shown if it ends badly. */
  errorLines: string[];
}

const refused = (reason: string): ChatActionResult => ({ ok: false, reason });
const OK: ChatActionResult = { ok: true };

/** The failed end of a chat agent, with the last lines of Claude Code's own error text. */
function failedEnd(exitCode: number | null, errorLines: readonly string[]): string {
  const ended =
    exitCode === null
      ? 'Claude Code could not start, or was ended from outside.'
      : `Claude Code stopped with exit code ${exitCode}.`;
  return errorLines.length === 0
    ? `${ended} It printed no error text.`
    : `${ended} The last lines of its error text:\n${errorLines.join('\n')}`;
}

function assertValidRequest(request: StartChatAgentRequest): void {
  const valid =
    typeof request === 'object' &&
    request !== null &&
    (AGENT_KINDS as readonly unknown[]).includes(request.kind) &&
    typeof request.folder === 'string' &&
    request.folder !== '' &&
    typeof request.firstMessage === 'string';
  if (!valid) {
    throw new Error('Invalid chat agent start request: it needs a known kind, a folder and a first message');
  }
}

/** The `answers` field Claude Code expects: question text → chosen label, for every question asked. */
function answersFor(questions: ChatQuestionItem[], option: ChatAnswer): Record<string, string> | string {
  if (typeof option === 'string') {
    if (option === '') return 'An answer cannot be empty';
    if (questions.length !== 1) return 'This prompt asks several questions: answer each one by its question text';
    return { [questions[0].question]: option };
  }
  if (typeof option !== 'object' || option === null) {
    return 'An answer must be text, or question text mapped to answers';
  }
  const asked = new Set(questions.map(({ question }) => question));
  const entries = Object.entries(option);
  const complete =
    entries.length === asked.size &&
    entries.every(([question, answer]) => asked.has(question) && typeof answer === 'string' && answer !== '');
  return complete ? { ...option } : 'Every question needs exactly one non-empty answer';
}

export function createClaudeChatDriver(deps: ChatDriverDeps): ChatDriver {
  const agents = new Map<ChatAgentId, RunningChatAgent>();
  const pending = new Map<string, PendingRequest>();

  function writeLine(agent: RunningChatAgent, event: unknown): void {
    agent.process.write(`${JSON.stringify(event)}\n`);
  }

  function respond(agent: RunningChatAgent, requestId: string, response: unknown): void {
    writeLine(agent, { type: 'control_response', response: { subtype: 'success', request_id: requestId, response } });
  }

  function forget(agent: RunningChatAgent): void {
    agents.delete(agent.id);
    for (const [requestId, request] of pending) {
      if (request.agentId === agent.id) pending.delete(requestId);
    }
  }

  /** Hands one message on, keeping track of whether it leaves the agent waiting for the member. */
  function say(agent: RunningChatAgent, message: ChatMessage): void {
    if (WAITING_MESSAGES.has(message.type)) agent.waiting = true;
    else if (message.type !== 'error') agent.waiting = false;
    deps.events.message(agent.id, message);
  }

  function writeUserMessage(agent: RunningChatAgent, text: string): void {
    writeLine(agent, { type: 'user', message: { role: 'user', content: text } });
    say(agent, { type: 'user', text });
  }

  /** Answers the pending request `id` and says the agent works on. */
  function settle(agent: RunningChatAgent, id: string, response: unknown): ChatActionResult {
    pending.delete(id);
    respond(agent, id, response);
    say(agent, { type: 'answered', id });
    return OK;
  }

  /** Drops a request Claude Code withdrew. One it already had answered, or withdrew before, needs nothing more. */
  function cancel(agent: RunningChatAgent, requestId: string): void {
    const request = pending.get(requestId);
    if (request?.agentId === agent.id) {
      pending.delete(requestId);
      say(agent, { type: 'cancelled', id: requestId });
    } else if (!agent.seenRequestIds.has(requestId)) {
      say(agent, { type: 'error', message: `Claude Code withdrew request '${requestId}', which it never sent` });
    }
  }

  /** Takes a control request once; a repeated id is an error and is not answered again. */
  function claimRequestId(agent: RunningChatAgent, requestId: string): boolean {
    if (agent.seenRequestIds.has(requestId) || pending.has(requestId)) {
      say(agent, { type: 'error', message: `Claude Code repeated request '${requestId}'` });
      return false;
    }
    agent.seenRequestIds.add(requestId);
    return true;
  }

  function handle(agent: RunningChatAgent, event: StreamEvent): void {
    const tell = (message: ChatMessage): void => say(agent, message);
    switch (event.kind) {
      case 'init':
        tell({ type: 'init', sessionId: event.sessionId, model: event.model, tools: event.tools });
        return;
      case 'assistant':
        tell({ type: 'assistant', text: event.text });
        return;
      case 'result':
        tell({ type: 'result', isError: event.isError, text: event.text });
        return;
      case 'question':
        if (!claimRequestId(agent, event.requestId)) return;
        pending.set(event.requestId, { agentId: agent.id, kind: 'question', input: event.input, questions: event.questions });
        tell({ type: 'question', id: event.requestId, questions: event.questions });
        return;
      case 'permission':
        if (!claimRequestId(agent, event.requestId)) return;
        pending.set(event.requestId, { agentId: agent.id, kind: 'permission', input: event.input, questions: [] });
        tell({
          type: 'permission',
          id: event.requestId,
          toolName: event.toolName,
          input: event.input,
          description: event.description,
        });
        return;
      case 'refused-request':
        if (!claimRequestId(agent, event.requestId)) return;
        writeLine(agent, {
          type: 'control_response',
          response: { subtype: 'error', request_id: event.requestId, error: event.message },
        });
        tell({ type: 'error', message: event.message });
        return;
      case 'control-response':
        if (!agent.awaitingResponses.delete(event.requestId)) {
          tell({ type: 'error', message: `Claude Code answered request '${event.requestId}', which Grillo never sent` });
        } else if (event.error !== undefined) {
          tell({ type: 'error', message: `Claude Code refused to open the chat: ${event.error}` });
        }
        return;
      case 'cancel':
        cancel(agent, event.requestId);
        return;
      case 'activity':
        if (agent.waiting) tell({ type: 'working' });
        return;
      case 'error':
        tell({ type: 'error', message: event.message });
        return;
      case 'ignored':
        return;
    }
  }

  async function startChatAgent(request: StartChatAgentRequest): Promise<ChatAgentId> {
    assertValidRequest(request);
    const claude = deps.findClaude();
    await deps.shipSkills(request.folder);

    const id = randomUUID();
    const process = deps.spawnProcess(claude, CHAT_FLAGS, { cwd: request.folder, env: { ...deps.env, [AGENT_ID_VARIABLE]: id } });
    const agent: RunningChatAgent = {
      id,
      process,
      seenRequestIds: new Set(),
      awaitingResponses: new Set(),
      waiting: false,
      errorLines: [],
    };
    agents.set(id, agent);

    const lines = createLineSplitter();
    const read = (line: string): void => {
      deps.events.raw(id, line);
      handle(agent, parseEventLine(line));
    };
    process.onStdout((chunk) => {
      if (agents.get(id) === agent) lines.push(chunk).forEach(read);
    });
    const errorText = createLineSplitter();
    const keepErrorLines = (lines: string[]): void => {
      const readable = lines.map((line) => line.replace(TERMINAL_CODES, '').trim().slice(0, ERROR_LINE_LENGTH));
      agent.errorLines = [...agent.errorLines, ...readable.filter((line) => line !== '')].slice(-ERROR_LINES_SHOWN);
    };
    process.onStderr((chunk) => {
      if (agents.get(id) === agent) keepErrorLines(errorText.push(chunk));
    });
    process.onExit((exitCode) => {
      if (agents.get(id) !== agent) return;
      lines.flush().forEach(read);
      keepErrorLines(errorText.flush());
      if (exitCode !== 0) say(agent, { type: 'failed', message: failedEnd(exitCode, agent.errorLines) });
      forget(agent);
      deps.events.exited(id, exitCode);
    });

    const initializeId = `grillo-initialize-${id}`;
    agent.awaitingResponses.add(initializeId);
    writeLine(agent, { type: 'control_request', request_id: initializeId, request: { subtype: 'initialize' } });
    if (request.firstMessage !== '') {
      writeUserMessage(agent, request.firstMessage);
    }
    return id;
  }

  /** Takes the pending request `id` off the list when it is of `kind`, with its agent still running. */
  function takePending(
    id: string,
    kinds: ReadonlyArray<PendingRequest['kind']>,
  ): { request: PendingRequest; agent: RunningChatAgent } | string {
    const request = pending.get(id);
    const agent = request && agents.get(request.agentId);
    if (!request || !agent) return `Nothing is waiting for an answer with id '${id}'`;
    if (!kinds.includes(request.kind)) return `'${id}' is a ${request.kind}, which this answer does not fit`;
    return { request, agent };
  }

  function stop(id: ChatAgentId): boolean {
    const agent = agents.get(id);
    if (!agent) return false;
    forget(agent);
    agent.process.stop();
    return true;
  }

  return {
    startChatAgent,
    send(id, text) {
      const agent = agents.get(id);
      if (!agent) return refused(`No chat agent with id '${id}'`);
      if (typeof text !== 'string' || text === '') return refused('A message cannot be empty');
      writeUserMessage(agent, text);
      return OK;
    },
    answer(id, option) {
      const taken = takePending(id, ['question']);
      if (typeof taken === 'string') return refused(taken);
      const answers = answersFor(taken.request.questions, option);
      if (typeof answers === 'string') return refused(answers);
      return settle(taken.agent, id, { behavior: 'allow', updatedInput: { ...taken.request.input, answers } });
    },
    allow(id) {
      const taken = takePending(id, ['permission']);
      if (typeof taken === 'string') return refused(taken);
      return settle(taken.agent, id, { behavior: 'allow', updatedInput: taken.request.input });
    },
    deny(id) {
      const taken = takePending(id, ['permission', 'question']);
      if (typeof taken === 'string') return refused(taken);
      return settle(taken.agent, id, { behavior: 'deny', message: DENIED_MESSAGE });
    },
    stop,
    stopAll() {
      for (const id of [...agents.keys()]) stop(id);
    },
  };
}
