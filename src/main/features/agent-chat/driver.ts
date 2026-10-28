import { randomUUID } from 'node:crypto';
import type {
  ChatActionResult,
  ChatAgentId,
  ChatAnswer,
  ChatMessage,
  ChatQuestionItem,
  StartChatAgentRequest,
} from '../../../shared/agent-chat';
import { AGENT_KINDS } from '../../../shared/agents';
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

/** The part of a child process the driver uses: stdout as text, stdin, and its end. */
export interface ChatProcess {
  onStdout(listener: (chunk: string) => void): void;
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
  /** Ends the agent's Claude Code. Does nothing for an agent that is already gone. */
  stop(id: ChatAgentId): void;
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
}

const refused = (reason: string): ChatActionResult => ({ ok: false, reason });
const OK: ChatActionResult = { ok: true };

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

  function writeUserMessage(agent: RunningChatAgent, text: string): void {
    writeLine(agent, { type: 'user', message: { role: 'user', content: text } });
    deps.events.message(agent.id, { type: 'user', text });
  }

  /** Takes a control request once; a repeated id is an error and is not answered again. */
  function claimRequestId(agent: RunningChatAgent, requestId: string): boolean {
    if (agent.seenRequestIds.has(requestId) || pending.has(requestId)) {
      deps.events.message(agent.id, { type: 'error', message: `Claude Code repeated request '${requestId}'` });
      return false;
    }
    agent.seenRequestIds.add(requestId);
    return true;
  }

  function handle(agent: RunningChatAgent, event: StreamEvent): void {
    const say = (message: ChatMessage): void => deps.events.message(agent.id, message);
    switch (event.kind) {
      case 'init':
        say({ type: 'init', sessionId: event.sessionId, model: event.model, tools: event.tools });
        return;
      case 'assistant':
        say({ type: 'assistant', text: event.text });
        return;
      case 'result':
        say({ type: 'result', isError: event.isError, text: event.text });
        return;
      case 'question':
        if (!claimRequestId(agent, event.requestId)) return;
        pending.set(event.requestId, { agentId: agent.id, kind: 'question', input: event.input, questions: event.questions });
        say({ type: 'question', id: event.requestId, questions: event.questions });
        return;
      case 'permission':
        if (!claimRequestId(agent, event.requestId)) return;
        pending.set(event.requestId, { agentId: agent.id, kind: 'permission', input: event.input, questions: [] });
        say({
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
        say({ type: 'error', message: event.message });
        return;
      case 'control-response':
        if (!agent.awaitingResponses.delete(event.requestId)) {
          say({ type: 'error', message: `Claude Code answered request '${event.requestId}', which Grillo never sent` });
        } else if (event.error !== undefined) {
          say({ type: 'error', message: `Claude Code refused to open the chat: ${event.error}` });
        }
        return;
      case 'error':
        say({ type: 'error', message: event.message });
        return;
      case 'ignored':
        return;
    }
  }

  async function startChatAgent(request: StartChatAgentRequest): Promise<ChatAgentId> {
    assertValidRequest(request);
    const claude = deps.findClaude();
    await deps.shipSkills(request.folder);

    const process = deps.spawnProcess(claude, CHAT_FLAGS, { cwd: request.folder, env: deps.env });
    const id = randomUUID();
    const agent: RunningChatAgent = { id, process, seenRequestIds: new Set(), awaitingResponses: new Set() };
    agents.set(id, agent);

    const lines = createLineSplitter();
    const read = (line: string): void => {
      deps.events.raw(id, line);
      handle(agent, parseEventLine(line));
    };
    process.onStdout((chunk) => {
      if (agents.get(id) === agent) lines.push(chunk).forEach(read);
    });
    process.onExit((exitCode) => {
      if (agents.get(id) !== agent) return;
      lines.flush().forEach(read);
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

  function stop(id: ChatAgentId): void {
    const agent = agents.get(id);
    if (!agent) return;
    forget(agent);
    agent.process.stop();
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
      pending.delete(id);
      respond(taken.agent, id, { behavior: 'allow', updatedInput: { ...taken.request.input, answers } });
      return OK;
    },
    allow(id) {
      const taken = takePending(id, ['permission']);
      if (typeof taken === 'string') return refused(taken);
      pending.delete(id);
      respond(taken.agent, id, { behavior: 'allow', updatedInput: taken.request.input });
      return OK;
    },
    deny(id) {
      const taken = takePending(id, ['permission', 'question']);
      if (typeof taken === 'string') return refused(taken);
      pending.delete(id);
      respond(taken.agent, id, { behavior: 'deny', message: DENIED_MESSAGE });
      return OK;
    },
    stop,
    stopAll() {
      for (const id of [...agents.keys()]) stop(id);
    },
  };
}
