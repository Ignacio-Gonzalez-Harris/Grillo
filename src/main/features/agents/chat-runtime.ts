import type { AgentId, AgentInfo, StartAgentRequest } from '../../../shared/agents';
import type { ChatMessage } from '../../../shared/agent-chat';
import type { Unsubscribe } from '../../../shared/ipc';
import type { ChatDriver, ChatDriverEvents } from '../agent-chat/driver';
import { assertSendableMessage, assertValidStartRequest, type AgentRuntime, type AgentRuntimeEvents } from './runtime';

/** The exit code reported for a chat agent whose Claude Code could not start or was killed by a signal. */
export const NO_EXIT_CODE = -1;
/** A raw event line shown on the tab ends with a terminal line break. */
const LINE_END = '\r\n';

/** The chat messages after which the agent waits for the member (the tab's dot), and those that end the wait. */
const WAITING_MESSAGES: ReadonlySet<string> = new Set(['result', 'question', 'permission']);
const WORKING_MESSAGES: ReadonlySet<string> = new Set(['init', 'assistant', 'user']);

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

/**
 * The agent runtime over the chat driver (PRD section 4.6 item 1, issue 156): each tab is one chat agent, one
 * Claude Code process in machine-readable mode, and the tab's id is the chat agent's id. No terminal runs beside it.
 */
export function createChatAgentRuntime(deps: ChatAgentRuntimeDeps): AgentRuntime {
  const agents = new Map<AgentId, AgentInfo>();

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
    const type = messageType(message);
    if (!info || type === undefined) return;
    const waiting = WAITING_MESSAGES.has(type) ? true : WORKING_MESSAGES.has(type) ? false : info.waiting;
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
      if (!agents.delete(id)) return;
      deps.events.exited(id, typeof exitCode === 'number' ? exitCode : NO_EXIT_CODE);
      announce();
    },
  });

  function stop(id: AgentId): void {
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
      agents.set(id, { id, kind, title, folder, waiting: false });
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
