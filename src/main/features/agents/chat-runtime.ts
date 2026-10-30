import type { AgentId, AgentInfo, StartAgentRequest } from '../../../shared/agents';
import type { ChatMessage } from '../../../shared/agent-chat';
import type { Unsubscribe } from '../../../shared/ipc';
import type { ChatDriver, ChatDriverEvents } from '../agent-chat/driver';
import { assertSendableMessage, assertValidStartRequest, type AgentRuntime, type AgentRuntimeEvents } from './runtime';

/** The exit code reported for a chat agent whose Claude Code could not start or was killed by a signal. */
export const NO_EXIT_CODE = -1;
/** A raw event line shown on the tab ends with a terminal line break. */
const LINE_END = '\r\n';

/** The chat messages that open a request for the member, and those that settle one. */
const REQUEST_MESSAGES: ReadonlySet<string> = new Set(['question', 'permission']);
const SETTLED_MESSAGES: ReadonlySet<string> = new Set(['answered', 'cancelled']);
/** The agent talks again, so every request it left open has gone by and its turn goes on. */
const TALKING_MESSAGES: ReadonlySet<string> = new Set(['init', 'assistant', 'user']);

/**
 * What the tab's dot follows: the questions and permissions still waiting for the member, and whether the agent's
 * turn has ended. The agent waits for the member while either holds.
 */
interface ChatStatus {
  open: Set<string>;
  turnOver: boolean;
}

export interface ChatAgentRuntimeDeps {
  /** The app's one chat driver, shared with the agent chat channels so the chat view reaches the tab's process. */
  driver: Pick<ChatDriver, 'startChatAgent' | 'send' | 'stop'>;
  /** Subscribes to that driver's events. */
  observe(listener: ChatDriverEvents): Unsubscribe;
  events: AgentRuntimeEvents;
}

function messageType(message: unknown): string | undefined {
  const type = (message as { type?: unknown } | null)?.type;
  return typeof message === 'object' && typeof type === 'string' ? type : undefined;
}

function requestId(message: unknown): string | undefined {
  const id = (message as { id?: unknown }).id;
  return typeof id === 'string' ? id : undefined;
}

/** Moves the status on by one chat message. */
function advance(status: ChatStatus, type: string, message: unknown): void {
  const id = requestId(message);
  if (REQUEST_MESSAGES.has(type) && id !== undefined) status.open.add(id);
  else if (SETTLED_MESSAGES.has(type) && id !== undefined) status.open.delete(id);
  else if (type === 'result') status.turnOver = true;
  else if (type === 'working') status.turnOver = false;
  else if (TALKING_MESSAGES.has(type)) {
    status.open.clear();
    status.turnOver = false;
  }
}

/**
 * The agent runtime over the chat driver (PRD section 4.6 item 1, issue 156): each tab is one chat agent, one
 * Claude Code process in machine-readable mode, and the tab's id is the chat agent's id. No terminal runs beside it.
 */
export function createChatAgentRuntime(deps: ChatAgentRuntimeDeps): AgentRuntime {
  const agents = new Map<AgentId, AgentInfo>();
  const statuses = new Map<AgentId, ChatStatus>();

  const announce = (): void => deps.events.listChanged(list());

  function list(): AgentInfo[] {
    return [...agents.values()].map((info) => ({ ...info }));
  }

  function find(id: AgentId): AgentInfo {
    const info = agents.get(id);
    if (!info) throw new Error(`No agent with id '${id}'`);
    return info;
  }

  function follow(id: AgentId, message: ChatMessage): void {
    const info = agents.get(id);
    const status = statuses.get(id);
    const type = messageType(message);
    if (!info || !status || type === undefined) return;
    advance(status, type, message);
    const waiting = status.turnOver || status.open.size > 0;
    if (waiting === info.waiting) return;
    info.waiting = waiting;
    announce();
  }

  deps.observe({
    message: follow,
    raw(id, line) {
      if (agents.has(id) && typeof line === 'string') deps.events.output(id, line + LINE_END);
    },
    exited(id, exitCode) {
      statuses.delete(id);
      if (!agents.delete(id)) return;
      deps.events.exited(id, typeof exitCode === 'number' ? exitCode : NO_EXIT_CODE);
      announce();
    },
  });

  function stop(id: AgentId): void {
    statuses.delete(id);
    if (!agents.delete(id)) return;
    deps.driver.stop(id);
    announce();
  }

  return {
    choice: 'chat',
    async startAgent(request: StartAgentRequest) {
      assertValidStartRequest(request);
      const { kind, folder, title, firstMessage } = request;
      const id = await deps.driver.startChatAgent({ kind, folder, firstMessage });
      agents.set(id, { id, kind, title, folder, waiting: false, runtime: 'chat' });
      statuses.set(id, { open: new Set(), turnOver: false });
      announce();
      return id;
    },
    write(id) {
      find(id);
      throw new Error(`The agent '${id}' is a chat agent and has no terminal to type into: send it a message`);
    },
    async send(id, text) {
      find(id);
      assertSendableMessage(text);
      const sent = deps.driver.send(id, text);
      if (!sent.ok) throw new Error(sent.reason);
    },
    /** A chat agent takes messages as soon as it is started: the driver hands them over in turn. */
    async ready(id) {
      find(id);
    },
    resize(id) {
      find(id);
    },
    stop,
    stopAll() {
      for (const id of [...agents.keys()]) stop(id);
    },
    setTitle(id, title) {
      find(id).title = title;
      announce();
    },
    list,
  };
}
